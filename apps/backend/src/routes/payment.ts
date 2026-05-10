import { Router } from "express";
import { z } from "zod";
import { authMiddleware, type AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { enqueueWebhook } from "../jobs/webhookQueue";
import {
  PaymentListQuerySchema,
  PaymentListResponseSchema,
  uuidParamSchema,
} from "../types";

const router: Router = Router();

// Zod schema for payment confirmation body (from indexer)
const PaymentConfirmBodySchema = z.object({
  invoiceId: z.string().uuid(),
  merchantId: z.string().uuid(),
  chainKey: z.string().trim().min(1).max(50),
  txHash: z.string().trim().min(1).max(128).regex(/^(0x[0-9a-fA-F]{64}|[A-Za-z0-9]{32,128})$/),
  fromAddress: z.string().trim().min(1).max(100),
  toAddress: z.string().trim().min(1).max(100),
  amount: z.string().trim().min(1).max(50).regex(/^\d+(\.\d{1,18})?$/),
  tokenSymbol: z.string().trim().min(1).max(20),
  privacyLevel: z.enum(["standard", "max"]).default("standard"),
  blockNumber: z.union([z.string(), z.number()]).optional(),
});

// ── Payment Confirmation (called by indexer after on-chain confirmation) ──
// Note: For production, this should verify the request comes from the indexer
// (e.g., using a shared secret or IP whitelist). Simplified here for clarity.
router.post(
  "/confirm",
  async (req, res, next) => {
    try {
      const body = PaymentConfirmBodySchema.parse(req.body);

      // Create the payment record
      const payment = await prisma.payment.create({
        data: {
          invoiceId: body.invoiceId,
          merchantId: body.merchantId,
          chainKey: body.chainKey,
          txHash: body.txHash,
          fromAddress: body.fromAddress,
          toAddress: body.toAddress,
          amount: body.amount,
          tokenSymbol: body.tokenSymbol,
          privacyLevel: body.privacyLevel,
          status: "confirmed",
          blockNumber: body.blockNumber ? parseInt(String(body.blockNumber), 10) : undefined,
        },
      });

      // Update invoice status to paid
      const invoice = await prisma.invoice.update({
        where: { id: body.invoiceId },
        data: {
          status: "paid",
          paidAt: new Date(),
          paymentTxHash: body.txHash,
        },
      });

      // Enqueue webhook delivery
      await enqueueWebhook({
        eventType: "payment.received",
        merchantId: body.merchantId,
        invoiceId: body.invoiceId,
        chainKey: body.chainKey,
        tokenSymbol: body.tokenSymbol,
        amount: body.amount,
        privacyLevel: body.privacyLevel,
        timestamp: Date.now(),
      });

      res.status(201).json({
        success: true,
        paymentId: payment.id,
        invoiceId: invoice.id,
        status: "confirmed",
      });
    } catch (error) {
      next(error);
    }
  }
);

// ── Payment List ──────────────────────────────────────────────────────────
router.get(
  "/",
  authMiddleware,
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const merchantId = req.merchantId as string;
      const query = PaymentListQuerySchema.parse(req.query);

      const where: any = { merchantId };
      if (query.status) where.status = query.status;
      if (query.chainKey) where.chainKey = query.chainKey;
      if (query.invoiceId) where.invoiceId = query.invoiceId;

      const orderBy: any = { [query.sortBy]: query.sortOrder };

      const [payments, total] = await Promise.all([
        prisma.payment.findMany({
          where,
          orderBy,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          select: {
            id: true,
            invoiceId: true,
            chainKey: true,
            txHash: true,
            fromAddress: true,
            toAddress: true,
            amount: true,
            tokenSymbol: true,
            privacyLevel: true,
            status: true,
            blockNumber: true,
            timestamp: true,
          },
        }),
        prisma.payment.count({ where }),
      ]);

      res.json(
        PaymentListResponseSchema.parse({
          payments,
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

// ── Payment Detail ────────────────────────────────────────────────────────
router.get(
  "/:id",
  authMiddleware,
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id } = uuidParamSchema.parse(req.params);
      const merchantId = req.merchantId as string;

      const payment = await prisma.payment.findUnique({
        where: { id },
      });

      if (!payment) {
        res.status(404).json({ error: "Payment not found" });
        return;
      }

      if (payment.merchantId !== merchantId) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      res.json({
        id: payment.id,
        invoiceId: payment.invoiceId ?? undefined,
        chainKey: payment.chainKey,
        txHash: payment.txHash,
        fromAddress: payment.fromAddress,
        toAddress: payment.toAddress,
        amount: payment.amount,
        tokenSymbol: payment.tokenSymbol,
        privacyLevel: payment.privacyLevel,
        nullifier: payment.nullifier ?? undefined,
        commitment: payment.commitment ?? undefined,
        status: payment.status,
        blockNumber: payment.blockNumber ?? undefined,
        timestamp: payment.timestamp,
      });
    } catch (error) {
      next(error);
    }
  }
);

export { router as paymentRoutes };
