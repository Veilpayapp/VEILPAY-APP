import {
  runDriftCheck,
  startDriftCheckScheduler,
  stopDriftCheckScheduler,
  STUCK_WEBHOOK_DELIVERY_AGE_MS,
} from '../driftCheck';
import { prisma } from '../../lib/prisma';
import type { ScannedPayment, ScannedInvoice } from '../settlementReconciliation';

function healthyPayment(overrides: Partial<ScannedPayment> = {}): ScannedPayment {
  return {
    id: 'pay-1',
    invoiceId: 'inv-1',
    merchantId: 'm-1',
    chainKey: 'ethereum',
    txHash: '0x' + 'ab'.repeat(32),
    toAddress: '0x' + 'cd'.repeat(20),
    amount: '1000',
    tokenSymbol: 'USDC',
    status: 'confirmed',
    timestamp: new Date('2026-09-01T12:00:00Z'),
    ...overrides,
  };
}

function healthyInvoice(overrides: Partial<ScannedInvoice> = {}): ScannedInvoice {
  return {
    id: 'inv-1',
    merchantId: 'm-1',
    chainKey: 'ethereum',
    tokenSymbol: 'USDC',
    tokenAddress: null,
    amount: '1000',
    status: 'paid',
    paymentTxHash: '0x' + 'ab'.repeat(32),
    ...overrides,
  };
}

const stuckRow = {
  id: 'wd-stuck',
  merchantId: 'm-1',
  eventType: 'payment.received',
  createdAt: new Date('2026-09-01T00:00:00Z'),
  retryCount: 3,
};

describe('runDriftCheck', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.payment.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.invoice.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.webhookDelivery.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.webhookDelivery.count as jest.Mock).mockResolvedValue(0);
  });

  it('reports a clean system with no drift', async () => {
    (prisma.payment.findMany as jest.Mock).mockResolvedValue([healthyPayment()]);
    (prisma.invoice.findMany as jest.Mock).mockResolvedValue([healthyInvoice()]);

    const report = await runDriftCheck();

    expect(report.scannedPayments).toBe(1);
    expect(report.scannedInvoices).toBe(1);
    expect(report.settlementDrift).toEqual([]);
    expect(report.orphanPayments).toEqual([]);
    expect(report.stuckWebhookDeliveries).toEqual([]);
    expect(report.failedWebhookDeliveryCount).toBe(0);
  });

  it('reports settlement drift findings and orphan payments', async () => {
    (prisma.payment.findMany as jest.Mock).mockResolvedValue([
      // base-units disease row + an orphan
      healthyPayment({ amount: '1000000000', tokenSymbol: '0x' + 'cd'.repeat(20) }),
      healthyPayment({ id: 'pay-2', invoiceId: 'inv-missing' }),
    ]);
    (prisma.invoice.findMany as jest.Mock).mockResolvedValue([healthyInvoice()]);

    const report = await runDriftCheck();

    expect(report.settlementDrift.length).toBeGreaterThan(0);
    expect(report.settlementDrift[0].kind).toBe('payment-token-symbol-is-address');
    expect(report.orphanPayments).toEqual([{ paymentId: 'pay-2', invoiceId: 'inv-missing' }]);
  });

  it('(f) reports WebhookDelivery rows stuck undelivered (pending past the age threshold)', async () => {
    (prisma.webhookDelivery.findMany as jest.Mock).mockResolvedValue([stuckRow]);
    (prisma.webhookDelivery.count as jest.Mock).mockResolvedValue(7);

    const report = await runDriftCheck();

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.webhookDelivery.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'pending',
          createdAt: expect.objectContaining({ lt: expect.any(Date) }),
        }),
      }),
    );
    expect(report.stuckWebhookDeliveries).toEqual([stuckRow]);
    expect(report.failedWebhookDeliveryCount).toBe(7);
  });

  it('uses the default 10-minute stuck threshold unless overridden', async () => {
    const before = Date.now();
    await runDriftCheck();
    const cutoff = (prisma.webhookDelivery.findMany as jest.Mock).mock.calls[0][0].where
      .createdAt.lt as Date;

    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - STUCK_WEBHOOK_DELIVERY_AGE_MS - 5);
    expect(cutoff.getTime()).toBeLessThanOrEqual(before - STUCK_WEBHOOK_DELIVERY_AGE_MS + 5000);
  });

  it('honors the stuckAgeMs override (tests use small values)', async () => {
    await runDriftCheck({ stuckAgeMs: 1000 });
    const call = (prisma.webhookDelivery.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where.createdAt.lt).toBeInstanceOf(Date);
    expect(Date.now() - (call.where.createdAt.lt as Date).getTime()).toBeGreaterThanOrEqual(1000);
  });

  it('is read-only: never writes to any table', async () => {
    (prisma.payment.findMany as jest.Mock).mockResolvedValue([
      healthyPayment({ amount: '1000000000' }),
    ]);
    (prisma.invoice.findMany as jest.Mock).mockResolvedValue([healthyInvoice({ status: 'pending' })]);
    (prisma.webhookDelivery.findMany as jest.Mock).mockResolvedValue([stuckRow]);

    await runDriftCheck();

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.payment.update).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.invoice.update).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.webhookDelivery.update).not.toHaveBeenCalled();
  });
});

describe('startDriftCheckScheduler (config-gated, default OFF)', () => {
  afterEach(() => {
    stopDriftCheckScheduler(null);
    jest.useRealTimers();
  });

  it('returns null for 0 (the config default — disabled), negative and NaN intervals', () => {
    expect(startDriftCheckScheduler(0)).toBeNull();
    expect(startDriftCheckScheduler(-1000)).toBeNull();
    expect(startDriftCheckScheduler(Number.NaN)).toBeNull();
    expect(startDriftCheckScheduler(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('runs the drift check on the interval and stops cleanly', async () => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    (prisma.payment.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.webhookDelivery.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.webhookDelivery.count as jest.Mock).mockResolvedValue(0);

    const timer = startDriftCheckScheduler(60_000);
    expect(timer).not.toBeNull();

    // not run yet at t=0
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.payment.findMany).not.toHaveBeenCalled();

    jest.advanceTimersByTime(60_000);
    // the interval callback invoked runDriftCheck synchronously up to the
    // first prisma call
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.payment.findMany).toHaveBeenCalledTimes(1);

    stopDriftCheckScheduler(timer);
    jest.advanceTimersByTime(120_000);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.payment.findMany).toHaveBeenCalledTimes(1);
  });
});
