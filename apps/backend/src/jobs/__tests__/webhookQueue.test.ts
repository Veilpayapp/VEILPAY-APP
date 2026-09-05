import { Queue } from 'bullmq';

jest.mock('bullmq', () => {
  const getJobMock = jest.fn().mockResolvedValue(null);
  return {
    Queue: jest.fn().mockImplementation(() => ({
      add: jest.fn().mockResolvedValue({ id: 'job123' }),
      getJob: getJobMock,
      close: jest.fn().mockResolvedValue(undefined),
    })),
    __getJobMock: getJobMock,
  };
});

jest.mock('../../lib/redis', () => ({
  getRedisClient: jest.fn(),
  getRedisInitError: jest.fn().mockReturnValue('Mock Redis Error'),
}));

jest.mock('../../lib/prisma', () => ({
  prisma: {
    webhookDelivery: {
      create: jest.fn().mockResolvedValue({ id: 'delivery-1' }),
      update: jest.fn().mockResolvedValue({ id: 'delivery-1' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
  },
}));

jest.mock('../../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }
}));

describe('webhookQueue', () => {
  let webhookQueue: typeof import('../webhookQueue');
  let getRedisClientMock: jest.Mock;
  let prismaMock: any;
  let bullmqMock: any;

  beforeEach(async () => {
    jest.resetModules();
    getRedisClientMock = require('../../lib/redis').getRedisClient;
    prismaMock = require('../../lib/prisma').prisma;
    bullmqMock = require('bullmq');
    webhookQueue = await import('../webhookQueue');
    bullmqMock.__getJobMock.mockClear();
    bullmqMock.__getJobMock.mockResolvedValue(null);
  });

  afterEach(async () => {
    if (webhookQueue) {
      await webhookQueue.closeWebhookQueue();
    }
  });

  it('should initialize queue if redis client is available', async () => {
    getRedisClientMock.mockReturnValue({ status: 'ready' });
    
    expect(webhookQueue.initializeWebhookQueue()).toBe(true);
    expect(webhookQueue.isWebhookQueueAvailable()).toBe(true);

    const payload = {
      eventType: 'payment.received' as const,
      merchantId: 'm1',
      invoiceId: 'i1',
      chainKey: 'solana',
      tokenSymbol: 'USDC',
      amount: '10',
      privacyLevel: 'standard',
      timestamp: 12345,
    };

    const job = await webhookQueue.enqueueWebhook(payload);
    expect(job).toBeTruthy();
    expect(job?.id).toBe('job123');
    // REL-002: outbox row created before enqueue
    expect(prismaMock.webhookDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'pending' }),
      })
    );

    const dlqJob = await webhookQueue.enqueueWebhookDlq(payload, 'test error');
    expect(dlqJob).toBeTruthy();
    expect(dlqJob?.id).toBe('job123');
  });

  it('should fallback to database when queue is unavailable', async () => {
    getRedisClientMock.mockReturnValue(null);
    
    expect(webhookQueue.initializeWebhookQueue()).toBe(false);
    expect(webhookQueue.isWebhookQueueAvailable()).toBe(false);

    const payload = {
      eventType: 'payment.received' as const,
      merchantId: 'm1',
      invoiceId: 'i1',
      chainKey: 'solana',
      tokenSymbol: 'USDC',
      amount: '10',
      privacyLevel: 'standard',
      timestamp: 12345,
    };

    const job = await webhookQueue.enqueueWebhook(payload);
    expect(job).toBeNull();
    // Outbox create then mark failed when queue down
    expect(prismaMock.webhookDelivery.create).toHaveBeenCalled();
    expect(prismaMock.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      })
    );
  });

  it('recovery is a no-op when the queue is not available', async () => {
    getRedisClientMock.mockReturnValue(null);
    expect(webhookQueue.initializeWebhookQueue()).toBe(false);
    const recovered = await webhookQueue.recoverOrphanedPendingDeliveries();
    expect(recovered).toBe(0);
    expect(prismaMock.webhookDelivery.findMany).not.toHaveBeenCalled();
  });

  it('recovery re-enqueues stale pending rows with their original deliveryId', async () => {
    getRedisClientMock.mockReturnValue({ status: 'ready' });
    expect(webhookQueue.initializeWebhookQueue()).toBe(true);
    // Job does not exist yet — a genuine orphan gets re-enqueued.
    bullmqMock.__getJobMock.mockResolvedValue(null);

    const stalePayload = {
      eventType: 'payment.received' as const,
      merchantId: 'm2',
      invoiceId: 'i2',
      chainKey: 'stellar',
      tokenSymbol: 'XLM',
      amount: '5',
      privacyLevel: 'standard',
      timestamp: 999,
    };
    prismaMock.webhookDelivery.findMany.mockResolvedValue([
      { id: 'delivery-stale', payload: stalePayload },
    ]);

    const recovered = await webhookQueue.recoverOrphanedPendingDeliveries();
    expect(recovered).toBe(1);
    expect(prismaMock.webhookDelivery.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'pending',
          // W1: only unclaimed rows are swept.
          nextRetryAt: null,
        }),
      })
    );
    // W1: the claim marker is set before re-enqueue so a restart can't re-sweep.
    expect(prismaMock.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'delivery-stale' },
        data: expect.objectContaining({ nextRetryAt: expect.any(Date) }),
      })
    );
    // Reuse the original deliveryId so BullMQ jobId dedupes (idempotent).
    expect(prismaMock.webhookDelivery.create).not.toHaveBeenCalled();

    prismaMock.webhookDelivery.findMany.mockResolvedValue([]);
  });

  it('recovery skips a stale row whose job still exists in the queue (no duplicate)', async () => {
    getRedisClientMock.mockReturnValue({ status: 'ready' });
    expect(webhookQueue.initializeWebhookQueue()).toBe(true);
    // Job `wh-delivery-existing` already lives in the queue — do not re-enqueue.
    bullmqMock.__getJobMock.mockResolvedValue({ id: 'wh-delivery-existing' });

    const stalePayload = {
      eventType: 'invoice.paid' as const,
      merchantId: 'm3',
      invoiceId: 'i3',
      chainKey: 'solana',
      tokenSymbol: 'USDC',
      amount: '1',
      privacyLevel: 'standard',
      timestamp: 555,
    };
    prismaMock.webhookDelivery.findMany.mockResolvedValue([
      { id: 'delivery-existing', payload: stalePayload },
    ]);

    const recovered = await webhookQueue.recoverOrphanedPendingDeliveries();
    expect(recovered).toBe(0);
    // Queued.add must not be called for a row whose job already exists.
    expect(bullmqMock.__getJobMock).toHaveBeenCalledWith('wh-delivery-existing');
    expect(prismaMock.webhookDelivery.update).not.toHaveBeenCalled();

    prismaMock.webhookDelivery.findMany.mockResolvedValue([]);
  });

  it('recovery lazily initializes the producer (W2) when redis is available', async () => {
    getRedisClientMock.mockReturnValue({ status: 'ready' });
    // NOTE: initializeWebhookQueue() is intentionally NOT called first — the
    // sweep must bootstrap the producer itself in worker-only deployments.
    expect(webhookQueue.isWebhookQueueAvailable()).toBe(false);

    prismaMock.webhookDelivery.findMany.mockResolvedValue([]);
    const recovered = await webhookQueue.recoverOrphanedPendingDeliveries();
    expect(recovered).toBe(0);
    expect(webhookQueue.isWebhookQueueAvailable()).toBe(true);
    // It did run the sweep query (producer was available after lazy init).
    expect(prismaMock.webhookDelivery.findMany).toHaveBeenCalled();
  });
});
