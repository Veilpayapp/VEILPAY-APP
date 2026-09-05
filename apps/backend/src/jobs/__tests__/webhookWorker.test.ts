import { Worker, QueueEvents } from 'bullmq';
import { prisma } from '../../lib/prisma';
import { getRedisClient } from '../../lib/redis';
import { deliverWebhook } from '../webhookDelivery';
import { enqueueWebhookDlq, recoverOrphanedPendingDeliveries } from '../webhookQueue';
import { incrementWebhookDeliveryAttempt } from '../../utils/metrics';
import { logger } from '../../lib/logger';
import { initializeWebhookWorker, closeWebhookWorker } from '../webhookWorker';

let globalProcessor: any;

jest.mock('bullmq', () => {
  return {
    Worker: class {
      constructor(name: string, processor: any) {
        globalProcessor = processor;
      }
      close = jest.fn();
    },
    QueueEvents: class {
      on = jest.fn();
      close = jest.fn();
    },
  };
});

jest.mock('../../lib/prisma', () => ({
  prisma: {
    merchant: {
      findUnique: jest.fn(),
    },
    webhookDelivery: {
      create: jest.fn(),
    },
  },
}));

jest.mock('../../lib/redis', () => ({
  getRedisClient: jest.fn(),
}));

jest.mock('../webhookDelivery', () => ({
  deliverWebhook: jest.fn(),
}));

jest.mock('../webhookQueue', () => ({
  enqueueWebhookDlq: jest.fn(),
  recoverOrphanedPendingDeliveries: jest.fn(),
}));

jest.mock('../../utils/metrics', () => ({
  incrementWebhookDeliveryAttempt: jest.fn(),
}));

// Mock redis lock to execute the guarded callback immediately, so the worker-init
// orphan-recovery sweep can be asserted deterministically regardless of Redis state.
jest.mock('../../lib/redisLock', () => ({
  withRedisLock: jest.fn(async (_key: string, _ttl: number, fn: () => Promise<unknown>) => {
    await fn();
  }),
}));

describe('webhookWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await closeWebhookWorker();
  });

  it('does not initialize if redis client is null', () => {
    (getRedisClient as jest.Mock).mockReturnValue(null);
    const result = initializeWebhookWorker();
    expect(result).toBe(false);
  });

  it('initializes the worker and runs the orphan-recovery sweep', async () => {
    jest.isolateModules(async () => {
      const { initializeWebhookWorker } = require('../webhookWorker');
      (getRedisClient as jest.Mock).mockReturnValue({});
      const result = initializeWebhookWorker();
      expect(result).toBe(true);
      // withRedisLock executes the guarded callback in a fire-and-forget microtask;
      // yield so the recovery sweep has a chance to run, then assert it was triggered.
      await new Promise((r) => setImmediate(r));
      expect(recoverOrphanedPendingDeliveries).toHaveBeenCalled();
    });
  });

  it('closes the worker correctly', async () => {
    jest.isolateModules(async () => {
      const { closeWebhookWorker, initializeWebhookWorker } = require('../webhookWorker');
      (getRedisClient as jest.Mock).mockReturnValue({});
      initializeWebhookWorker();
      await closeWebhookWorker();
    });
  });

  describe('processor', () => {
    let processor: any;
    let initWebhookWorker: any;

    beforeEach(async () => {
      jest.isolateModules(() => {
        const workerModule = require('../webhookWorker');
        initWebhookWorker = workerModule.initializeWebhookWorker;
      });
      (getRedisClient as jest.Mock).mockReturnValue({});
      initWebhookWorker();
      processor = globalProcessor;
    });

    it('skips if merchant has no webhookUrl', async () => {
      (prisma.merchant.findUnique as jest.Mock).mockResolvedValue({ webhookUrl: null });
      const job = { data: { merchantId: 'm-1' } };
      await processor(job);
      expect(deliverWebhook).not.toHaveBeenCalled();
    });

    it('delivers webhook successfully', async () => {
      const infoSpy = jest.spyOn(logger, 'info');
      (prisma.merchant.findUnique as jest.Mock).mockResolvedValue({ webhookUrl: 'http://example.com' });
      (deliverWebhook as jest.Mock).mockResolvedValue({ success: true, statusCode: 200 });
      const job = { id: 'j-1', data: { merchantId: 'm-1', eventType: 'test' }, attemptsMade: 0, opts: { attempts: 3 } };

      await processor(job);

      expect(deliverWebhook).toHaveBeenCalledWith('http://example.com', job.data);
      expect(incrementWebhookDeliveryAttempt).toHaveBeenCalledWith('success');
      expect(prisma.webhookDelivery.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'delivered' }),
      }));
      // SEC: the worker must never log the merchant's webhookUrl — merchants often embed
      // an auth token in it. Assert no info log line contains the URL (credential-leak guard).
      const logged = infoSpy.mock.calls.map((c: unknown[]) => JSON.stringify(c)).join(' ');
      expect(logged).not.toContain('http://example.com');
    });

    it('handles webhook delivery failure but not final attempt', async () => {
      (prisma.merchant.findUnique as jest.Mock).mockResolvedValue({ webhookUrl: 'http://example.com' });
      (deliverWebhook as jest.Mock).mockResolvedValue({ success: false, statusCode: 500, lastError: 'Error' });
      const job = { id: 'j-1', data: { merchantId: 'm-1', eventType: 'test' }, attemptsMade: 0, opts: { attempts: 3 } };
      
      await expect(processor(job)).rejects.toThrow('Webhook delivery failed: Error');
      expect(enqueueWebhookDlq).not.toHaveBeenCalled();
      expect(prisma.webhookDelivery.create).not.toHaveBeenCalled();
    });

    it('handles webhook delivery failure on final attempt', async () => {
      (prisma.merchant.findUnique as jest.Mock).mockResolvedValue({ webhookUrl: 'http://example.com' });
      (deliverWebhook as jest.Mock).mockResolvedValue({ success: false, statusCode: 500, lastError: 'Error' });
      const job = { id: 'j-1', data: { merchantId: 'm-1', eventType: 'test' }, attemptsMade: 2, opts: { attempts: 3 } };
      
      await expect(processor(job)).rejects.toThrow('Webhook delivery failed: Error');
      expect(enqueueWebhookDlq).toHaveBeenCalledWith(job.data, 'Error');
      expect(incrementWebhookDeliveryAttempt).toHaveBeenCalledWith('permanent_failure');
      expect(prisma.webhookDelivery.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      }));
    });
  });
});
