import type { Response, NextFunction } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import type { AuthenticatedRequest } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import {
  confirmInvoicePayment,
  InvoiceNotPayableError,
} from "../services/paymentProcessor";
import { verifyPaymentTxOnChain } from "../services/paymentTxVerifier";
import {
  PaymentListQuerySchema,
  PaymentListResponseSchema,
  PrivacyLevel,
  uuidParamSchema,
} from "../types";

/**
 * SEC-001: `/api/v1/payment/confirm` is auth-gated (see `routes/payment.ts`).
 * The caller's `merchantId` is taken from the HMAC-signed auth context — NOT
 * from the request body — and the invoice must belong to that merchant and be
 * `pending`.
 *
 * SEC-001 residual (Phase 1): before committing payment state, the claimed
 * `txHash` is verified on-chain (EVM via viem, non-EVM via Goldrush address
 * history) so a compromised merchant key cannot mark an invoice paid for a
 * transaction that never landed. The indexer path remains authoritative for
 * automated matching; this gate hardens the HTTP confirm surface.
 *
 * The `merchantId` field is intentionally absent from this schema so a caller
 * cannot confirm a payment against another merchant's invoice. Zod strips
 * unknown keys by default, so legacy clients that still send `merchantId`
 * are silently ignored rather than rejected.
 */
const PaymentConfirmBodySchema = z.object({
  invoiceId: z.string().uuid(),
  chainKey: z.string().trim().min(1).max(50),
  txHash: z.string().trim().min(1).max(128).regex(/^(0x[0-9a-fA-F]{64}|[A-Za-z0-9]{32,128})$/),
  fromAddress: z.string().trim().min(1).max(100),
  toAddress: z.string().trim().min(1).max(100),
  amount: z.string().trim().min(1).max(50).regex(/^\d+(\.\d{1,18})?$/),
  tokenSymbol: z.string().trim().min(1).max(20),
  privacyLevel: PrivacyLevel.default("standard"),
  blockNumber: z.union([z.string(), z.number()]).optional(),
});

export const confirmPayment = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = PaymentConfirmBodySchema.parse(req.body);
    const merchantId = req.merchantId as string;

    if (!merchantId) {
      // Defensive — authMiddleware + requireAuth should already have rejected
      // unauthenticated callers at the route layer. Keep this so a misrouted
      // request can never fall through to a state-mutating write.
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    // Validate the invoice before touching payment state. We use 404 for
    // both "not found" and "belongs to another merchant" so the endpoint
    // does not leak which invoices exist for other merchants.
    const invoice = await prisma.invoice.findUnique({
      where: { id: body.invoiceId },
    });

    if (!invoice || invoice.merchantId !== merchantId) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }
    if (invoice.status !== "pending") {
      res.status(409).json({ error: `Invoice is ${invoice.status}, not pending` });
      return;
    }
    if (invoice.chainKey !== body.chainKey) {
      res.status(400).json({ error: "chainKey does not match invoice" });
      return;
    }

    // SEC-001 residual: never trust caller-reported chain facts alone.
    const verified = await verifyPaymentTxOnChain(
      {
        id: invoice.id,
        chainKey: invoice.chainKey,
        tokenSymbol: invoice.tokenSymbol,
        amount: invoice.amount,
        paymentAddress: invoice.paymentAddress,
        tokenAddress: invoice.tokenAddress,
      },
      {
        txHash: body.txHash,
        fromAddress: body.fromAddress,
        toAddress: body.toAddress,
        amount: body.amount,
        tokenSymbol: body.tokenSymbol,
        blockNumber: body.blockNumber ? parseInt(String(body.blockNumber), 10) : undefined,
      }
    );

    if (!verified.ok) {
      res.status(verified.status).json({ error: verified.error });
      return;
    }

    try {
      const outcome = await confirmInvoicePayment(
        {
          id: invoice.id,
          merchantId: invoice.merchantId,
          chainKey: invoice.chainKey,
          tokenSymbol: invoice.tokenSymbol,
          amount: invoice.amount,
          privacyLevel: invoice.privacyLevel,
        },
        verified.tx
      );

      if (outcome.kind === "idempotent") {
        res.status(200).json({
          success: true,
          paymentId: outcome.paymentId,
          invoiceId: invoice.id,
          status: "confirmed",
          idempotent: true,
          paidAt: outcome.paidAt ? outcome.paidAt.toISOString() : null,
        });
        return;
      }

      res.status(201).json({
        success: true,
        paymentId: outcome.paymentId,
        invoiceId: invoice.id,
        status: "confirmed",
        paidAt: outcome.paidAt.toISOString(),
      });
    } catch (err) {
      if (err instanceof InvoiceNotPayableError) {
        res.status(409).json({
          error: err.message,
          code: "INVOICE_NOT_PAYABLE",
          invoiceStatus: err.invoiceStatus,
        });
        return;
      }
      throw err;
    }
  } catch (error) {
    next(error);
  }
};

export const getPayments = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const merchantId = req.merchantId as string;
    const query = PaymentListQuerySchema.parse(req.query);

    const where: Prisma.PaymentWhereInput = { merchantId };
    if (query.status) where.status = query.status;
    if (query.chainKey) where.chainKey = query.chainKey;
    if (query.invoiceId) where.invoiceId = query.invoiceId;

    const orderBy: Prisma.PaymentOrderByWithRelationInput = {
      [query.sortBy]: query.sortOrder,
    };

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
};

export const getPaymentDetails = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
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
};
