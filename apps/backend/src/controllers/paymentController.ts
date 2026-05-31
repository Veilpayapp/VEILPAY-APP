import type { Request, Response, NextFunction } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import type { AuthenticatedRequest } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { enqueueWebhook } from "../jobs/webhookQueue";
import {
  PaymentListQuerySchema,
  PaymentListResponseSchema,
  uuidParamSchema,
} from "../types";

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

export const confirmPayment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = PaymentConfirmBodySchema.parse(req.body);

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

    const invoice = await prisma.invoice.update({
      where: { id: body.invoiceId },
      data: {
        status: "paid",
        paidAt: new Date(),
        paymentTxHash: body.txHash,
      },
    });

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
