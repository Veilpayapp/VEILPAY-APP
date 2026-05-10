import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import {
  authMiddleware,
  hashApiKey,
  type AuthenticatedRequest,
  requireAuth,
} from "../middleware/auth";
import { prisma } from "../lib/prisma";
import {
  uuidParamSchema,
  MerchantUpdateRequestSchema,
  MerchantUpdateResponseSchema,
  MerchantStatsResponseSchema,
  PaymentListItemSchema,
} from "../types";

const router: Router = Router();

const registerSchema = z.object({
  businessName: z.string().trim().min(1).max(100),
  email: z.string().email(),
  webhookUrl: z.string().url().max(500).optional(),
});

const publishKeySchema = z.object({
  chainKey: z.string().trim().min(1).max(50),
  viewingKey: z.string().trim().min(1).max(2048),
  settlementAddress: z.string().trim().min(1).max(100),
});

router.post("/register", async (req, res, next) => {
  try {
    const data = registerSchema.parse(req.body);

    const existingMerchant = await prisma.merchant.findUnique({
      where: { email: data.email },
    });

    if (existingMerchant) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }

    const apiKey = `vp_${randomUUID().replace(/-/g, "")}`;
    const apiKeyHash = hashApiKey(apiKey);

    const merchant = await prisma.merchant.create({
      data: {
        businessName: data.businessName,
        email: data.email,
        webhookUrl: data.webhookUrl,
        apiKeyHash,
        status: "active",
      },
    });

    res.status(201).json({
      merchantId: merchant.id,
      businessName: merchant.businessName,
      email: merchant.email,
      apiKey,
      status: merchant.status,
    });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/keys/publish",
  authMiddleware,
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const data = publishKeySchema.parse(req.body);
      const merchantId = req.merchantId as string;

      // BE-M2 fix: explicit chain type mapping instead of fragile string matching
      const CHAIN_TYPE_MAP: Record<string, "evm" | "svm" | "mvm"> = {
        ethereum: "evm",
        polygon: "evm",
        arbitrum: "evm",
        optimism: "evm",
        base: "evm",
        sepolia: "evm",
        solana: "svm",
        "solana-devnet": "svm",
        aptos: "mvm",
      };
      const chainType = CHAIN_TYPE_MAP[data.chainKey] ?? "evm";

      const viewingKey = await prisma.chainViewingKey.upsert({
        where: {
          merchantId_chainKey: {
            merchantId,
            chainKey: data.chainKey,
          },
        },
        update: {
          viewingKey: data.viewingKey,
          settlementAddress: data.settlementAddress,
        },
        create: {
          merchantId,
          chainType,
          chainKey: data.chainKey,
          viewingKey: data.viewingKey,
          settlementAddress: data.settlementAddress,
        },
      });

      res.json({
        chainKey: viewingKey.chainKey,
        published: true,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get("/:id", authMiddleware, requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    // BE-M1 fix: validate UUID path parameter
    const { id } = uuidParamSchema.parse(req.params);

    if (req.merchantId !== id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const merchant = await prisma.merchant.findUnique({
      where: { id },
      include: { viewingKeys: true },
    });

    if (!merchant) {
      res.status(404).json({ error: "Merchant not found" });
      return;
    }

    res.json({
      id: merchant.id,
      businessName: merchant.businessName,
      email: merchant.email,
      webhookUrl: merchant.webhookUrl,
      status: merchant.status,
      tier: merchant.tier,
      viewingKeys: merchant.viewingKeys.map((k: any) => ({
        chainKey: k.chainKey,
        settlementAddress: k.settlementAddress,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// ── Merchant Dashboard Stats ──────────────────────────────────────────────
router.get(
  "/:id/stats",
  authMiddleware,
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id } = uuidParamSchema.parse(req.params);

      if (req.merchantId !== id) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const merchant = await prisma.merchant.findUnique({ where: { id } });
      if (!merchant) {
        res.status(404).json({ error: "Merchant not found" });
        return;
      }

      // Run all counts in parallel for performance
      const [
        totalInvoices,
        pendingInvoices,
        paidInvoices,
        expiredInvoices,
        cancelledInvoices,
        totalPayments,
        confirmedPayments,
        pendingPayments,
        failedPayments,
        chainVolumes,
        recentPayments,
      ] = await Promise.all([
        prisma.invoice.count({ where: { merchantId: id } }),
        prisma.invoice.count({ where: { merchantId: id, status: "pending" } }),
        prisma.invoice.count({ where: { merchantId: id, status: "paid" } }),
        prisma.invoice.count({ where: { merchantId: id, status: "expired" } }),
        prisma.invoice.count({ where: { merchantId: id, status: "cancelled" } }),
        prisma.payment.count({ where: { merchantId: id } }),
        prisma.payment.count({ where: { merchantId: id, status: "confirmed" } }),
        prisma.payment.count({ where: { merchantId: id, status: "pending" } }),
        prisma.payment.count({ where: { merchantId: id, status: "failed" } }),
        // Volume grouped by chainKey — cast required because Prisma groupBy
        // does not include String fields in _sum type by default
        prisma.payment.groupBy({
          by: ["chainKey"],
          where: { merchantId: id, status: "confirmed" },
          _sum: { amount: true },
        } as any) as Promise<Array<{ chainKey: string; _sum: { amount: string | null } }>>,
        // 5 most recent confirmed payments
        prisma.payment.findMany({
          where: { merchantId: id },
          orderBy: { timestamp: "desc" },
          take: 5,
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
      ]);

      // Build chain volume map (amounts are strings, convert to float)
      const totalVolumeByChain: Record<string, number> = {};
      for (const cv of chainVolumes) {
        const rawAmount = (cv._sum as any)?.amount ?? "0";
        const val = parseFloat(rawAmount);
        totalVolumeByChain[cv.chainKey] = isNaN(val) ? 0 : val;
      }

      res.json(
        MerchantStatsResponseSchema.parse({
          merchantId: id,
          totalInvoices,
          pendingInvoices,
          paidInvoices,
          expiredInvoices,
          cancelledInvoices,
          totalPayments,
          confirmedPayments,
          pendingPayments,
          failedPayments,
          totalVolumeByChain,
          recentPayments,
        })
      );
    } catch (error) {
      next(error);
    }
  }
);

// ── Merchant Update ───────────────────────────────────────────────────────
router.put(
  "/:id",
  authMiddleware,
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id } = uuidParamSchema.parse(req.params);

      if (req.merchantId !== id) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const data = MerchantUpdateRequestSchema.parse(req.body);

      // Ensure at least one field is provided
      if (Object.keys(data).length === 0) {
        res.status(400).json({ error: "No fields to update" });
        return;
      }

      const merchant = await prisma.merchant.update({
        where: { id },
        data: {
          ...(data.businessName !== undefined && { businessName: data.businessName }),
          ...(data.webhookUrl !== undefined && { webhookUrl: data.webhookUrl }),
        },
        select: {
          id: true,
          businessName: true,
          email: true,
          webhookUrl: true,
          status: true,
          tier: true,
          updatedAt: true,
        },
      });

      res.json(
        MerchantUpdateResponseSchema.parse({
          id: merchant.id,
          businessName: merchant.businessName,
          email: merchant.email,
          webhookUrl: merchant.webhookUrl,
          status: merchant.status,
          tier: merchant.tier,
          updatedAt: merchant.updatedAt,
        })
      );
    } catch (error) {
      next(error);
    }
  }
);

export { router as merchantRoutes };
