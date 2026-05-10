const ORIGINAL_ENV = process.env;

process.env = {
  ...ORIGINAL_ENV,
  NODE_ENV: 'test',
  ONRAMP_MONEY_API_KEY: 'test-api-key',
  ONRAMP_MONEY_SECRET: 'test-secret',
};

const assert = require('node:assert/strict');
const { after, describe, it } = require('node:test');
const { createHmac } = require('node:crypto');

const { OnrampService } = require('../onramp');

describe('OnrampService', () => {
  after(() => {
    process.env = ORIGINAL_ENV;
  });

  it('includes the internal order id in the signed widget url', () => {
    const url = OnrampService.generateSignedUrl({
      userAddress: '0x1234567890abcdef1234567890abcdef12345678',
      fiatAmount: '5000',
      fiatCurrency: 'INR',
      cryptoToken: 'ETH',
      network: 'ethereum',
      orderId: 'order-123',
    });

    assert.match(url, /orderId=order-123/);
    assert.match(url, /partnerOrderId=order-123/);
    assert.match(url, /signature=/);
  });

  it('verifies valid webhook signatures and rejects tampered payloads', () => {
    const payload = '{"status":"SUCCESS","orderId":"order-123"}';
    const signature = createHmac('sha256', 'test-secret').update(payload).digest('hex');

    assert.equal(OnrampService.verifyWebhook(payload, signature), true);
    assert.equal(OnrampService.verifyWebhook(payload, `${signature.slice(0, -1)}0`), false);
  });
});