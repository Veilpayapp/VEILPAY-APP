import { Queue } from 'bullmq';

jest.mock('bullmq', () => {
  return {
    Queue: jest.fn().mockImplementation(() => ({
      add: jest.fn().mockResolvedValue({ id: 'job123' }),
      close: jest.fn().mockResolvedValue(undefined),
    })),
  };
});

jest.mock('../../lib/redis', () => ({
  getRedisClient: jest.fn(),
  getRedisInitError: jest.fn().mockReturnValue('Mock Redis Error'),
}));

jest.mock('../../lib/prisma', () => ({
  prisma: {
    webhookDelivery: { create: jest.fn().mockResolvedValue({}) }
  }
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

  beforeEach(async () => {
    jest.resetModules();
    getRedisClientMock = require('../../lib/redis').getRedisClient;
    prismaMock = require('../../lib/prisma').prisma;
    webhookQueue = await import('../webhookQueue');
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
    expect(prismaMock.webhookDelivery.create).toHaveBeenCalled();
  });
});
