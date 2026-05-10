import { Router } from "express";
import { authMiddleware, type AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { invoiceStatusRateLimiter } from "../middleware/rateLimiter";
import {
  CreateInvoiceRequestSchema,
  CreateInvoiceResponseSchema,
  InvoiceStatusResponseSchema,
  InvoiceDetailResponseSchema,
  InvoiceListQuerySchema,
  InvoiceListResponseSchema,
  uuidParamSchema,
  PayInvoiceRequestSchema,
} from "../types";
import { enqueueWebhook } from "../jobs/webhookQueue";

const router: Router = Router();

// ── Invoice List (BE-L4 fix) ──────────────────────────────────────────────
router.get(
  "/",
  authMiddleware,
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const merchantId = req.merchantId as string;
      const query = InvoiceListQuerySchema.parse(req.query);

      const where: any = { merchantId };
      if (query.status) where.status = query.status;
      if (query.chainKey) where.chainKey = query.chainKey;

      const orderBy: any = { [query.sortBy]: query.sortOrder };

      const [invoices, total] = await Promise.all([
        prisma.invoice.findMany({
          where,
          orderBy,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          select: {
            id: true,
            chainKey: true,
            tokenSymbol: true,
            amount: true,
            amountUsd: true,
            memo: true,
            status: true,
            privacyLevel: true,
            expiresAt: true,
            paidAt: true,
            createdAt: true,
          },
        }),
        prisma.invoice.count({ where }),
      ]);

      res.json(
        InvoiceListResponseSchema.parse({
          invoices,
          pagination: {
            page: query.page,
            limit: query.limit,
            total,
            totalPages: Math.ceil(total / query.limit),
          },
        })
      );
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/create",
  authMiddleware,
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const data = CreateInvoiceRequestSchema.parse(req.body);
      const merchantId = req.merchantId as string;

      if (data.merchantId !== merchantId) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const merchantViewingKey = await prisma.chainViewingKey.findUnique({
        where: {
          merchantId_chainKey: {
            merchantId,
            chainKey: data.chainKey,
          },
        },
        select: {
          settlementAddress: true,
        },
      });

      if (!merchantViewingKey) {
        res.status(409).json({ error: "Merchant viewing key not published for chain" });
        return;
      }

      const expiresAt = new Date(Date.now() + data.expiresInMinutes * 60 * 1000);

      const invoice = await prisma.invoice.create({
        data: {
          merchantId,
          chainKey: data.chainKey,
          tokenSymbol: data.tokenSymbol,
          amount: data.amount,
          memo: data.memo,
          expiresAt,
          privacyLevel: data.privacyLevel,
          paymentAddress: merchantViewingKey.settlementAddress,
        },
      });

      res.status(201).json(
        CreateInvoiceResponseSchema.parse({
          invoiceId: invoice.id,
          merchantId: invoice.merchantId,
          status: invoice.status,
          paymentAddress: invoice.paymentAddress ?? undefined,
          paymentTxHash: invoice.paymentTxHash ?? undefined,
          paidAt: invoice.paidAt ?? undefined,
          expiresAt: invoice.expiresAt,
          chainKey: invoice.chainKey,
          tokenSymbol: invoice.tokenSymbol,
          amount: invoice.amount,
          memo: invoice.memo ?? undefined,
          privacyLevel: invoice.privacyLevel,
        })
      );
    } catch (error) {
      next(error);
    }
  }
);

router.get("/:id/status", invoiceStatusRateLimiter, async (req, res, next) => {
  try {
    // BE-M1 fix: validate UUID path parameter
    const { id } = uuidParamSchema.parse(req.params);

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        // BE-H2 fix: do NOT expose paymentAddress or paymentTxHash on public endpoint
        paidAt: true,
        expiresAt: true,
      },
    });

    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    res.json(
      InvoiceStatusResponseSchema.parse({
        invoiceId: invoice.id,
        status: invoice.status,
        paidAt: invoice.paidAt ?? undefined,
        expiresAt: invoice.expiresAt,
      })
    );
  } catch (error) {
    next(error);
  }
});

// BE-H3 fix: use explicit response schema; BE-M1 fix: UUID validation
router.get("/:id", authMiddleware, requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = uuidParamSchema.parse(req.params);

    const invoice = await prisma.invoice.findUnique({
      where: { id },
    });

    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    if (invoice.merchantId !== req.merchantId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    res.json(
      InvoiceDetailResponseSchema.parse({
        id: invoice.id,
        merchantId: invoice.merchantId,
        chainKey: invoice.chainKey,
        tokenSymbol: invoice.tokenSymbol,
        amount: invoice.amount,
        amountUsd: invoice.amountUsd ?? undefined,
        memo: invoice.memo ?? undefined,
        expiresAt: invoice.expiresAt,
        status: invoice.status,
        privacyLevel: invoice.privacyLevel,
        paymentAddress: invoice.paymentAddress ?? undefined,
        paymentTxHash: invoice.paymentTxHash ?? undefined,
        paidAt: invoice.paidAt ?? undefined,
        createdAt: invoice.createdAt,
      })
    );
  } catch (error) {
    next(error);
  }
});

router.post(
  "/:id/cancel",
  authMiddleware,
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      // BE-M1 fix: validate UUID path parameter
      const { id } = uuidParamSchema.parse(req.params);

      const invoice = await prisma.invoice.findUnique({
        where: { id },
        select: { id: true, merchantId: true, status: true },
      });

      if (!invoice) {
        res.status(404).json({ error: "Invoice not found" });
        return;
      }

      if (invoice.merchantId !== req.merchantId) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      if (invoice.status !== "pending") {
        res.status(409).json({ error: "Only pending invoices can be cancelled" });
        return;
      }

      const cancelled = await prisma.invoice.update({
        where: { id },
        data: { status: "cancelled" },
        select: {
          id: true,
          merchantId: true,
          status: true,
          paymentAddress: true,
          paymentTxHash: true,
          paidAt: true,
          expiresAt: true,
          chainKey: true,
          tokenSymbol: true,
          amount: true,
          memo: true,
          privacyLevel: true,
        },
      });

      res.json(
        CreateInvoiceResponseSchema.parse({
          invoiceId: cancelled.id,
          merchantId: cancelled.merchantId,
          status: cancelled.status,
          paymentAddress: cancelled.paymentAddress ?? undefined,
          paymentTxHash: cancelled.paymentTxHash ?? undefined,
          paidAt: cancelled.paidAt ?? undefined,
          expiresAt: cancelled.expiresAt,
          chainKey: cancelled.chainKey,
          tokenSymbol: cancelled.tokenSymbol,
          amount: cancelled.amount,
          memo: cancelled.memo ?? undefined,
          privacyLevel: cancelled.privacyLevel,
        })
      );
    } catch (error) {
      next(error);
    }
  }
);

// ST-H1 fix: /:id/pay now requires HMAC authentication (was unauthenticated)
// ST-H3 fix: req.body.txHash validated with Zod (was unsanitized)
// ST-M3 fix: route defined BEFORE export (was defined after)
router.post(
  "/:id/pay",
  authMiddleware,
  requireAuth,
  invoiceStatusRateLimiter,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id } = uuidParamSchema.parse(req.params);
      const body = PayInvoiceRequestSchema.parse(req.body);

      const invoice = await prisma.invoice.findUnique({
        where: { id },
        include: { merchant: { select: { id: true } } },
      });

      if (!invoice) {
        res.status(404).json({ error: "Invoice not found" });
        return;
      }

      // Merchant scoping: only the invoice owner can mark it as paid
      if (invoice.merchantId !== req.merchantId) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      if (invoice.status !== "pending") {
        res.status(409).json({ error: "Invoice is not pending" });
        return;
      }

      const paidAt = new Date();

      const updated = await prisma.invoice.update({
        where: { id },
        data: {
          status: "paid",
          paidAt,
          paymentTxHash: body.txHash,
        },
        select: {
          id: true,
          status: true,
          paidAt: true,
          expiresAt: true,
          chainKey: true,
          tokenSymbol: true,
          amount: true,
          memo: true,
          privacyLevel: true,
          paymentTxHash: true,
          merchant: true,
        },
      });

      await enqueueWebhook({
        eventType: "invoice.paid",
        merchantId: invoice.merchant.id,
        invoiceId: updated.id,
        chainKey: updated.chainKey,
        tokenSymbol: updated.tokenSymbol,
        amount: updated.amount.toString(),
        privacyLevel: updated.privacyLevel,
        timestamp: Date.now(),
      });

      res.json({
        invoiceId: updated.id,
        status: updated.status,
        paidAt: updated.paidAt,
      });
    } catch (error) {
      next(error);
    }
  }
);

export { router as invoiceRoutes };
