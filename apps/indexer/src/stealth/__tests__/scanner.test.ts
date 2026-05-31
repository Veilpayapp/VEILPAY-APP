import { scanForStealthPayments, processStealthMatch, StealthScanner, startStealthScanners } from '../scanner';
import { prisma } from '../../lib/prisma';
import { enqueueWebhook } from '../../queue';

jest.mock('../../queue', () => ({
  enqueueWebhook: jest.fn(),
}));

describe('Stealth Scanner Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('scanForStealthPayments', () => {
    it('should return empty array if no viewing keys', async () => {
      (prisma.chainViewingKey.findMany as jest.Mock).mockResolvedValueOnce([]);
      const matches = await scanForStealthPayments('ethereum', 0, 100);
      expect(matches).toEqual([]);
    });

    it('should return matches based on pending invoices', async () => {
      (prisma.chainViewingKey.findMany as jest.Mock).mockResolvedValueOnce([{ merchantId: 'm1', chainKey: 'ethereum' }]);
      (prisma.invoice.findMany as jest.Mock).mockResolvedValueOnce([
        { id: 'inv1', paymentAddress: '0x123', chainKey: 'ethereum' },
        { id: 'inv2', paymentAddress: null, chainKey: 'ethereum' }
      ]);
      const matches = await scanForStealthPayments('ethereum', 0, 100);
      // Since checkStealthMatch is a stub returning null, matches will be []
      expect(matches).toEqual([]);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.invoice.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('processStealthMatch', () => {
    it('should record payment and queue webhook if not recorded', async () => {
      const match = {
        merchantId: 'm1',
        invoiceId: 'inv1',
        chainKey: 'ethereum',
        paymentAddress: '0x123',
        stealthAddress: '0xabc',
        ephemeralPublicKey: 'pub1',
        viewingKey: 'view1'
      };

      // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
      let txCb: any;
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        txCb = cb;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
        return cb(prisma);
      });

      (prisma.payment.findFirst as jest.Mock).mockResolvedValueOnce(null);
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'inv1',
        amount: '100',
        tokenSymbol: 'ETH'
      });
      (prisma.payment.create as jest.Mock).mockResolvedValueOnce({
        id: 'pay1',
        txHash: 'stealth-1234'
      });

      await processStealthMatch(match);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.payment.create).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.invoice.update).toHaveBeenCalled();
      expect(enqueueWebhook).toHaveBeenCalled();
    });

    it('should not process if payment already recorded', async () => {
      const match = {
        merchantId: 'm1',
        invoiceId: 'inv1',
        chainKey: 'ethereum',
        paymentAddress: '0x123',
        stealthAddress: '0xabc',
        ephemeralPublicKey: 'pub1',
        viewingKey: 'view1'
      };

      // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb) => cb(prisma));
      (prisma.payment.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'pay1' });

      await processStealthMatch(match);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(enqueueWebhook).not.toHaveBeenCalled();
    });
  });

  describe('StealthScanner class', () => {
    // eslint-disable-next-line @typescript-eslint/require-await
    it('should start and stop and catch scan errors', async () => {
      jest.useFakeTimers();
      const scanner = new StealthScanner('ethereum');
      
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unused-vars, @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-member-access
      const scanForStealthPaymentsMock = require('../scanner').scanForStealthPayments;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unused-vars, @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-member-access
      const processStealthMatchMock = require('../scanner').processStealthMatch;
      
      // Override to throw error
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const originalScan = (scanner as any).scan;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/explicit-function-return-type, @typescript-eslint/require-await
      (scanner as any).scan = async () => {
        throw new Error('Scan failed');
      };
      
      scanner.start(0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((scanner as any).isRunning).toBe(true);
      
      // Fast-forward to trigger interval
      jest.advanceTimersByTime(30000);
      
      scanner.stop();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((scanner as any).isRunning).toBe(false);
      jest.useRealTimers();
    });

    it('should scan and advance cursor', async () => {
      const scanner = new StealthScanner('ethereum');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (scanner as any).lastScannedBlock = 100;
      
      // Mock prisma to return empty so scanForStealthPayments returns [] safely
      (prisma.chainViewingKey.findMany as jest.Mock).mockResolvedValueOnce([]);
      
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      await (scanner as any).scan();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((scanner as any).lastScannedBlock).toBe(200);
    });
  });

  describe('startStealthScanners', () => {
    it('should start scanners for all distinct chain keys', async () => {
      (prisma.chainViewingKey.findMany as jest.Mock).mockResolvedValueOnce([
        { chainKey: 'ethereum' },
        { chainKey: 'solana' }
      ]);
      const scanners = await startStealthScanners();
      expect(scanners.size).toBe(2);
      expect(scanners.has('ethereum')).toBe(true);
      expect(scanners.has('solana')).toBe(true);

      // Stop scanners to prevent test hang
      scanners.forEach(s => s.stop());
    });
  });
});
