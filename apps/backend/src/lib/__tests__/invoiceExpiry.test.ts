import { startInvoiceExpiryWorker, stopInvoiceExpiryWorker } from '../invoiceExpiry';
import { prisma } from '../../lib/prisma';
import { withRedisLock } from '../redisLock';
import { enqueueWebhook } from '../../jobs/webhookQueue';

jest.mock('../../lib/prisma', () => ({
  prisma: {
    invoice: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    }
  }
}));

jest.mock('../redisLock', () => ({
  withRedisLock: jest.fn(async (key, ttl, fn) => {
    return fn();
  })
}));

jest.mock('../../jobs/webhookQueue', () => ({
  enqueueWebhook: jest.fn().mockResolvedValue(null),
}));

const flushPromises = async () => {
  for (let i = 0; i < 10; i++) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
};

describe('invoiceExpiry worker', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    stopInvoiceExpiryWorker();
    jest.useRealTimers();
  });

  it('expires pending invoices and enqueues invoice.expired webhooks', async () => {
    (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
      { id: 'inv-1', merchantId: 'm1', chainKey: 'ethereum', tokenSymbol: 'ETH', amount: '1.0', privacyLevel: 'standard' },
      { id: 'inv-2', merchantId: 'm2', chainKey: 'solana', tokenSymbol: 'USDC', amount: '5', privacyLevel: 'standard' },
    ]);
    (prisma.invoice.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

    startInvoiceExpiryWorker();
    jest.advanceTimersByTime(60000);
    await flushPromises();

    expect(withRedisLock).toHaveBeenCalledWith('invoice_expiry', 50000, expect.any(Function));
    expect(prisma.invoice.findMany).toHaveBeenCalledWith({
      where: { status: 'pending', expiresAt: { lt: expect.any(Date) } },
      select: expect.any(Object),
    });
    expect(prisma.invoice.updateMany).toHaveBeenCalledTimes(2);
    expect(enqueueWebhook).toHaveBeenCalledTimes(2);
    expect(enqueueWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'invoice.expired', invoiceId: 'inv-1' })
    );
  });

  it('does not enqueue a webhook when the row was already expired by another sweep', async () => {
    (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
      { id: 'inv-1', merchantId: 'm1', chainKey: 'ethereum', tokenSymbol: 'ETH', amount: '1.0', privacyLevel: 'standard' },
    ]);
    (prisma.invoice.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

    startInvoiceExpiryWorker();
    jest.advanceTimersByTime(60000);
    await flushPromises();

    expect(enqueueWebhook).not.toHaveBeenCalled();
  });

  it('should not start multiple intervals', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    startInvoiceExpiryWorker();
    startInvoiceExpiryWorker();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });
});
