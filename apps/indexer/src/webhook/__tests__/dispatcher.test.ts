import { processWebhookJob, startWebhookWorker } from '../dispatcher';
import { prisma } from '../../lib/prisma';
import { enqueueDeadLetter, createWebhookWorker } from '../../queue';

jest.mock('../../queue', () => ({
  enqueueDeadLetter: jest.fn().mockResolvedValue(undefined),
  createWebhookWorker: jest.fn(),
}));

type HandlerMap = {
  completed?: (job: { id: string }) => void;
  failed?: (job: { id: string; attemptsMade: number; opts: { attempts?: number }; data: Record<string, unknown> } | undefined, error: Error) => void;
};

describe('Webhook Dispatcher', () => {
  const originalFetch = globalThis.fetch;
  const mockFetch = jest.fn();
  let handlers: HandlerMap;

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
    globalThis.fetch = mockFetch as any;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = {};
    (createWebhookWorker as jest.Mock).mockReturnValue({
      on: jest.fn((event: keyof HandlerMap, handler: HandlerMap[keyof HandlerMap]) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        handlers[event] = handler;
      }),
    });
  });

  describe('processWebhookJob', () => {
    it('should skip if no webhook config', async () => {
      (prisma.merchant.findUnique as jest.Mock).mockResolvedValueOnce({ webhookUrl: null });
      const job = {
        id: 'job-1',
        data: { merchantId: 'm1', eventType: 'payment.received' as const },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
      await processWebhookJob(job as any);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.merchant.findUnique).toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should send webhook and record delivery on success', async () => {
      (prisma.merchant.findUnique as jest.Mock).mockResolvedValueOnce({
        webhookUrl: 'https://example.com',
        apiKeyHash: 'some_hash',
      });
      mockFetch.mockResolvedValueOnce({ status: 200 });

      const job = {
        id: 'job-1',
        data: { merchantId: 'm1', eventType: 'payment.received' as const },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
      await processWebhookJob(job as any);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'X-VeilPay-Signature': expect.any(String) as string,
            'X-VeilPay-Event': 'payment.received',
          }) as Record<string, string>,
        }),
      );
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.webhookDelivery.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'delivered',
            statusCode: 200,
          }) as Record<string, unknown>,
        }),
      );
    });

    it('should throw error on failure', async () => {
      (prisma.merchant.findUnique as jest.Mock).mockResolvedValueOnce({
        webhookUrl: 'https://example.com',
        apiKeyHash: 'some_hash',
      });
      mockFetch.mockResolvedValueOnce({ status: 500 });

      const job = {
        id: 'job-1',
        data: { merchantId: 'm1', eventType: 'payment.received' as const },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
      await expect(processWebhookJob(job as any)).rejects.toThrow(
        'Webhook delivery failed: undefined',
      );
    });

    it('should throw error on fetch exception', async () => {
      (prisma.merchant.findUnique as jest.Mock).mockResolvedValueOnce({
        webhookUrl: 'https://example.com',
        apiKeyHash: 'some_hash',
      });
      mockFetch.mockRejectedValueOnce(new Error('Network failure'));

      const job = {
        id: 'job-1',
        data: { merchantId: 'm1', eventType: 'payment.received' as const },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
      await expect(processWebhookJob(job as any)).rejects.toThrow(
        'Webhook delivery failed: Network failure',
      );
    });

    it('should fail when Fetch API is unavailable', async () => {
      (prisma.merchant.findUnique as jest.Mock).mockResolvedValueOnce({
        webhookUrl: 'https://example.com',
        apiKeyHash: 'some_hash',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      const prev = globalThis.fetch;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (globalThis as any).fetch = undefined;

      const job = {
        id: 'job-1',
        data: { merchantId: 'm1', eventType: 'payment.received' as const },
      };

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
        await expect(processWebhookJob(job as any)).rejects.toThrow(
          'Fetch API is not available in this runtime',
        );
      } finally {
        globalThis.fetch = prev;
      }
    });
  });

  describe('startWebhookWorker', () => {
    const sampleJob = {
      id: 'job-dlq',
      attemptsMade: 3,
      opts: { attempts: 3 },
      data: {
        merchantId: 'm1',
        eventType: 'payment.received' as const,
        timestamp: Date.now(),
        data: { invoiceId: 'inv1' },
      },
    };

    it('should create and return a worker with completed/failed handlers', () => {
      const worker = startWebhookWorker();
      expect(worker).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(worker.on).toHaveBeenCalledWith('completed', expect.any(Function));
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(worker.on).toHaveBeenCalledWith('failed', expect.any(Function));
    });

    it('should log on completed event', () => {
      startWebhookWorker();
      expect(handlers.completed).toBeDefined();
      handlers.completed?.({ id: 'job-ok' });
    });

    it('should ignore failed event with no job', () => {
      startWebhookWorker();
      handlers.failed?.(undefined, new Error('boom'));
      expect(enqueueDeadLetter).not.toHaveBeenCalled();
    });

    it('should not dead-letter while retries remain', () => {
      startWebhookWorker();
      handlers.failed?.(
        {
          ...sampleJob,
          attemptsMade: 1,
          opts: { attempts: 3 },
        },
        new Error('transient'),
      );
      expect(enqueueDeadLetter).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.webhookDelivery.create).not.toHaveBeenCalled();
    });

    it('should record failure and enqueue dead-letter after final attempt', async () => {
      startWebhookWorker();
      handlers.failed?.(sampleJob, new Error('final failure'));

      // flush async dead-letter finalization
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.webhookDelivery.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            merchantId: 'm1',
            status: 'failed',
            error: 'final failure',
          }) as Record<string, unknown>,
        }),
      );
      expect(enqueueDeadLetter).toHaveBeenCalledWith(
        expect.objectContaining({
          merchantId: 'm1',
          eventType: 'payment.received',
          attemptsMade: 3,
          error: 'final failure',
        }),
      );
    });

    it('should swallow errors during dead-letter finalization', async () => {
      (prisma.webhookDelivery.create as jest.Mock).mockRejectedValueOnce(
        new Error('db down'),
      );
      startWebhookWorker();
      handlers.failed?.(sampleJob, new Error('final failure'));

      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      // must not throw; enqueueDeadLetter may or may not be reached
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.webhookDelivery.create).toHaveBeenCalled();
    });
  });
});
