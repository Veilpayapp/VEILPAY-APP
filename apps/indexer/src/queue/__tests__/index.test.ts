import { enqueueWebhook, enqueueDeadLetter, getQueueStats, createWebhookWorker, webhookQueue, deadLetterQueue } from '../index';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Queue, Worker } from 'bullmq';

describe('Queue Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('enqueueWebhook should add a job to webhook queue', async () => {
    const payload = {
      merchantId: 'merch-1',
      eventType: 'payment.received' as const,
      timestamp: Date.now(),
      data: {
        chainKey: 'ethereum',
        txHash: '0x123',
        amount: '100',
        tokenSymbol: 'ETH',
      }
    };
    const id = await enqueueWebhook(payload);
    expect(id).toBe('mock-job-id');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(webhookQueue.add).toHaveBeenCalledWith('webhook', payload, {
      jobId: 'merch-1-0x123'
    });
  });

  it('enqueueDeadLetter should add a job to DLQ', async () => {
    const payload = {
      merchantId: 'merch-1',
      eventType: 'payment.received' as const,
      attemptsMade: 5,
      error: 'timeout',
      payload: {
        merchantId: 'merch-1',
        eventType: 'payment.received' as const,
        timestamp: Date.now(),
        data: {
          chainKey: 'ethereum',
          txHash: '0x123',
          amount: '100',
          tokenSymbol: 'ETH',
        }
      },
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
