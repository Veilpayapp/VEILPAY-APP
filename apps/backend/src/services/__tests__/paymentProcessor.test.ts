import { processPaymentMatch, confirmInvoicePayment } from '../paymentProcessor';
import { prisma } from '../../lib/prisma';
import { enqueueWebhook } from '../../jobs/webhookQueue';
import { PrivacyLevel, Prisma } from '@prisma/client';

// We mock the $transaction to invoke its callback with the same prisma mock so
// the create + update run "atomically" in the test harness. `mock` is typed
// `any` to avoid the self-referential type inference that `typeof mock` would
// create through the $transaction callback signature.
jest.mock('../../lib/prisma', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mock: any = {
    payment: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    invoice: {
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  return { prisma: mock };
});

jest.mock('../../jobs/webhookQueue', () => ({
  enqueueWebhook: jest.fn(),
}));

describe('paymentProcessor (DATA-003: transactional + idempotent)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    // Re-establish the default $transaction behavior: invoke the callback
    // with the prisma mock so create + update run "inside" the transaction.
    (prisma.$transaction as jest.Mock).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (fn: (tx: any) => Promise<unknown>) => fn(prisma)
    );
  });

  const invoice = {
    id: 'inv-123',
    merchantId: 'merch-123',
    chainKey: 'solana',
    tokenSymbol: 'USDC',
    amount: '100',
    privacyLevel: PrivacyLevel.standard,
  };

  const tx = {
    txHash: 'hash-123',
    fromAddress: 'from-123',
    toAddress: 'to-123',
    amount: '100',
    tokenSymbol: 'USDC',
    blockNumber: 12345,
  };

  describe('confirmInvoicePayment', () => {
    it('creates payment + updates invoice atomically and enqueues webhook', async () => {
      (prisma.payment.create as jest.Mock).mockResolvedValue({ id: 'pay-1' });
      (prisma.invoice.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      const outcome = await confirmInvoicePayment(invoice, tx);

      expect(outcome).toEqual({ kind: 'created', paymentId: 'pay-1' });

      // The create + invoice.updateMany MUST run inside the same $transaction.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.payment.create).toHaveBeenCalledWith({
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
      // CRITICAL fix: the invoice transition is conditional on `status: 'pending'`.
      expect(prisma.invoice.updateMany).toHaveBeenCalledWith({
        where: { id: invoice.id, status: 'pending' },
        data: {
          status: 'paid',
          paidAt: expect.any(Date),
          paymentTxHash: tx.txHash,
        },
      });

      // Webhook enqueued AFTER commit, exactly once.
      expect(enqueueWebhook).toHaveBeenCalledTimes(1);
      expect(enqueueWebhook).toHaveBeenCalledWith({
        eventType: 'payment.received',
        merchantId: invoice.merchantId,
        invoiceId: invoice.id,
        chainKey: invoice.chainKey,
        tokenSymbol: tx.tokenSymbol,
        amount: tx.amount,
        privacyLevel: invoice.privacyLevel,
        timestamp: expect.any(Number),
      });
    });

    it('returns idempotent when the txHash already has a payment (P2002 race)', async () => {
      // The create throws P2002 (unique constraint on chainKey+txHash); the
      // catch re-reads and returns the idempotent outcome. No pre-check
      // findUnique — the unique constraint is the authoritative guard.
      (prisma.payment.create as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: '5.12.0',
        })
      );
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue({ id: 'pay-existing' });
      (prisma.$transaction as jest.Mock).mockImplementationOnce(
        async (fn: any) => fn(prisma)
      );

      const outcome = await confirmInvoicePayment(invoice, tx);

      expect(outcome).toEqual({ kind: 'idempotent', paymentId: 'pay-existing' });
      // Must NOT fire a webhook on the idempotent path.
      expect(enqueueWebhook).not.toHaveBeenCalled();
    });

    it('CRITICAL: converts a concurrent different-txHash race into idempotent (no double webhook)', async () => {
      // Two concurrent confirms with DIFFERENT txHashes for the same invoice.
      // This request's Payment create succeeds, but the invoice.updateMany
      // returns count=0 because a concurrent request already flipped the
      // invoice to 'paid' inside its own transaction. The transaction throws
      // InvoiceAlreadyPaidError; the catch block re-reads the winning Payment
      // by invoiceId and returns idempotent WITHOUT creating a second
      // Payment or firing a second webhook.
      (prisma.payment.create as jest.Mock).mockResolvedValue({ id: 'pay-loser' });
      (prisma.invoice.updateMany as jest.Mock).mockResolvedValue({ count: 0 }); // concurrent winner
      (prisma.payment.findFirst as jest.Mock).mockResolvedValue({ id: 'pay-winner' });
      (prisma.$transaction as jest.Mock).mockImplementationOnce(
        async (fn: any) => fn(prisma)
      );

      const outcome = await confirmInvoicePayment(invoice, tx);

      expect(outcome).toEqual({ kind: 'idempotent', paymentId: 'pay-winner' });
      // Must NOT fire a webhook — the winning request already did.
      expect(enqueueWebhook).not.toHaveBeenCalled();
      // Must look up the winning Payment by invoiceId (not chainKey_txHash).
      expect(prisma.payment.findFirst).toHaveBeenCalledWith({
        where: { invoiceId: invoice.id, status: 'confirmed' },
        select: { id: true },
        orderBy: { timestamp: 'desc' },
      });
    });

    it('converts a concurrent P2002 race into idempotent (no double webhook)', async () => {
      // The create throws P2002 (same txHash already exists); the catch
      // re-reads and returns the idempotent outcome.
      (prisma.payment.create as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: '5.12.0',
        })
      );
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue({ id: 'pay-raced' });
      (prisma.$transaction as jest.Mock).mockImplementationOnce(
        async (fn: any) => fn(prisma)
      );

      const outcome = await confirmInvoicePayment(invoice, tx);

      expect(outcome).toEqual({ kind: 'idempotent', paymentId: 'pay-raced' });
      expect(enqueueWebhook).not.toHaveBeenCalled();
    });

    it('rethrows non-P2002 errors', async () => {
      (prisma.payment.create as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Connection refused', {
          code: 'P1001',
          clientVersion: '5.12.0',
        })
      );
      (prisma.$transaction as jest.Mock).mockImplementationOnce(
        async (fn: any) => fn(prisma)
      );

      await expect(confirmInvoicePayment(invoice, tx)).rejects.toThrow('Connection refused');
      expect(enqueueWebhook).not.toHaveBeenCalled();
    });

    it('rethrows generic (non-Prisma) errors', async () => {
      (prisma.payment.create as jest.Mock).mockRejectedValue(new Error('unexpected'));
      (prisma.$transaction as jest.Mock).mockImplementationOnce(
        async (fn: any) => fn(prisma)
      );

      await expect(confirmInvoicePayment(invoice, tx)).rejects.toThrow('unexpected');
      expect(enqueueWebhook).not.toHaveBeenCalled();
    });
  });

  describe('processPaymentMatch (indexer entry point)', () => {
    it('delegates to confirmInvoicePayment', async () => {
      (prisma.payment.create as jest.Mock).mockResolvedValue({ id: 'pay-1' });
      (prisma.invoice.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      await processPaymentMatch(invoice, tx as any);

      expect(prisma.payment.create).toHaveBeenCalled();
      expect(prisma.invoice.updateMany).toHaveBeenCalled();
      expect(enqueueWebhook).toHaveBeenCalled();
    });
  });
});
