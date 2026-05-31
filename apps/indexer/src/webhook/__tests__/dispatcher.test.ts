import { processWebhookJob, startWebhookWorker } from '../dispatcher';
import { prisma } from '../../lib/prisma';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { enqueueDeadLetter } from '../../queue';

jest.mock('../../queue', () => ({
  enqueueDeadLetter: jest.fn(),
  createWebhookWorker: jest.fn().mockReturnValue({
    on: jest.fn(),
  })
}));

describe('Webhook Dispatcher', () => {
  const originalFetch = globalThis.fetch;
  const mockFetch = jest.fn();

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
    globalThis.fetch = mockFetch as any;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('processWebhookJob', () => {
    it('should skip if no webhook config', async () => {
      (prisma.merchant.findUnique as jest.Mock).mockResolvedValueOnce({ webhookUrl: null });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const job: any = {
        id: 'job-1',
        data: { merchantId: 'm1', eventType: 'payment.received' }
      };

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await processWebhookJob(job);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.merchant.findUnique).toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should send webhook and record delivery on success', async () => {
      (prisma.merchant.findUnique as jest.Mock).mockResolvedValueOnce({
        webhookUrl: 'https://example.com',
        apiKeyHash: 'some_hash'
      });
      mockFetch.mockResolvedValueOnce({ status: 200 });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const job: any = {
        id: 'job-1',
        data: { merchantId: 'm1', eventType: 'payment.received' }
      };

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await processWebhookJob(job);

      expect(mockFetch).toHaveBeenCalledWith('https://example.com', expect.objectContaining({
        method: 'POST',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        headers: expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          'X-VeilPay-Signature': expect.any(String),
          'X-VeilPay-Event': 'payment.received'
        })
      }));
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.webhookDelivery.create).toHaveBeenCalledWith(expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({
          status: 'delivered',
          statusCode: 200
        })
      }));
    });

    it('should throw error on failure', async () => {
      (prisma.merchant.findUnique as jest.Mock).mockResolvedValueOnce({
        webhookUrl: 'https://example.com',
        apiKeyHash: 'some_hash'
      });
      mockFetch.mockResolvedValueOnce({ status: 500 }); // fetch returns a response object

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const job: any = {
        id: 'job-1',
        data: { merchantId: 'm1', eventType: 'payment.received' }
      };

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await expect(processWebhookJob(job)).rejects.toThrow('Webhook delivery failed: undefined');
    });

    it('should throw error on fetch exception', async () => {
      (prisma.merchant.findUnique as jest.Mock).mockResolvedValueOnce({
        webhookUrl: 'https://example.com',
        apiKeyHash: 'some_hash'
      });
      mockFetch.mockRejectedValueOnce(new Error('Network failure'));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const job: any = {
        id: 'job-1',
        data: { merchantId: 'm1', eventType: 'payment.received' }
      };

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await expect(processWebhookJob(job)).rejects.toThrow('Webhook delivery failed: Network failure');
    });
  });


  describe('startWebhookWorker', () => {
    it('should create and return a worker', () => {
      const worker = startWebhookWorker();
      expect(worker).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(worker.on).toHaveBeenCalledWith('completed', expect.any(Function));
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(worker.on).toHaveBeenCalledWith('failed', expect.any(Function));
    });
  });
});
