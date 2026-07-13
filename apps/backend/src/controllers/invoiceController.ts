import type { Response, NextFunction } from "express";
import type { Prisma } from "@prisma/client";
import type { AuthenticatedRequest } from "../middleware/auth";
import { prisma } from "../lib/prisma";
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
import { verifyPaymentTxOnChain } from "../services/paymentTxVerifier";
import {
  confirmInvoicePayment,
  InvoiceNotPayableError,
} from "../services/paymentProcessor";
import {
  expectedTokenAddressForInvoice,
  isNativeTokenSymbol,
} from "../lib/tokenRegistry";

export const getInvoices = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const merchantId = req.merchantId as string;
    const query = InvoiceListQuerySchema.parse(req.query);

    const where: Prisma.InvoiceWhereInput = { merchantId };
    if (query.status) where.status = query.status;
    if (query.chainKey) where.chainKey = query.chainKey;

    const orderBy: Prisma.InvoiceOrderByWithRelationInput = {
      [query.sortBy]: query.sortOrder,
    };

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
};

export const createInvoice = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
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

    // Bind ERC-20 identity at create time so verification never trusts symbol alone.
    let tokenAddress: string | null = data.tokenAddress ?? null;
    if (!isNativeTokenSymbol(data.tokenSymbol)) {
      tokenAddress = expectedTokenAddressForInvoice({
        chainKey: data.chainKey,
        tokenSymbol: data.tokenSymbol,
        tokenAddress: data.tokenAddress,
      });
      if (!tokenAddress) {
        res.status(400).json({
          error:
            "tokenAddress is required for non-native tokens not in the chain registry",
          code: "TOKEN_ADDRESS_REQUIRED",
        });
        return;
      }
    } else {
      tokenAddress = null;
    }

    const expiresAt = new Date(Date.now() + data.expiresInMinutes * 60 * 1000);

    const invoice = await prisma.invoice.create({
      data: {
        merchantId,
        chainKey: data.chainKey,
        tokenSymbol: data.tokenSymbol,
        tokenAddress,
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
};

export const getInvoiceStatus = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = uuidParamSchema.parse(req.params);

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
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
};

export const getInvoiceDetails = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
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
};

export const cancelInvoice = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
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
};

export const payInvoice = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
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

    if (invoice.merchantId !== req.merchantId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    if (invoice.status !== "pending") {
      res.status(409).json({ error: "Invoice is not pending" });
      return;
    }

    // SEC-002: route this endpoint through the SAME on-chain verifier and
    // transactional processor as `/api/v1/payment/confirm`. This endpoint only
    // receives a `txHash`, so the claimed payment facts are taken from the
    // invoice itself; the real check is `verifyPaymentTxOnChain`, which fetches
    // the transaction (EVM) or indexer history (non-EVM) and confirms the
    // recipient, amount, and token before any state is mutated. This closes the
    // previous weaker path that skipped verification entirely for non-EVM
    // chains and never deduped a txHash across invoices.
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
        fromAddress: "",
        toAddress: invoice.paymentAddress ?? "",
        amount: String(invoice.amount),
        tokenSymbol: invoice.tokenSymbol,
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

      res.json({
        invoiceId: invoice.id,
        status: "paid",
        paidAt: outcome.paidAt ? outcome.paidAt.toISOString() : null,
        paymentId: outcome.paymentId,
        idempotent: outcome.kind === "idempotent",
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
