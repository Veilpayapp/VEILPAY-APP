export {};  // Force TypeScript module boundary to avoid TS2451 cross-file conflicts

const ORIGINAL_ENV = process.env;

process.env = {
  ...ORIGINAL_ENV,
  NODE_ENV: 'test',
  ONRAMP_MONEY_API_KEY: 'test-api-key',
  ONRAMP_MONEY_SECRET: 'test-secret',
};

const assert = require('node:assert/strict');
// Removed node:test import for Jest
const { createHmac } = require('node:crypto');

const { OnrampService } = require('../onramp');

describe('OnrampService', () => {
  afterAll(() => {
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

  it('maps supported chains to widget network names and uppercases the coin code', () => {
    const url = OnrampService.generateSignedUrl({
      userAddress: '0x1234567890abcdef1234567890abcdef12345678',
      fiatAmount: '5000',
      fiatCurrency: 'inr',
      cryptoToken: 'usdt',
      network: OnrampService.mapNetwork('base'),
      orderId: 'order-9',
    });

    assert.match(url, /network=base/);
    assert.match(url, /coinCode=USDT/);
    // Onramp.money expects the numeric fiatType id (INR=1), not the symbol.
    assert.match(url, /fiatType=1/);
  });

  it('maps fiat currencies to their numeric onramp fiatType ids', () => {
    assert.equal(OnrampService.mapFiat('INR'), '1');
    assert.equal(OnrampService.mapFiat('usd'), '21');
    assert.equal(OnrampService.mapFiat('EUR'), '12');
    assert.equal(OnrampService.mapFiat('GBP'), '20');
  });

  it('rejects fiat currencies Onramp.money does not support', () => {
    for (const code of ['JPY', 'CAD', 'CHF', 'XYZ', '']) {
      assert.throws(() => OnrampService.mapFiat(code), /does not support/);
    }
  });

  it('maps every supported network key without throwing', () => {
    for (const key of ['ethereum', 'polygon', 'bsc', 'arbitrum', 'optimism', 'base', 'solana']) {
      assert.equal(typeof OnrampService.mapNetwork(key), 'string');
    }
    // Case-insensitive.
    assert.equal(OnrampService.mapNetwork('BASE'), 'base');
  });

  it('rejects networks Onramp.money does not support', () => {
    for (const key of ['aptos', 'stellar', 'sepolia', 'solana-devnet']) {
      assert.throws(() => OnrampService.mapNetwork(key), /does not support/);
    }
  });

  it('verifies valid webhook signatures and rejects tampered payloads', () => {
    const payload = '{"status":"SUCCESS","orderId":"order-123"}';
    const signature = createHmac('sha256', 'test-secret').update(payload).digest('hex');

    assert.equal(OnrampService.verifyWebhook(payload, signature), true);
    assert.equal(OnrampService.verifyWebhook(payload, `${signature.slice(0, -1)}0`), false);
  });
});