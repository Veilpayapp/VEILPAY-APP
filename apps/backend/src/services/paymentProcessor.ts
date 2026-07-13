import { prisma } from '../lib/prisma';
import { Prisma, type PrivacyLevel } from '@prisma/client';
import { enqueueWebhook } from '../jobs/webhookQueue';
import type { GoldrushTxResponse } from './goldrush';

interface InvoiceContext {
  id: string;
  merchantId: string;
  chainKey: string;
  tokenSymbol: string;
  amount: number | string;
  privacyLevel: PrivacyLevel;
}

export interface PaymentTxInput {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
  tokenSymbol: string;
  blockNumber?: number;
}

export type ProcessPaymentOutcome =
  | { kind: 'created'; paymentId: string; paidAt: Date }
  | { kind: 'idempotent'; paymentId: string; paidAt: Date | null };

/**
 * Internal sentinel: concurrent request already flipped invoice off `pending`
 * (paid), OR invoice was expired/cancelled mid-flight.
 */
class InvoiceStatusRaceError extends Error {
  constructor() {
    super('Invoice is no longer pending');
    this.name = 'InvoiceStatusRaceError';
  }
}

/**
 * Thrown when pay races with expiry/cancel and there is no winning payment.
 * Controllers map this to HTTP 409.
 */
export class InvoiceNotPayableError extends Error {
  readonly status: number = 409;
  readonly invoiceStatus: string;

  constructor(invoiceStatus: string) {
    super(`Invoice is ${invoiceStatus} and cannot accept payment`);
    this.name = 'InvoiceNotPayableError';
    this.invoiceStatus = invoiceStatus;
  }
}

/**
 * Atomically record a confirmed payment against `invoice`, mark the invoice
 * paid, and enqueue the merchant webhook.
 *
 * DATA-003 / REL-001 fix: the Payment create + Invoice update run inside
 * a single `prisma.$transaction`.
 *
 * Idempotent by `(chainKey, txHash)`. Concurrent different-txHash races that
 * lose the pending→paid update resolve to the winning payment. If the invoice
 * was expired/cancelled instead, throws `InvoiceNotPayableError` (409).
 */
export async function confirmInvoicePayment(
  invoice: InvoiceContext,
  tx: PaymentTxInput
): Promise<ProcessPaymentOutcome> {
  try {
    const paidAt = new Date();
    const created = await prisma.$transaction(async (txClient) => {
      const payment = await txClient.payment.create({
        data: {
          invoiceId: invoice.id,
          merchantId: invoice.merchantId,
          chainKey: invoice.chainKey,
          txHash: tx.txHash,
          fromAddress: tx.fromAddress,
          toAddress: tx.toAddress,
          amount: tx.amount,
          tokenSymbol: tx.tokenSymbol,
          privacyLevel: invoice.privacyLevel,
          status: 'confirmed',
          blockNumber: tx.blockNumber,
        },
        select: { id: true },
      });

      const updateResult = await txClient.invoice.updateMany({
        where: { id: invoice.id, status: 'pending' },
        data: {
          status: 'paid',
          paidAt,
          paymentTxHash: tx.txHash,
        },
      });
      if (updateResult.count === 0) {
        throw new InvoiceStatusRaceError();
      }

      return payment;
    });

    await enqueueWebhook({
      eventType: 'payment.received',
      merchantId: invoice.merchantId,
      invoiceId: invoice.id,
      chainKey: invoice.chainKey,
      tokenSymbol: tx.tokenSymbol,
      amount: tx.amount,
      privacyLevel: invoice.privacyLevel,
      timestamp: Date.now(),
    });

    return { kind: 'created', paymentId: created.id, paidAt };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      const raced = await prisma.payment.findUnique({
        where: { chainKey_txHash: { chainKey: invoice.chainKey, txHash: tx.txHash } },
        select: { id: true },
      });
      if (raced) {
        const inv = await prisma.invoice.findUnique({
          where: { id: invoice.id },
          select: { paidAt: true },
        });
        return { kind: 'idempotent', paymentId: raced.id, paidAt: inv?.paidAt ?? null };
      }
    }

    if (err instanceof InvoiceStatusRaceError) {
      const winner = await prisma.payment.findFirst({
        where: { invoiceId: invoice.id, status: 'confirmed' },
        select: { id: true },
        orderBy: { timestamp: 'desc' },
      });
      if (winner) {
        const inv = await prisma.invoice.findUnique({
          where: { id: invoice.id },
          select: { paidAt: true },
        });
        return { kind: 'idempotent', paymentId: winner.id, paidAt: inv?.paidAt ?? null };
      }

      // No winning payment → likely expired/cancelled during the race.
      const current = await prisma.invoice.findUnique({
        where: { id: invoice.id },
        select: { status: true },
      });
      const status = current?.status ?? 'unknown';
      if (status === 'paid') {
        // Paid without a payment row is inconsistent; still avoid 500.
        throw new InvoiceNotPayableError('paid');
      }
      throw new InvoiceNotPayableError(status);
    }

    throw err;
  }
}

/**
 * Indexer entry point — delegates to the shared transactional helper.
 */
export async function processPaymentMatch(
  invoice: InvoiceContext,
  tx: GoldrushTxResponse
): Promise<void> {
  await confirmInvoicePayment(invoice, tx);
}
