import { Queue } from 'bullmq';

jest.mock('bullmq', () => {
  const addMock = jest.fn().mockResolvedValue({ id: 'job123' });
  const getJobMock = jest.fn().mockResolvedValue(null);
  return {
    Queue: jest.fn().mockImplementation(() => ({
      add: addMock,
      getJob: getJobMock,
      close: jest.fn().mockResolvedValue(undefined),
    })),
    __addMock: addMock,
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
    bullmqMock.__addMock.mockClear();
    bullmqMock.__addMock.mockResolvedValue({ id: 'job123' });
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

  describe('D5: explicit retries mint fresh jobIds', () => {
    const payloadWithDelivery = {
      eventType: 'payment.received' as const,
      merchantId: 'm1',
      invoiceId: 'i1',
      chainKey: 'solana',
      tokenSymbol: 'USDC',
      amount: '10',
      privacyLevel: 'standard',
      timestamp: 12345,
      deliveryId: 'delivery-retry',
    };

    beforeEach(() => {
      getRedisClientMock.mockReturnValue({ status: 'ready' });
      expect(webhookQueue.initializeWebhookQueue()).toBe(true);
    });

    it('retry #1 and retry #2 produce different jobIds and both enqueue', async () => {
      const first = await webhookQueue.enqueueWebhook(payloadWithDelivery, { attempt: 1 });
      const second = await webhookQueue.enqueueWebhook(payloadWithDelivery, { attempt: 2 });

      expect(first?.id).toBe('job123');
      expect(second?.id).toBe('job123');

      const firstCall = bullmqMock.__addMock.mock.calls[0];
      const secondCall = bullmqMock.__addMock.mock.calls[1];
      expect(firstCall[2]).toEqual({ jobId: 'wh-delivery-retry-retry-1' });
      expect(secondCall[2]).toEqual({ jobId: 'wh-delivery-retry-retry-2' });
      expect(firstCall[2].jobId).not.toBe(secondCall[2].jobId);
      // The retry targets the SAME outbox row — no duplicate row is created.
      expect(prismaMock.webhookDelivery.create).not.toHaveBeenCalled();
    });

    it('first delivery keeps the deterministic idempotent jobId', async () => {
      const { deliveryId, ...withoutDeliveryId } = payloadWithDelivery;
      // Outbox row is created (REL-002) and the job id is deterministic.
      prismaMock.webhookDelivery.create.mockResolvedValue({ id: 'delivery-retry' });

      const job = await webhookQueue.enqueueWebhook(withoutDeliveryId);

      expect(job?.id).toBe('job123');
      expect(bullmqMock.__addMock.mock.calls[0][2]).toEqual({ jobId: 'wh-delivery-retry' });
      expect(prismaMock.webhookDelivery.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'pending' }),
        })
      );
    });

    it('an "already exists" duplicate for one attempt no longer masks the next retry', async () => {
      // Attempt 1's add collides with an existing job (double-click race) —
      // the swallow must return the existing job, not null.
      bullmqMock.__addMock.mockImplementation((_queue: string, _data: unknown, opts: { jobId: string }) => {
        if (opts.jobId === 'wh-delivery-retry-retry-1') {
          return Promise.reject(new Error('JobId wh-delivery-retry-retry-1 already exists'));
        }
        return Promise.resolve({ id: 'job-fresh' });
      });
      bullmqMock.__getJobMock.mockImplementation((jobId: string) =>
        jobId === 'wh-delivery-retry-retry-1'
          ? Promise.resolve({ id: 'wh-delivery-retry-retry-1' })
          : Promise.resolve(null)
      );

      const duplicate = await webhookQueue.enqueueWebhook(payloadWithDelivery, { attempt: 1 });
      // The already-queued attempt resolves to the existing job — the caller
      // can tell the delivery is genuinely enqueued.
      expect(duplicate).toBeTruthy();
      expect(duplicate?.id).toBe('wh-delivery-retry-retry-1');

      // The next attempt mints a fresh id and enqueues normally.
      const fresh = await webhookQueue.enqueueWebhook(payloadWithDelivery, { attempt: 2 });
      expect(fresh?.id).toBe('job-fresh');
      expect(bullmqMock.__addMock).toHaveBeenCalledWith(
        'webhook-delivery',
        expect.objectContaining({ deliveryId: 'delivery-retry' }),
        { jobId: 'wh-delivery-retry-retry-2' }
      );
    });
  });
});
