import {
  scanForStealthPayments,
  processStealthMatch,
  StealthScanner,
  startStealthScanners,
  deriveStealthAddress,
  computeSharedSecret,
  stealthScannerDeps,
} from '../scanner';
import { prisma } from '../../lib/prisma';
import { enqueueWebhook } from '../../queue';

jest.mock('../../queue', () => ({
  enqueueWebhook: jest.fn(),
}));

const baseMatch = {
  merchantId: 'm1',
  invoiceId: 'inv1',
  chainKey: 'ethereum',
  paymentAddress: '0x123',
  stealthAddress: '0xabc',
  ephemeralPublicKey: 'pub1',
  viewingKey: 'view1',
};

describe('Stealth Scanner Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('stubs', () => {
    it('deriveStealthAddress is not implemented', () => {
      expect(() => deriveStealthAddress('pk', 'sk')).toThrow(
        'Not implemented - requires elliptic curve operations',
      );
    });

    it('computeSharedSecret is not implemented', () => {
      expect(() => computeSharedSecret('eph', 'view')).toThrow(
        'Not implemented - requires ECDH',
      );
    });
  });

  describe('scanForStealthPayments', () => {
    it('should return empty array if no viewing keys', async () => {
      (prisma.chainViewingKey.findMany as jest.Mock).mockResolvedValueOnce([]);
      const matches = await scanForStealthPayments('ethereum', 0, 100);
      expect(matches).toEqual([]);
    });

    it('should skip invoices without paymentAddress', async () => {
      (prisma.chainViewingKey.findMany as jest.Mock).mockResolvedValueOnce([
        { merchantId: 'm1', chainKey: 'ethereum' },
      ]);
      (prisma.invoice.findMany as jest.Mock).mockResolvedValueOnce([
        { id: 'inv1', paymentAddress: '0x123', chainKey: 'ethereum' },
        { id: 'inv2', paymentAddress: null, chainKey: 'ethereum' },
      ]);
      const matches = await scanForStealthPayments('ethereum', 0, 100);
      // checkStealthMatch is a stub returning null
      expect(matches).toEqual([]);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.invoice.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('processStealthMatch', () => {
    it('should record payment and queue webhook if not recorded', async () => {
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb: (tx: typeof prisma) => unknown) =>
        cb(prisma),
      );

      (prisma.payment.findFirst as jest.Mock).mockResolvedValueOnce(null);
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'inv1',
        amount: '100',
        tokenSymbol: 'ETH',
      });
      (prisma.payment.create as jest.Mock).mockResolvedValueOnce({
        id: 'pay1',
        txHash: 'stealth-1234',
      });

      await processStealthMatch(baseMatch);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.payment.create).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.invoice.update).toHaveBeenCalled();
      expect(enqueueWebhook).toHaveBeenCalled();
    });

    it('should not process if payment already recorded', async () => {
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb: (tx: typeof prisma) => unknown) =>
        cb(prisma),
      );
      (prisma.payment.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'pay1' });

      await processStealthMatch(baseMatch);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(enqueueWebhook).not.toHaveBeenCalled();
    });

    it('should no-op when invoice is missing', async () => {
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb: (tx: typeof prisma) => unknown) =>
        cb(prisma),
      );
      (prisma.payment.findFirst as jest.Mock).mockResolvedValueOnce(null);
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValueOnce(null);

      await processStealthMatch(baseMatch);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(enqueueWebhook).not.toHaveBeenCalled();
    });
  });

  describe('StealthScanner class', () => {
    it('should start and stop and catch scan errors from interval', () => {
      jest.useFakeTimers();
      const scanner = new StealthScanner('ethereum');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (scanner as any).scan = (): Promise<void> => Promise.reject(new Error('Scan failed'));

      scanner.start(0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((scanner as any).isRunning).toBe(true);

      jest.advanceTimersByTime(30000);

      scanner.stop();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((scanner as any).isRunning).toBe(false);
      jest.useRealTimers();
    });

    it('should ignore double start', () => {
      const scanner = new StealthScanner('ethereum');
      scanner.start(10);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
      const firstBlock: number = (scanner as any).lastScannedBlock as number;
      scanner.start(999);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((scanner as any).lastScannedBlock).toBe(firstBlock);
      scanner.stop();
    });

    it('should scan and advance cursor', async () => {
      const scanner = new StealthScanner('ethereum');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (scanner as any).lastScannedBlock = 100;

      (prisma.chainViewingKey.findMany as jest.Mock).mockResolvedValueOnce([]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      await (scanner as any).scan();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((scanner as any).lastScannedBlock).toBe(200);
    });

    it('should process matches during scan', async () => {
      const scanner = new StealthScanner('ethereum');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (scanner as any).lastScannedBlock = 0;

      const scanPayments = jest.fn().mockResolvedValueOnce([baseMatch]);
      const processMatch = jest.fn().mockResolvedValueOnce(undefined);
      stealthScannerDeps.scanPayments = scanPayments;
      stealthScannerDeps.processMatch = processMatch;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      await (scanner as any).scan();

      expect(scanPayments).toHaveBeenCalled();
      expect(processMatch).toHaveBeenCalledWith(baseMatch);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((scanner as any).lastScannedBlock).toBe(100);

      stealthScannerDeps.scanPayments = scanForStealthPayments;
      stealthScannerDeps.processMatch = processStealthMatch;
    });

    it('should not advance cursor when scan fails', async () => {
      const scanner = new StealthScanner('ethereum');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (scanner as any).lastScannedBlock = 50;

      stealthScannerDeps.scanPayments = jest
        .fn()
        .mockRejectedValueOnce(new Error('rpc down'));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      await (scanner as any).scan();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((scanner as any).lastScannedBlock).toBe(50);
      stealthScannerDeps.scanPayments = scanForStealthPayments;
    });
  });

  describe('startStealthScanners', () => {
    it('should start scanners for all distinct chain keys', async () => {
      (prisma.chainViewingKey.findMany as jest.Mock).mockResolvedValueOnce([
        { chainKey: 'ethereum' },
        { chainKey: 'solana' },
      ]);
      const scanners = await startStealthScanners();
      expect(scanners.size).toBe(2);
      expect(scanners.has('ethereum')).toBe(true);
      expect(scanners.has('solana')).toBe(true);

      scanners.forEach((s) => s.stop());
    });
  });
});
