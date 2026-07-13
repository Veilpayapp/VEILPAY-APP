import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { hashApiKey, type AuthenticatedRequest } from "../middleware/auth";
import { prisma } from "../lib/prisma";
// SSRF guard helper. Single source of truth for the URL-validation
// error contract — registerMerchant and updateMerchant both delegate
// here so a future change to rejection semantics cannot drift between
// the two write paths (see review warning #10).
import { rejectUnsafeWebhookUrl } from "../utils/urlSafety";
// SEC-001: server-side guard that a published viewing key is genuinely PUBLIC
// key material before it can be persisted and served unauthenticated by the
// Directory endpoint. Rejects private/secret keys per chain family.
import { validatePublishedViewingKey } from "../utils/publicKey";
import {
  uuidParamSchema,
  MerchantUpdateRequestSchema,
  MerchantUpdateResponseSchema,
  MerchantStatsResponseSchema,
} from "../types";

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

export const registerMerchant = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = registerSchema.parse(req.body);

    // SEC-002 fix: validate the webhook URL before storing it so a merchant
    // cannot register an SSRF endpoint (localhost, private IP, metadata).
    if (!(await rejectUnsafeWebhookUrl(data.webhookUrl, res))) return;

    const existingMerchant = await prisma.merchant.findUnique({
      where: { email: data.email },
    });

    if (existingMerchant) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }

    const apiKey = `vp_${randomUUID().replace(/-/g, "")}`;
    const apiKeyHash = hashApiKey(apiKey);

    // SEC-003: production defaults new merchants to `pending` so API keys
    // cannot be used until an operator activates them. Dev/test and explicit
    // MERCHANT_REGISTRATION_AUTO_ACTIVATE=true keep the old auto-active path
    // for local e2e. Auth middleware only accepts status: 'active'.
    const autoActivate =
      process.env.MERCHANT_REGISTRATION_AUTO_ACTIVATE === "true" ||
      process.env.NODE_ENV === "test" ||
      process.env.NODE_ENV === "development";
    const status = autoActivate ? "active" : "pending";

    // Optional shared registration token (invite-only signup).
    const requiredToken = process.env.MERCHANT_REGISTRATION_TOKEN?.trim();
    if (requiredToken) {
      const provided =
        (req.headers["x-registration-token"] as string | undefined)?.trim() ||
        (typeof req.body?.registrationToken === "string"
          ? req.body.registrationToken.trim()
          : "");
      if (provided !== requiredToken) {
        res.status(403).json({
          error: "Registration token required or invalid",
          code: "MERCHANT_REGISTRATION_FORBIDDEN",
        });
        return;
      }
    }

    const merchant = await prisma.merchant.create({
      data: {
        businessName: data.businessName,
        email: data.email,
        webhookUrl: data.webhookUrl,
        apiKeyHash,
        status,
      },
    });

    res.status(201).json({
      merchantId: merchant.id,
      businessName: merchant.businessName,
      email: merchant.email,
      apiKey,
      status: merchant.status,
      ...(status === "pending"
        ? {
            message:
              "Merchant registered pending activation. API calls will return 401 until status is active.",
          }
        : {}),
    });
  } catch (error) {
    next(error);
  }
};

export const publishKey = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = publishKeySchema.parse(req.body);
    const merchantId = req.merchantId as string;

    const CHAIN_TYPE_MAP: Record<string, "evm" | "svm" | "xlm"> = {
      ethereum: "evm",
      polygon: "evm",
      arbitrum: "evm",
      optimism: "evm",
      base: "evm",
      bsc: "evm",
      sepolia: "evm",
      solana: "svm",
      "solana-devnet": "svm",
      stellar: "xlm",
      "stellar-testnet": "xlm",
    };
    const chainType = CHAIN_TYPE_MAP[data.chainKey];
    if (!chainType) {
      res.status(400).json({ error: `Unsupported chainKey: ${data.chainKey}` });
      return;
    }

    // SEC-001: the Directory serves this value UNAUTHENTICATED so any sender can
    // derive a stealth address / encrypt a memo for the merchant. That is safe
    // only if the value is a PUBLIC key. Reject anything that is not a
    // well-formed public key (in particular a private/secret key) so spend/scan
    // authority can never be published to the world.
    const keyCheck = validatePublishedViewingKey(chainType, data.viewingKey);
    if (!keyCheck.ok) {
      res.status(400).json({
        error: keyCheck.error,
        code: "INVALID_PUBLIC_VIEWING_KEY",
      });
      return;
    }

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
};

export const getMerchant = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
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
      viewingKeys: merchant.viewingKeys.map((k) => ({
        chainKey: k.chainKey,
        settlementAddress: k.settlementAddress,
      })),
    });
  } catch (error) {
    next(error);
  }
};

export const getMerchantStats = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
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
      prisma.payment.findMany({
        where: { merchantId: id, status: 'confirmed' },
        select: { chainKey: true, amount: true },
      }),
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

    const totalVolumeByChain: Record<string, number> = {};
    for (const payment of chainVolumes) {
      const rawAmount = payment.amount ?? '0';
      const val = parseFloat(rawAmount);
      if (!isNaN(val)) {
        totalVolumeByChain[payment.chainKey] = (totalVolumeByChain[payment.chainKey] || 0) + val;
      }
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
};

export const updateMerchant = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = uuidParamSchema.parse(req.params);

    if (req.merchantId !== id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const data = MerchantUpdateRequestSchema.parse(req.body);

    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    // SEC-002 fix: validate a new webhook URL before persisting it.
    if (!(await rejectUnsafeWebhookUrl(data.webhookUrl, res))) return;

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
};
