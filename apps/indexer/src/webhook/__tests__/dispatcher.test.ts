import { createHmac } from 'crypto';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import {
  processWebhookJob,
  startWebhookWorker,
  defaultHttpSender,
  __testing__,
  type WebhookSenderArgs,
} from '../dispatcher';
import { prisma } from '../../lib/prisma';
import { enqueueDeadLetter, createWebhookWorker } from '../../queue';
import { config } from '../../config';
import { assertSafeWebhookUrl } from '../urlSafety';

jest.mock('../../queue', () => ({
  enqueueDeadLetter: jest.fn().mockResolvedValue(undefined),
  createWebhookWorker: jest.fn(),
  webhookQueue: { add: jest.fn() },
  enqueueWebhook: jest.fn(),
}));

jest.mock('../urlSafety', () => ({
  assertSafeWebhookUrl: jest.fn(),
}));

const mockAssertSafeWebhookUrl = assertSafeWebhookUrl as unknown as jest.Mock;

type CompletedHandler = (job: { id: string }) => void;
type FailedHandler = (
  job:
    | {
        id: string;
        attemptsMade: number;
        opts: { attempts?: number };
        data: Record<string, unknown>;
      }
    | undefined,
  error: Error,
) => void;

const MERCHANT_SECRET = 'merchant_webhook_secret_0123456789';

function baseJobData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    merchantId: 'm1',
    eventType: 'payment.received',
    timestamp: 1700000000000,
    data: { invoiceId: 'inv1', chainKey: 'ethereum', txHash: '0xabc', amount: '1', tokenSymbol: 'ETH' },
    ...overrides,
  };
}

describe('Webhook Dispatcher', () => {
  const senderCalls: WebhookSenderArgs[] = [];

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __testing__.setHttpSender(async (args: WebhookSenderArgs) => {
      senderCalls.push(args);
      return { statusCode: 200 };
    });
  });

  afterAll(() => {
    __testing__.setHttpSender(null);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    senderCalls.length = 0;
    mockAssertSafeWebhookUrl.mockResolvedValue({
      url: 'https://example.com/webhook',
      resolvedAddress: '93.184.216.34',
      family: 4,
    });
    (createWebhookWorker as jest.Mock).mockImplementation(() => ({
      on: jest.fn((event: string, handler: (...args: never[]) => void) => {
        handlersByEvent[event] = handler;
      }),
    }));
  });

  // `handlersByEvent` is assigned in beforeEach before any handler fires.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlersByEvent: Record<string, any> = {};

  describe('processWebhookJob', () => {
    it('should skip (and fail the outbox row) if no webhook config', async () => {
      (prisma.merchant.findUnique as jest.Mock).mockResolvedValueOnce({ webhookUrl: null });
      const job = { id: 'job-1', data: baseJobData({ deliveryId: 'wd-1' }) };

      await processWebhookJob(job as never);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.merchant.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          select: { webhookUrl: true, webhookSecret: true },
        }),
      );
      expect(senderCalls.length).toBe(0);
      // (f) the pending outbox row is settled, not left stuck
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'wd-1' },
          data: expect.objectContaining({
            status: 'failed',
            error: 'Merchant has no webhookUrl configured',
          }),
        }),
      );
    });

    it('should send the webhook and update the SAME outbox row on success', async () => {
      (prisma.merchant.findUnique as jest.Mock).mockResolvedValueOnce({
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: MERCHANT_SECRET,
      });

      await processWebhookJob({ id: 'job-1', data: baseJobData({ deliveryId: 'wd-1' }) } as never);

      expect(senderCalls.length).toBe(1);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'wd-1' },
          data: expect.objectContaining({
            status: 'delivered',
            statusCode: 200,
            completedAt: expect.any(Date),
          }),
        }),
      );
      // no post-hoc row creation on the durable-outbox path
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.webhookDelivery.create).not.toHaveBeenCalled();
    });

    it('should create a post-hoc row only for legacy jobs without deliveryId', async () => {
      (prisma.merchant.findUnique as jest.Mock).mockResolvedValueOnce({
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: MERCHANT_SECRET,
      });

      await processWebhookJob({ id: 'job-1', data: baseJobData() } as never);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.webhookDelivery.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            merchantId: 'm1',
            status: 'delivered',
            statusCode: 200,
          }),
        }),
      );
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.webhookDelivery.update).not.toHaveBeenCalled();
    });

    it('(g) signs with merchant.webhookSecret — no apiKeyHash fallback — over timestamp.body as bare hex', async () => {
      (prisma.merchant.findUnique as jest.Mock).mockResolvedValueOnce({
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: MERCHANT_SECRET,
      });

      await processWebhookJob({ id: 'job-1', data: baseJobData() } as never);

      const call = senderCalls[0];
      expect(call).toBeDefined();
      const timestamp = call.headers['X-VeilPay-Timestamp'];
      const expected = createHmac('sha256', MERCHANT_SECRET)
        .update(`${timestamp}.${call.body}`)
        .digest('hex');
      expect(call.headers['X-VeilPay-Signature']).toBe(expected);
      // STRETCH: backend-aligned format — NO sha256= prefix (body-only HMAC)
      expect(call.headers['X-VeilPay-Signature']).not.toMatch(/^sha256=/);
      expect(call.headers['X-VeilPay-Signature']).toMatch(/^[0-9a-f]{64}$/);
      expect(timestamp).toMatch(/^\d+$/);
    });

    it('(g) falls back to the platform signing secret when the merchant has none', async () => {
      (prisma.merchant.findUnique as jest.Mock).mockResolvedValueOnce({
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: null,
      });

      await processWebhookJob({ id: 'job-1', data: baseJobData() } as never);

      const call = senderCalls[0];
      const expected = createHmac('sha256', config.webhookSigningSecret)
        .update(`${call.headers['X-VeilPay-Timestamp']}.${call.body}`)
        .digest('hex');
      expect(call.headers['X-VeilPay-Signature']).toBe(expected);
    });

    it('(e) validates the URL with the SSRF guard at DELIVERY time before every fetch', async () => {
      (prisma.merchant.findUnique as jest.Mock).mockResolvedValueOnce({
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: MERCHANT_SECRET,
      });

      await processWebhookJob({ id: 'job-1', data: baseJobData() } as never);

      // the guard ran with the merchant URL...
      expect(mockAssertSafeWebhookUrl).toHaveBeenCalledTimes(1);
      expect(mockAssertSafeWebhookUrl).toHaveBeenCalledWith('https://example.com/webhook');
      // ...and the fetch happened (the guard-before-fetch ordering is
      // enforced by the next test: a rejected guard means no fetch at all)
      expect(senderCalls.length).toBe(1);
    });

    it('(e) refuses to fetch when the SSRF guard rejects the URL', async () => {
      (prisma.merchant.findUnique as jest.Mock).mockResolvedValueOnce({
        webhookUrl: 'http://169.254.169.254/latest/meta-data/',
        webhookSecret: MERCHANT_SECRET,
      });
      mockAssertSafeWebhookUrl.mockRejectedValueOnce(
        new Error('Webhook URL points at a private/reserved IP'),
      );

      await expect(
        processWebhookJob({ id: 'job-1', data: baseJobData() } as never),
      ).rejects.toThrow('Webhook delivery failed: SSRF guard:');

      expect(senderCalls.length).toBe(0);
    });

    it('(e) sends through the pinning agent with a 10s timeout', async () => {
      (prisma.merchant.findUnique as jest.Mock).mockResolvedValueOnce({
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: MERCHANT_SECRET,
      });

      await processWebhookJob({ id: 'job-1', data: baseJobData() } as never);

      const call = senderCalls[0];
      expect(call.timeoutMs).toBe(10_000);
      // https URL → HttpsAgent carrying the pinned lookup
      expect(call.agent).toBeInstanceOf(HttpsAgent);
      expect(call.url).toBe('https://example.com/webhook');
      expect(call.headers['Content-Type']).toBe('application/json');
      expect(call.headers['X-VeilPay-Event']).toBe('payment.received');
    });

    it('should throw on a non-2xx response and leave the outbox row pending (retries left)', async () => {
      (prisma.merchant.findUnique as jest.Mock).mockResolvedValueOnce({
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: MERCHANT_SECRET,
      });
      __testing__.setHttpSender(async () => ({ statusCode: 500, lastError: 'HTTP 500: boom' }));

      await expect(
        processWebhookJob({ id: 'job-1', data: baseJobData({ deliveryId: 'wd-1' }) } as never),
      ).rejects.toThrow('Webhook delivery failed: HTTP 500: boom');

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.webhookDelivery.update).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.webhookDelivery.create).not.toHaveBeenCalled();
      __testing__.setHttpSender(async (args: WebhookSenderArgs) => {
        senderCalls.push(args);
        return { statusCode: 200 };
      });
    });

    it('(e) treats a 3xx response as a failure (redirect rejected)', async () => {
      (prisma.merchant.findUnique as jest.Mock).mockResolvedValueOnce({
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: MERCHANT_SECRET,
      });
      __testing__.setHttpSender(async () => ({
        statusCode: 302,
        lastError: 'HTTP 302: redirect rejected by webhook delivery',
      }));

      await expect(
        processWebhookJob({ id: 'job-1', data: baseJobData() } as never),
      ).rejects.toThrow('Webhook delivery failed: HTTP 302: redirect rejected');
      __testing__.setHttpSender(async (args: WebhookSenderArgs) => {
        senderCalls.push(args);
        return { statusCode: 200 };
      });
    });
  });

  describe('startWebhookWorker', () => {
    const sampleJob = {
      id: 'job-dlq',
      attemptsMade: 3,
      opts: { attempts: 3 },
      data: {
        ...baseJobData({ deliveryId: 'wd-9' }),
      },
    };

    beforeEach(() => {
      (createWebhookWorker as jest.Mock).mockImplementation(() => ({
        on: jest.fn((event: string, handler: (...args: never[]) => void) => {
          handlersByEvent[event] = handler;
        }),
      }));
    });

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
      const completed = handlersByEvent['completed'] as CompletedHandler;
      expect(completed).toBeDefined();
      completed?.({ id: 'job-ok' });
    });

    it('should ignore failed event with no job', () => {
      startWebhookWorker();
      const failed = handlersByEvent['failed'] as FailedHandler;
      failed?.(undefined, new Error('boom'));
      expect(enqueueDeadLetter).not.toHaveBeenCalled();
    });

    it('should only bump retryCount while retries remain (row stays pending)', async () => {
      startWebhookWorker();
      const failed = handlersByEvent['failed'] as FailedHandler;
      failed?.({ ...sampleJob, attemptsMade: 1, opts: { attempts: 3 } }, new Error('transient'));

      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      expect(enqueueDeadLetter).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'wd-9' },
          data: { retryCount: 1 },
        }),
      );
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.webhookDelivery.create).not.toHaveBeenCalled();
    });

    it('(f) updates the SAME outbox row to failed and dead-letters after the final attempt', async () => {
      startWebhookWorker();
      const failed = handlersByEvent['failed'] as FailedHandler;
      failed?.(sampleJob, new Error('final failure'));

      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'wd-9' },
          data: expect.objectContaining({
            status: 'failed',
            error: 'final failure',
            completedAt: expect.any(Date),
          }),
        }),
      );
      expect(enqueueDeadLetter).toHaveBeenCalledWith(
        expect.objectContaining({
          merchantId: 'm1',
          eventType: 'payment.received',
          attemptsMade: 3,
          error: 'final failure',
          payload: expect.objectContaining({ deliveryId: 'wd-9' }),
        }),
      );
    });

    it('creates a post-hoc failed row only for legacy jobs without deliveryId', async () => {
      startWebhookWorker();
      const failed = handlersByEvent['failed'] as FailedHandler;
      const legacyJob = {
        ...sampleJob,
        data: { ...baseJobData() },
      };
      failed?.(legacyJob, new Error('final failure'));

      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.webhookDelivery.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            merchantId: 'm1',
            status: 'failed',
            error: 'final failure',
          }),
        }),
      );
      expect(enqueueDeadLetter).toHaveBeenCalled();
    });

    it('should swallow errors during dead-letter finalization', async () => {
      (prisma.webhookDelivery.update as jest.Mock).mockRejectedValueOnce(new Error('db down'));
      startWebhookWorker();
      const failed = handlersByEvent['failed'] as FailedHandler;
      failed?.(sampleJob, new Error('final failure'));

      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      // must not throw; enqueueDeadLetter may or may not be reached
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.webhookDelivery.update).toHaveBeenCalled();
    });
  });
});

describe('defaultHttpSender (real http against a local loopback server)', () => {
  let server: Server;
  let port: number;
  let mode: 'ok' | 'redirect' | 'hang' | 'error';

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (mode === 'redirect') {
        res.writeHead(302, { Location: 'http://127.0.0.1:9/internal' });
        res.end();
        return;
      }
      if (mode === 'hang') {
        // never respond — the client timeout must fire
        return;
      }
      if (mode === 'error') {
        res.writeHead(500);
        res.end('server exploded');
        return;
      }
      res.writeHead(200);
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function url(): string {
    return `http://127.0.0.1:${port}/webhook`;
  }

  it('resolves 2xx without lastError', async () => {
    mode = 'ok';
    const result = await defaultHttpSender({
      url: url(),
      body: '{}',
      headers: {},
      agent: new HttpAgent(),
      timeoutMs: 2000,
    });
    expect(result.statusCode).toBe(200);
    expect(result.lastError).toBeUndefined();
  });

  it('(e) rejects 3xx at the protocol layer — redirects never followed', async () => {
    mode = 'redirect';
    const result = await defaultHttpSender({
      url: url(),
      body: '{}',
      headers: {},
      agent: new HttpAgent(),
      timeoutMs: 2000,
    });
    expect(result.statusCode).toBe(302);
    expect(result.lastError).toMatch(/redirect rejected/);
  });

  it('reports 5xx with a truncated body snippet', async () => {
    mode = 'error';
    const result = await defaultHttpSender({
      url: url(),
      body: '{}',
      headers: {},
      agent: new HttpAgent(),
      timeoutMs: 2000,
    });
    expect(result.statusCode).toBe(500);
    expect(result.lastError).toMatch(/HTTP 500: server exploded/);
  });

  it('(e) enforces the timeout and fails instead of hanging', async () => {
    mode = 'hang';
    const result = await defaultHttpSender({
      url: url(),
      body: '{}',
      headers: {},
      agent: new HttpAgent(),
      timeoutMs: 150,
    });
    expect(result.statusCode).toBe(0);
    expect(result.lastError).toMatch(/timed out/);
  });
});
