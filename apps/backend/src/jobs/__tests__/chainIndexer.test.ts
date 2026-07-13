import { sweepPendingInvoices, startChainIndexer, stopChainIndexer } from '../chainIndexer';
import { prisma } from '../../lib/prisma';
import { fetchGoldrushTransactions } from '../../services/goldrush';
import { processPaymentMatch } from '../../services/paymentProcessor';
import { withRedisLock } from '../../lib/redisLock';

jest.mock('../../lib/prisma', () => ({
  prisma: {
    invoice: { findMany: jest.fn() }
  }
}));

jest.mock('../../services/goldrush', () => ({
  fetchGoldrushTransactions: jest.fn()
}));

jest.mock('../../services/paymentProcessor', () => ({
  processPaymentMatch: jest.fn()
}));

jest.mock('../../lib/redisLock', () => ({
  withRedisLock: jest.fn((key, ttl, cb) => cb())
}));

describe('chainIndexer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('sweepPendingInvoices', () => {
    it('should do nothing if no pending invoices', async () => {
      (prisma.invoice.findMany as jest.Mock).mockResolvedValue([]);
      await sweepPendingInvoices();
      expect(fetchGoldrushTransactions).not.toHaveBeenCalled();
    });

    it('should process payment match when tx is found', async () => {
      (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'inv1',
          merchantId: 'merch1',
          chainKey: 'solana',
          amount: '100',
          tokenSymbol: 'USDC',
          privacyLevel: 'standard',
          paymentAddress: 'addr1'
        }
      ]);
      (fetchGoldrushTransactions as jest.Mock).mockResolvedValue([
        {
          amount: '100',
          tokenSymbol: 'USDC',
          txHash: 'hash1',
          toAddress: 'addr1',
          fromAddress: 'payer',
        }
      ]);
      await sweepPendingInvoices();
      expect(fetchGoldrushTransactions).toHaveBeenCalledWith('solana', 'addr1');
      expect(processPaymentMatch).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'inv1' }),
        expect.objectContaining({ txHash: 'hash1' })
      );
    });

    it('does not match amount/symbol when toAddress is not the payment address', async () => {
      (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'inv1',
          merchantId: 'merch1',
          chainKey: 'solana',
          amount: '100',
          tokenSymbol: 'USDC',
          privacyLevel: 'standard',
          paymentAddress: 'addr1',
        },
      ]);
      (fetchGoldrushTransactions as jest.Mock).mockResolvedValue([
        {
          amount: '100',
          tokenSymbol: 'USDC',
          txHash: 'hash-other',
          toAddress: 'someone-else',
          fromAddress: 'payer',
        },
      ]);
      await sweepPendingInvoices();
      expect(processPaymentMatch).not.toHaveBeenCalled();
    });

    it('PERF-002: bounds pending invoice query with take + orderBy + expiry filter', async () => {
      (prisma.invoice.findMany as jest.Mock).mockResolvedValue([]);
      await sweepPendingInvoices();
      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 200,
          orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
          where: expect.objectContaining({
            status: 'pending',
            expiresAt: expect.objectContaining({ gt: expect.any(Date) }),
          }),
        })
      );
    });
  });

  describe('start/stop', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('should set and clear interval', () => {
      startChainIndexer();
      expect(jest.getTimerCount()).toBe(1);
      
      stopChainIndexer();
      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
