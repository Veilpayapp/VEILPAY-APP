import {
  getFiatGatewayOrderAddress,
  isFiatGatewayOrderForAddress,
  normalizeFiatGatewayStatus,
  isPaymentIntentUrl,
  isAllowedOnrampUrl,
  FiatGatewayOrderLike,
} from '../fiatGateway';

describe('fiatGateway utility', () => {
  describe('getFiatGatewayOrderAddress', () => {
    it('returns null if order is null or undefined', () => {
      expect(getFiatGatewayOrderAddress(null)).toBeNull();
      expect(getFiatGatewayOrderAddress(undefined)).toBeNull();
    });

    it('returns walletAddress if it exists', () => {
      const order: FiatGatewayOrderLike = { walletAddress: '0x123' };
      expect(getFiatGatewayOrderAddress(order)).toBe('0x123');
    });

    it('returns userAddress if walletAddress does not exist', () => {
      const order: FiatGatewayOrderLike = { userAddress: '0xabc' };
      expect(getFiatGatewayOrderAddress(order)).toBe('0xabc');
    });

    it('returns null if neither walletAddress nor userAddress exists', () => {
      const order: FiatGatewayOrderLike = {};
      expect(getFiatGatewayOrderAddress(order)).toBeNull();
    });
  });

  describe('isFiatGatewayOrderForAddress', () => {
    it('returns false if order or address is null or undefined', () => {
      expect(isFiatGatewayOrderForAddress(null, '0x123')).toBe(false);
      expect(isFiatGatewayOrderForAddress({ walletAddress: '0x123' }, null)).toBe(false);
    });

    it('returns false if order address cannot be extracted', () => {
      expect(isFiatGatewayOrderForAddress({}, '0x123')).toBe(false);
    });

    it('returns true if addresses match case-insensitively', () => {
      expect(isFiatGatewayOrderForAddress({ walletAddress: '0x123' }, '0X123')).toBe(true);
      expect(isFiatGatewayOrderForAddress({ userAddress: '0XABC' }, '0xabc')).toBe(true);
    });

    it('returns false if addresses do not match', () => {
      expect(isFiatGatewayOrderForAddress({ walletAddress: '0x123' }, '0x456')).toBe(false);
    });
  });

  describe('normalizeFiatGatewayStatus', () => {
    it('returns the same status if it is a standard one', () => {
      expect(normalizeFiatGatewayStatus('initiated')).toBe('initiated');
      expect(normalizeFiatGatewayStatus('PENDING')).toBe('pending');
      expect(normalizeFiatGatewayStatus('processing')).toBe('processing');
      expect(normalizeFiatGatewayStatus('success')).toBe('success');
      expect(normalizeFiatGatewayStatus('completed')).toBe('completed');
      expect(normalizeFiatGatewayStatus('failed')).toBe('failed');
      expect(normalizeFiatGatewayStatus('cancelled')).toBe('cancelled');
    });

    it('normalizes succeeded to completed', () => {
      expect(normalizeFiatGatewayStatus('SUCCEEDED')).toBe('completed');
    });

    it('defaults to failed for unknown or empty statuses', () => {
      expect(normalizeFiatGatewayStatus('unknown_status')).toBe('failed');
      expect(normalizeFiatGatewayStatus(null)).toBe('failed');
      expect(normalizeFiatGatewayStatus(undefined)).toBe('failed');
    });
  });

  describe('isPaymentIntentUrl', () => {
    it('returns true for known payment intent protocols', () => {
      expect(isPaymentIntentUrl('upi://pay?pa=test')).toBe(true);
      expect(isPaymentIntentUrl('phonepe://pay')).toBe(true);
      expect(isPaymentIntentUrl('gpay://upi')).toBe(true);
      expect(isPaymentIntentUrl('intent://xyz')).toBe(true);
    });

    it('returns false for other protocols or standard urls', () => {
      expect(isPaymentIntentUrl('https://onramp.money')).toBe(false);
      expect(isPaymentIntentUrl('http://test')).toBe(false);
    });
  });

  describe('isAllowedOnrampUrl', () => {
    it('returns true for valid HTTPS onramp.money urls', () => {
      expect(isAllowedOnrampUrl('https://onramp.money')).toBe(true);
      expect(isAllowedOnrampUrl('https://widget.onramp.money/buy')).toBe(true);
    });

    it('returns false if protocol is not HTTPS', () => {
      expect(isAllowedOnrampUrl('http://onramp.money')).toBe(false);
    });

    it('returns false for other domains', () => {
      expect(isAllowedOnrampUrl('https://google.com')).toBe(false);
      expect(isAllowedOnrampUrl('https://onramp.money.fake.com')).toBe(false);
    });

    it('returns false for invalid urls', () => {
      expect(isAllowedOnrampUrl('invalid-url-string')).toBe(false);
    });
  });
});
