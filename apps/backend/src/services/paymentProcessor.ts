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
  | { kind: 'created'; paymentId: string }
  | { kind: 'idempotent'; paymentId: string };

/**
 * Internal sentinel thrown inside the transaction when a concurrent request
 * has already flipped the invoice from `pending` → `paid`. The caller catches
 * it the same way P2002 is handled and returns the idempotent outcome.
 *
 * This closes the double-payment race where two concurrent confirms with
 * DIFFERENT txHashes for the same invoice both pass the controller's
 * out-of-transaction `status === "pending"` check, both create distinct
 * Payment rows (no P2002 because the unique key `(chainKey, txHash)`
 * differs), and both fire webhooks.
 */
class InvoiceAlreadyPaidError extends Error {
  constructor() {
    super('Invoice already paid by a concurrent request');
    this.name = 'InvoiceAlreadyPaidError';
  }
}

/**
 * Atomically record a confirmed payment against `invoice`, mark the invoice
 * paid, and enqueue the merchant webhook.
 *
 * DATA-003 / REL-001 fix: the Payment create + Invoice update now run inside
 * a single `prisma.$transaction` so a crash between them can no longer leave
 * a Payment row pointing at an still-pending Invoice.
 *
 * Idempotent by `(chainKey, txHash)`: a duplicate submission for the same
 * transaction hash returns `{ kind: 'idempotent' }` without re-mutating the
 * invoice or re-firing the webhook. A concurrent duplicate that loses the
 * create race surfaces as Prisma P2002 and is converted to the same
 * idempotent outcome.
 *
 * The webhook is enqueued AFTER the DB transaction commits so a Redis/queue
 * outage never rolls back committed payment state. `enqueueWebhook` has its
 * own DB fallback that persists a failed delivery row when the queue is down.
 *
 * Callers are responsible for validating invoice ownership and chain
 * parameters BEFORE calling this helper — the indexer trusts its own chain
 * reads; the HTTP controller validates merchant auth then
 * `verifyPaymentTxOnChain` (SEC-001 residual) before calling this helper.
 */
export async function confirmInvoicePayment(
  invoice: InvoiceContext,
  tx: PaymentTxInput
): Promise<ProcessPaymentOutcome> {
  // No pre-check findUnique: the `@@unique([chainKey, txHash])` constraint
  // is the authoritative dedupe guard, and the P2002 catch below converts a
  // duplicate create into the idempotent outcome. A pre-check would add a
  // guaranteed DB round trip on the happy path — the indexer (high-frequency
  // caller) rarely sees duplicates, so the transaction + P2002 path is
  // cheaper overall than findUnique + transaction for the common case.
  try {
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

      // CRITICAL fix: make the `pending → paid` transition conditional INSIDE
      // the transaction so a concurrent confirm with a DIFFERENT txHash
      // cannot also flip the invoice and double-fire the webhook. The
      // unique constraint `@@unique([chainKey, txHash])` only dedupes the
      // SAME txHash — it does not prevent two distinct txHashes from
      // double-paying one invoice. `updateMany` with a `status: 'pending'`
      // predicate is atomic within the transaction: if `count === 0`, a
      // concurrent request already paid it.
      const updateResult = await txClient.invoice.updateMany({
        where: { id: invoice.id, status: 'pending' },
        data: {
          status: 'paid',
          paidAt: new Date(),
          paymentTxHash: tx.txHash,
        },
      });
      if (updateResult.count === 0) {
        throw new InvoiceAlreadyPaidError();
      }

      return payment;
    });

    // Webhook enqueued after commit (see function doc).
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

    return { kind: 'created', paymentId: created.id };
  } catch (err) {
    // P2002 = unique constraint violation on `(chainKey, txHash)` → a
    // concurrent request with the SAME txHash won the race. Re-read and
    // return the idempotent outcome.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      const raced = await prisma.payment.findUnique({
        where: { chainKey_txHash: { chainKey: invoice.chainKey, txHash: tx.txHash } },
        select: { id: true },
      });
      if (raced) {
        return { kind: 'idempotent', paymentId: raced.id };
      }
    }

    // InvoiceAlreadyPaidError = a concurrent request with a DIFFERENT txHash
    // already flipped the invoice to `paid` inside its own transaction. Find
    // the winning Payment by the invoice id and return the idempotent
    // outcome so this request does NOT create a duplicate Payment or fire a
    // second webhook.
    if (err instanceof InvoiceAlreadyPaidError) {
      const winner = await prisma.payment.findFirst({
        where: { invoiceId: invoice.id, status: 'confirmed' },
        select: { id: true },
        orderBy: { timestamp: 'desc' },
      });
      if (winner) {
        return { kind: 'idempotent', paymentId: winner.id };
      }
    }

    throw err;
  }
}

/**
 * Indexer entry point — retained for backward compatibility with the
 * Goldrush chain indexer that calls this directly (no HTTP hop). The
 * indexer has already matched the on-chain tx to the invoice, so it
 * delegates to the shared transactional helper.
 */
export async function processPaymentMatch(
  invoice: InvoiceContext,
  tx: GoldrushTxResponse
): Promise<void> {
  await confirmInvoicePayment(invoice, tx);
}
