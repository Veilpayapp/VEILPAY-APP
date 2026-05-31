import { processPaymentMatch } from '../paymentProcessor';
import { prisma } from '../../lib/prisma';
import { enqueueWebhook } from '../../jobs/webhookQueue';
import { PrivacyLevel } from '@prisma/client';

jest.mock('../../lib/prisma', () => ({
  prisma: {
    payment: { create: jest.fn() },
    invoice: { update: jest.fn() }
  }
}));

jest.mock('../../jobs/webhookQueue', () => ({
  enqueueWebhook: jest.fn()
}));

describe('paymentProcessor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should process payment match correctly', async () => {
    const invoice = {
      id: 'inv-123',
      merchantId: 'merch-123',
      chainKey: 'solana',
      tokenSymbol: 'USDC',
      amount: '100',
      privacyLevel: PrivacyLevel.standard
    };
    const tx = {
      txHash: 'hash-123',
      fromAddress: 'from-123',
      toAddress: 'to-123',
      amount: '100',
      tokenSymbol: 'USDC',
      blockNumber: 12345
    };

    await processPaymentMatch(invoice, tx);

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
      }
    });

    expect(prisma.invoice.update).toHaveBeenCalledWith({
      where: { id: invoice.id },
      data: {
        status: 'paid',
        paidAt: expect.any(Date),
        paymentTxHash: tx.txHash,
      }
    });

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
});
