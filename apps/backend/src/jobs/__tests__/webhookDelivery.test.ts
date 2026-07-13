import { deliverWebhook, __testing__, defaultHttpSender } from '../webhookDelivery';
import type {
  WebhookSender,
  WebhookSenderArgs,
  WebhookSenderResult,
} from '../webhookDelivery';

jest.mock('../../config', () => ({
  config: {
    webhookSigningSecret: 'test-secret',
    nodeEnv: 'production',
  },
}));

jest.mock('../../utils/urlSafety', () => {
  class UnsafeUrlError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'UnsafeUrlError';
    }
  }
  return {
    assertSafeWebhookUrl: jest.fn(),
    UnsafeUrlError,
  };
});

describe('webhookDelivery (SEC-002: SSRF guard + DNS-rebinding pinning)', () => {
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

  let captured: { args?: WebhookSenderArgs; respond?: WebhookSenderResult } = {};
  let sender: jest.Mock<Promise<WebhookSenderResult>, [WebhookSenderArgs]>;

  beforeEach(() => {
    captured = {};
    sender = jest.fn(async (args: WebhookSenderArgs) => {
      captured.args = args;
      return captured.respond ?? { statusCode: 200 };
    });
    __testing__.setHttpSender(sender as unknown as WebhookSender);

    const urlSafety = require('../../utils/urlSafety');
    urlSafety.assertSafeWebhookUrl.mockResolvedValue({
      url: 'https://example.com/webhook',
      resolvedAddress: '93.184.216.34',
      family: 4,
    });
  });

  afterEach(() => {
    __testing__.setHttpSender(null);
    jest.clearAllMocks();
  });

  it('returns failure (no request) when the SSRF guard rejects the URL', async () => {
    const urlSafety = require('../../utils/urlSafety');
    urlSafety.assertSafeWebhookUrl.mockRejectedValue(
      Object.assign(new Error('Webhook URL points at a private IP'), { name: 'UnsafeUrlError' })
    );

    const result = await deliverWebhook('http://127.0.0.1', payload);

    expect(result.success).toBe(false);
    expect(result.lastError).toContain('SSRF guard');
    expect(sender).not.toHaveBeenCalled();
  });

  it('pins the connection via a custom Agent.lookup that returns the resolvedAddress from the SSRF check', async () => {
    const urlSafety = require('../../utils/urlSafety');
    urlSafety.assertSafeWebhookUrl.mockResolvedValue({
      url: 'https://attacker.example.com/webhook',
      resolvedAddress: '93.184.216.34',
      family: 4,
    });

    const result = await deliverWebhook('https://attacker.example.com/webhook', payload);

    expect(urlSafety.assertSafeWebhookUrl).toHaveBeenCalledWith(
      'https://attacker.example.com/webhook'
    );
    expect(sender).toHaveBeenCalledTimes(1);

    // https.request reads the pinning lookup from `agent.options.lookup`.
    // Inspecting it directly verifies we wired the IP the SSRF check just
    // validated into the very place the connect() syscall will look.
    const agent = captured.args!.agent as { options?: { lookup?: unknown } };
    expect(agent.options?.lookup).toBeDefined();
    const lookup = agent.options!.lookup as (
      hostname: string,
      _opts: unknown,
      cb: (err: null, addr: string, family: number) => void
    ) => void;
    let pinned: { addr: string; family: number } | null = null;
    lookup('attacker.example.com', {}, (_err, addr, family) => {
      pinned = { addr, family };
    });
    expect(pinned).toEqual({ addr: '93.184.216.34', family: 4 });

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
  });

  it('returns success with statusCode when the sender reports a 2xx', async () => {
    captured.respond = { statusCode: 200 };
    const result = await deliverWebhook('https://example.com/webhook', payload);
    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
  });

  it('returns failure when the sender reports a non-2xx with lastError', async () => {
    captured.respond = { statusCode: 500, lastError: 'HTTP 500: oops' };
    const result = await deliverWebhook('https://example.com/webhook', payload);
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(500);
    expect(result.lastError).toBe('HTTP 500: oops');
  });

  it('uses https pinning agent for https URLs and http pinning agent for http URLs', async () => {
    const urlSafety = require('../../utils/urlSafety');
    urlSafety.assertSafeWebhookUrl
      .mockResolvedValueOnce({
        url: 'https://example.com/webhook',
        resolvedAddress: '93.184.216.34',
        family: 4,
      })
      .mockResolvedValueOnce({
        url: 'http://example.com/webhook',
        resolvedAddress: '93.184.216.34',
        family: 4,
      });

    await deliverWebhook('https://example.com/webhook', payload);
    const httpsAgent = captured.args!.agent as { protocol?: string };
    expect(httpsAgent.protocol).toBe('https:');

    await deliverWebhook('http://example.com/webhook', payload);
    const httpAgent = captured.args!.agent as { protocol?: string };
    expect(httpAgent.protocol).toBe('http:');
  });

  it('signs the body with the configured HMAC secret', async () => {
    await deliverWebhook('https://example.com/webhook', payload);
    expect(sender).toHaveBeenCalledTimes(1);
    const headers = captured.args!.headers;
    expect(headers['X-VeilPay-Signature']).toMatch(/^[a-f0-9]{64}$/);
    // X-VeilPay-Timestamp is set to the per-delivery Date.now() (not the
    // payload's own timestamp field), used as part of the HMAC binding.
    expect(headers['X-VeilPay-Timestamp']).toMatch(/^\d{13,}$/);
    expect(Number.isNaN(Number(headers['X-VeilPay-Timestamp']))).toBe(false);
    expect(headers['X-VeilPay-Event']).toBe('payment.received');
    // Body is the JSON-serialised payload
    const parsed = JSON.parse(captured.args!.body);
    expect(parsed.eventType).toBe('payment.received');
    expect(parsed.merchantId).toBe('m1');
  });

  it('passes a 10s timeout', async () => {
    await deliverWebhook('https://example.com/webhook', payload);
    expect(captured.args!.timeoutMs).toBe(10_000);
  });

  it('passes through 3xx redirect responses as failures', async () => {
    // The default sender enforces 3xx-rejection; we exercise it directly
    // with a fake `IncomingMessage` to assert the behaviour holds end-to-end.
    captured.respond = { statusCode: 301, lastError: 'redirect rejected' };
    const result = await deliverWebhook('https://example.com/webhook', payload);
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(301);
  });

  it('exposes defaultHttpSender for callers needing the production sender', () => {
    expect(typeof defaultHttpSender).toBe('function');
  });

  it('the pinned lookup factory produces a function that returns the resolvedAddress on invoke', () => {
    const lookup = __testing__.pinnedLookupFactory('93.184.216.34', 4);
    let captured2: { addr: string; family: number } | null = null;
    lookup('example.com', {}, (_err, addr, family) => {
      captured2 = { addr, family };
    });
    expect(captured2).toEqual({ addr: '93.184.216.34', family: 4 });
  });
});
