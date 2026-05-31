import { Worker, QueueEvents } from 'bullmq';
import { prisma } from '../../lib/prisma';
import { getRedisClient } from '../../lib/redis';
import { deliverWebhook } from '../webhookDelivery';
import { enqueueWebhookDlq } from '../webhookQueue';
import { incrementWebhookDeliveryAttempt } from '../../utils/metrics';
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
}));

jest.mock('../../utils/metrics', () => ({
  incrementWebhookDeliveryAttempt: jest.fn(),
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

  it('initializes the worker and queue events', () => {
    jest.isolateModules(() => {
      const { initializeWebhookWorker } = require('../webhookWorker');
      (getRedisClient as jest.Mock).mockReturnValue({});
      const result = initializeWebhookWorker();
      expect(result).toBe(true);
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
      (prisma.merchant.findUnique as jest.Mock).mockResolvedValue({ webhookUrl: 'http://example.com' });
      (deliverWebhook as jest.Mock).mockResolvedValue({ success: true, statusCode: 200 });
      const job = { id: 'j-1', data: { merchantId: 'm-1', eventType: 'test' }, attemptsMade: 0, opts: { attempts: 3 } };
      
      await processor(job);

      expect(deliverWebhook).toHaveBeenCalledWith('http://example.com', job.data);
      expect(incrementWebhookDeliveryAttempt).toHaveBeenCalledWith('success');
      expect(prisma.webhookDelivery.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'delivered' }),
      }));
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
