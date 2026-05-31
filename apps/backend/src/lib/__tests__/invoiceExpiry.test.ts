import { startInvoiceExpiryWorker, stopInvoiceExpiryWorker } from '../invoiceExpiry';
import { prisma } from '../../lib/prisma';
import { withRedisLock } from '../redisLock';

jest.mock('../../lib/prisma', () => ({
  prisma: {
    invoice: {
      updateMany: jest.fn().mockResolvedValue({ count: 5 })
    }
  }
}));

jest.mock('../redisLock', () => ({
  withRedisLock: jest.fn(async (key, ttl, fn) => {
    return fn();
  })
}));

describe('invoiceExpiry worker', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    stopInvoiceExpiryWorker();
    jest.useRealTimers();
  });

  it('should start worker and process expirations', async () => {
    startInvoiceExpiryWorker();
    
    // Fast-forward interval
    jest.advanceTimersByTime(60000);
    
    // Allow promises to resolve
    await Promise.resolve();
    await Promise.resolve();
    
    expect(withRedisLock).toHaveBeenCalledWith('invoice_expiry', 50000, expect.any(Function));
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith({
      where: {
        status: 'pending',
        expiresAt: { lt: expect.any(Date) }
      },
      data: {
        status: 'expired'
      }
    });
  });

  it('should not start multiple intervals', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    startInvoiceExpiryWorker();
    startInvoiceExpiryWorker();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });
});
