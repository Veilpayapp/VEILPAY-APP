import { enqueueWebhook, enqueueDeadLetter, getQueueStats, createWebhookWorker, webhookQueue, deadLetterQueue, closeQueueConnection } from '../index';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../../config';
import { prisma } from '../../lib/prisma';

// Lifecycle contract (round-5 jest-exit fix): the queue module's shared
// ioredis client must be created with lazyConnect so importing it opens no
// socket and holds no handle, while maxRetriesPerRequest stays null (BullMQ
// durability). Mock the constructor to observe the options it was given.
jest.mock('ioredis', () => {
  const IORedisMock = jest.fn().mockImplementation(() => ({
    status: 'wait',
    disconnect: jest.fn(),
  }));
  return { __esModule: true, default: IORedisMock };
});

// Captured at module-eval time — before any beforeEach/jest.clearAllMocks()
// can wipe the constructor's call record.
const ioredisCtor = IORedis as unknown as jest.Mock;
const ctorCallCount = ioredisCtor.mock.calls.length;
const ctorArgs = ioredisCtor.mock.calls[0] as
  | [string, { maxRetriesPerRequest: number | null; lazyConnect?: boolean }]
  | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sharedClient = ioredisCtor.mock.results[0]?.value as any;

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    merchantId: 'merch-1',
    eventType: 'payment.received' as const,
    timestamp: 1700000000000,
    data: {
      chainKey: 'ethereum',
      txHash: '0x123',
      amount: '100',
      tokenSymbol: 'ETH',
    },
    ...overrides,
  };
}

describe('Queue connection lifecycle (jest-exit contract)', () => {
  it('creates ONE shared client for the queues and worker factory', () => {
    // one client shared by webhookQueue, deadLetterQueue and
    // createWebhookWorker — not three independent connections
    expect(ctorCallCount).toBe(1);
    expect(sharedClient).toBeDefined();
  });

  it('connects lazily (no socket at import time) without weakening BullMQ durability', () => {
    expect(ctorArgs).toBeDefined();
    const [url, options] = ctorArgs!;
    expect(url).toBe(config.redisUrl);
    // maxRetriesPerRequest: null is BullMQ's durability requirement —
    // commands queue forever while Redis is down. Must stay null.
    expect(options.maxRetriesPerRequest).toBeNull();
    // lazyConnect: the client stays in 'wait' (no socket, no reconnect
    // timer) until the first command, so importing the module cannot hold
    // the Jest worker's event loop open.
    expect(options.lazyConnect).toBe(true);
  });

  it('closeQueueConnection disconnects the shared client exactly once and is idempotent', () => {
    expect(() => closeQueueConnection()).not.toThrow();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(sharedClient.disconnect as jest.Mock).toHaveBeenCalledTimes(1);
    // second call is a no-op (connection already null), still no throw
    expect(() => closeQueueConnection()).not.toThrow();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(sharedClient.disconnect as jest.Mock).toHaveBeenCalledTimes(1);
  });
});

describe('Queue Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.webhookDelivery.create as jest.Mock).mockResolvedValue({ id: 'delivery-1' });
  });

  it('enqueueWebhook should add a job to webhook queue', async () => {
    const payload = basePayload();
    const id = await enqueueWebhook(payload);
    expect(id).toBe('mock-job-id');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(webhookQueue.add).toHaveBeenCalledWith(
      'webhook',
      expect.objectContaining({ merchantId: 'merch-1' }),
      expect.any(Object)
    );
  });

  it('(f) creates the durable outbox row (pending) BEFORE the queue add, and binds the jobId to it', async () => {
    const payload = basePayload();
    await enqueueWebhook(payload);

    // outbox row first...
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.webhookDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          merchantId: 'merch-1',
          eventType: 'payment.received',
          status: 'pending',
          retryCount: 0,
        }),
        select: { id: true },
      }),
    );
    // ...strictly before the enqueue (a crash between the two can no longer
    // silently drop the notification — the row is visible to the drift job)
    const createOrder = (prisma.webhookDelivery.create as jest.Mock).mock.invocationCallOrder[0];
    const addOrder = (webhookQueue.add as jest.Mock).mock.invocationCallOrder[0];
    expect(createOrder).toBeLessThan(addOrder);

    // the job carries the deliveryId and uses it as the BullMQ jobId
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(webhookQueue.add).toHaveBeenCalledWith(
      'webhook',
      expect.objectContaining({ deliveryId: 'delivery-1' }),
      { jobId: 'wh-delivery-1' }
    );
  });

  it('(f) reuses an existing deliveryId instead of minting a second outbox row', async () => {
    const payload = basePayload({ deliveryId: 'wd-existing' });
    await enqueueWebhook(payload);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.webhookDelivery.create).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(webhookQueue.add).toHaveBeenCalledWith(
      'webhook',
      expect.objectContaining({ deliveryId: 'wd-existing' }),
      { jobId: 'wh-wd-existing' }
    );
  });

  it('(f) falls back to the legacy jobId when the outbox row cannot be created', async () => {
    (prisma.webhookDelivery.create as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    const payload = basePayload();

    // enqueue still succeeds — undurable-but-delivered beats dropped
    const id = await enqueueWebhook(payload);
    expect(id).toBe('mock-job-id');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(webhookQueue.add).toHaveBeenCalledWith(
      'webhook',
      expect.objectContaining({ deliveryId: undefined }),
      { jobId: 'merch-1-0x123' }
    );
  });

  it('(f) marks the outbox row failed (completedAt) when the enqueue itself fails, and rethrows', async () => {
    (webhookQueue.add as jest.Mock).mockRejectedValueOnce(new Error('redis gone'));
    const payload = basePayload();

    await expect(enqueueWebhook(payload)).rejects.toThrow('redis gone');

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'delivery-1' },
        data: expect.objectContaining({
          status: 'failed',
          completedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('enqueueDeadLetter should add a job to DLQ', async () => {
    const payload = {
      merchantId: 'merch-1',
      eventType: 'payment.received' as const,
      attemptsMade: 5,
      error: 'timeout',
      payload: basePayload(),
      failedAt: new Date().toISOString(),
    };
    const id = await enqueueDeadLetter(payload);
    expect(id).toBe('mock-job-id');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(deadLetterQueue.add).toHaveBeenCalledWith('webhook-dead-letter', payload, {
      jobId: `merch-1-payment.received-0x123`
    });
  });

  it('getQueueStats should return queue statistics', async () => {
    (webhookQueue.getWaitingCount as jest.Mock).mockResolvedValueOnce(5);
    (webhookQueue.getActiveCount as jest.Mock).mockResolvedValueOnce(2);
    (webhookQueue.getCompletedCount as jest.Mock).mockResolvedValueOnce(10);
    (webhookQueue.getFailedCount as jest.Mock).mockResolvedValueOnce(1);

    const stats = await getQueueStats();
    expect(stats).toEqual({
      waiting: 5,
      active: 2,
      completed: 10,
      failed: 1
    });
  });

  it('createWebhookWorker should create a BullMQ Worker', () => {
    const processor = jest.fn();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const worker = createWebhookWorker(processor);
    expect(Worker).toHaveBeenCalledWith('veilpay-webhooks', processor, expect.any(Object));
  });
});
