import { deliverWebhook } from '../webhookDelivery';
import { config } from '../../config';

jest.mock('../../config', () => ({
  config: {
    webhookSigningSecret: 'test-secret'
  }
}));

describe('webhookDelivery', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should deliver webhook successfully', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
    });

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

    const result = await deliverWebhook('http://example.com', payload);
    
    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalled();
  });

  it('should return false if fetch fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      text: jest.fn().mockResolvedValue('Internal Server Error'),
    });

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

    const result = await deliverWebhook('http://example.com', payload);
    
    expect(result.success).toBe(false);
    expect(result.lastError).toContain('HTTP 500');
  });
});
