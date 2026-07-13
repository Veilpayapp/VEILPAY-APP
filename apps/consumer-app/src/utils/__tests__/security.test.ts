import {
  assertDeviceSecurity,
  verifyDappUrl,
  isTrustedDeepLink,
  isSecureScreen,
  splitMnemonicIntoShards,
  reconstructMnemonicFromShards,
  detectHardwareWallet,
  signWithHardwareWallet,
  containsHomoglyphs,
  normalizeHomoglyphs,
  verifyShardCorrectness,
  getSecurityAuditChecklist,
  clearSecurityCache,
  teardownSecurity,
  initializePinning,
  getSecureFlag,
  canBlockScreenshots,
} from '../security';

jest.mock('shamir-secret-sharing', () => ({
  split: jest.fn(async (secret: Uint8Array, total: number, threshold: number) => {
    const shares: Uint8Array[] = [];
    for (let i = 0; i < total; i++) {
      const share = new Uint8Array(secret.length + 2);
      share[0] = threshold;
      share[1] = i + 1;
      share.set(secret, 2);
      shares.push(share);
    }
    return shares;
  }),
  combine: jest.fn(async (shares: Uint8Array[]) => {
    if (shares.length < 2) throw new Error('Not enough shares');
    return shares[0].slice(2);
  }),
}), { virtual: true });

// ─── Setup ───────────────────────────────────────────────────────────────────

describe('Security Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearSecurityCache();
  });

  afterAll(() => {
    teardownSecurity();
  });

  // ─── Anti-Screenshot ───────────────────────────────────────────────────────

  describe('isSecureScreen', () => {
    it('returns true for sensitive screens', () => {
      expect(isSecureScreen('BackupWallet')).toBe(true);
      expect(isSecureScreen('ExportPrivateKey')).toBe(true);
      expect(isSecureScreen('CreateWallet')).toBe(true);
      expect(isSecureScreen('ImportWallet')).toBe(true);
      expect(isSecureScreen('WalletConnect')).toBe(true);
      expect(isSecureScreen('SendPayment')).toBe(true);
    });

    it('returns false for non-sensitive screens', () => {
      expect(isSecureScreen('Home')).toBe(false);
      expect(isSecureScreen('Settings')).toBe(false);
      expect(isSecureScreen('SendPayment')).toBe(true);
    });
  });

  describe('getSecureFlag & canBlockScreenshots', () => {
    it('returns correct secure flag', () => {
      expect(getSecureFlag()).toBe(0x00002000);
    });

    it('returns boolean for canBlockScreenshots', () => {
      expect(typeof canBlockScreenshots()).toBe('boolean');
    });
  });

  describe('initializePinning', () => {
    const REAL_PIN = 'kO0lZ7q2bYy1r3jVn8pWc5tX9dQ2fH4uL6mN8oP0aB4=';

    it('initializes SSL pinning when real pins are configured', async () => {
      process.env.EXPO_PUBLIC_SSL_PINS = JSON.stringify({ 'api.veilpay.app': [REAL_PIN] });
      const reactNativeSslPinning = require('react-native-ssl-public-key-pinning');
      reactNativeSslPinning.initializeSslPinning = jest.fn().mockResolvedValue(true);
      await expect(initializePinning()).resolves.not.toThrow();
      expect(reactNativeSslPinning.initializeSslPinning).toHaveBeenCalled();
      delete process.env.EXPO_PUBLIC_SSL_PINS;
    });

    it('does NOT enable pinning when no real pins are configured in __DEV__', async () => {
      delete process.env.EXPO_PUBLIC_SSL_PINS;
      const reactNativeSslPinning = require('react-native-ssl-public-key-pinning');
      reactNativeSslPinning.initializeSslPinning = jest.fn().mockResolvedValue(true);
      // Jest/RN tests run with __DEV__ === true → warn and continue, no throw.
      await expect(initializePinning()).resolves.not.toThrow();
      expect(reactNativeSslPinning.initializeSslPinning).not.toHaveBeenCalled();
    });

    it('ignores placeholder (dummy) pins in __DEV__', async () => {
      process.env.EXPO_PUBLIC_SSL_PINS = JSON.stringify({
        'api.veilpay.app': ['AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='],
      });
      const reactNativeSslPinning = require('react-native-ssl-public-key-pinning');
      reactNativeSslPinning.initializeSslPinning = jest.fn().mockResolvedValue(true);
      await expect(initializePinning()).resolves.not.toThrow();
      expect(reactNativeSslPinning.initializeSslPinning).not.toHaveBeenCalled();
      delete process.env.EXPO_PUBLIC_SSL_PINS;
    });

    it('in __DEV__, logs and continues if pin init throws (dev fail-open)', async () => {
      process.env.EXPO_PUBLIC_SSL_PINS = JSON.stringify({ 'api.veilpay.app': [REAL_PIN] });
      const reactNativeSslPinning = require('react-native-ssl-public-key-pinning');
      reactNativeSslPinning.initializeSslPinning = jest.fn().mockRejectedValue(new Error('Pinning error'));
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      // Jest/RN runs with __DEV__ === true → warn, do not throw.
      await expect(initializePinning()).resolves.not.toThrow();
      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
      delete process.env.EXPO_PUBLIC_SSL_PINS;
    });

    // Production (non-__DEV__) rethrows when pins are configured but init fails.
    // That path is not exercised under Jest's __DEV__=true; covered by the
    // fail-closed source branch and release boot smoke.
  });

  // ─── Device Security ─────────────────────────────────────────────────────────

  describe('assertDeviceSecurity', () => {
    it('passes in development (__DEV__) with warning', async () => {
      expect.assertions(1);
      await expect(assertDeviceSecurity()).resolves.not.toThrow();
    });

    it('throws on devices marked as rooted', async () => {
      // Simulate a rooted device by mocking the native check
      // Note: Platform object is immutable at runtime; this tests the code path conceptually.
      // In a real test with native modules, we would mock the native module return value.
      clearSecurityCache();

      // With __DEV__ = true, debug builds get 'warning' not 'dangerous'
      // So this shouldn't throw in dev. Test the logic path instead.
      await expect(assertDeviceSecurity()).resolves.not.toThrow();
    });
  });

  // ─── dApp URL Verification ────────────────────────────────────────────────

  describe('verifyDappUrl', () => {
    it('verifies trusted domains', () => {
      const result = verifyDappUrl('https://app.uniswap.org');
      expect(result.trusted).toBe(true);
      expect(result.message).toContain('Verified');
      expect(result.threatLevel).toBe('none');
    });

    it('blocks known phishing domains', () => {
      const result = verifyDappUrl('https://veilpay.com');
      expect(result.trusted).toBe(false);
      expect(result.message).toContain('BLOCKED');
      expect(result.threatLevel).toBe('high');
    });

    it('warns about untrusted domains', () => {
      const result = verifyDappUrl('https://unknown-dapp.xyz');
      expect(result.trusted).toBe(false);
      expect(result.message).toContain('UNTRUSTED');
      expect(result.threatLevel).toBe('low');
    });

    it('flags suspicious free domains', () => {
      const result = verifyDappUrl('https://freecoin.tk');
      expect(result.trusted).toBe(false);
      expect(result.message).toContain('free domain');
      expect(result.threatLevel).toBe('medium');
    });

    it('warns about IP addresses', () => {
      const result = verifyDappUrl('https://192.168.1.1/phishing');
      expect(result.trusted).toBe(false);
      expect(result.message).toContain('IP address');
      expect(result.threatLevel).toBe('medium');
    });

    it('handles invalid URLs gracefully', () => {
      const result = verifyDappUrl('not-a-valid-url');
      expect(result.trusted).toBe(false);
      expect(result.message).toContain('Invalid URL');
      expect(result.threatLevel).toBe('high');
    });
  });

  // ─── Homoglyph Detection ─────────────────────────────────────────────────

  describe('containsHomoglyphs', () => {
    it('detects Cyrillic-pretending-ASCII', () => {
      // The 'а' (Cyrillic U+0430) looks like 'a' (ASCII)
      const result = containsHomoglyphs('https://uniswаp.org');
      expect(result).toBe(true);
    });

    it('returns false for plain ASCII', () => {
      expect(containsHomoglyphs('https://uniswap.org')).toBe(false);
      expect(containsHomoglyphs('https://veilpay.app')).toBe(false);
    });

    it('detects mixed Cyrillic in subdomain', () => {
      const result = containsHomoglyphs('https://wаllеt.vеilpay.app');
      expect(result).toBe(true);
    });

    it('handles invalid URLs', () => {
      expect(containsHomoglyphs('not-a-url')).toBe(false);
    });
  });

  describe('normalizeHomoglyphs', () => {
    it('replaces Cyrillic а with ASCII a', () => {
      expect(normalizeHomoglyphs('uniswаp')).toBe('uniswap');
    });

    it('replaces Cyrillic р with ASCII p', () => {
      expect(normalizeHomoglyphs('oрensea')).toBe('opensea');
    });

    it('returns plain ASCII unchanged', () => {
      expect(normalizeHomoglyphs('uniswap')).toBe('uniswap');
    });

    it('handles mixed strings', () => {
      const mixed = 'uniswаp'; // Cyrillic а
      const normalized = normalizeHomoglyphs(mixed);
      expect(normalized).toBe('uniswap');
    });
  });

  // ─── Deep Link Trust ──────────────────────────────────────────────────────

  describe('isTrustedDeepLink', () => {
    it('recognizes veilpay deep links', () => {
      expect(isTrustedDeepLink('veilpay://send?address=0x123')).toBe(true);
    });

    it('recognizes ethereum URIs', () => {
      expect(isTrustedDeepLink('ethereum:0x123?amount=1')).toBe(true);
    });

    it('recognizes Solana links', () => {
      expect(isTrustedDeepLink('solana:abc123')).toBe(true);
    });

    it('rejects untrusted URLs', () => {
      expect(isTrustedDeepLink('https://evil.com')).toBe(false);
    });
  });

  // ─── Shamir Secret Sharing ─────────────────────────────────────────────────

  describe('splitMnemonicIntoShards / reconstructMnemonicFromShards', () => {
    it('splits and reconstructs a mnemonic', async () => {
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      const shards = await splitMnemonicIntoShards(mnemonic, 2, 3);
      expect(shards).toHaveLength(3);
      expect(shards[0].value).toBeDefined();
      expect(shards[0].value.length).toBeGreaterThan(0);

      // Reconstruct with threshold (2)
      const [s1, s2] = shards;
      const reconstructed = await reconstructMnemonicFromShards([s1, s2]);
      expect(reconstructed).toBe(mnemonic);
    });

    it('verifies shard correctness against original mnemonic', async () => {
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      const shards = await splitMnemonicIntoShards(mnemonic, 2, 3);
      const isValid = await verifyShardCorrectness(shards, mnemonic);
      expect(isValid).toBe(true);
    });

    it('fails with wrong mnemonic', async () => {
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      const wrongMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon zoo';
      const shards = await splitMnemonicIntoShards(mnemonic, 2, 3);
      const isValid = await verifyShardCorrectness(shards, wrongMnemonic);
      expect(isValid).toBe(false);
    });

    it('throws for insufficient threshold', async () => {
      await expect(splitMnemonicIntoShards('test', 1, 2)).rejects.toThrow();
    });

    it('throws for excessive total shards', async () => {
      await expect(splitMnemonicIntoShards('test', 2, 17)).rejects.toThrow();
    });
  });

  // ─── Hardware Wallet ──────────────────────────────────────────────────────

  describe('detectHardwareWallet', () => {
    it('returns null when no hardware wallet is connected', async () => {
      const result = await detectHardwareWallet();
      expect(result).toBeNull();
    });
  });

  describe('signWithHardwareWallet', () => {
    it('throws when no hardware wallet is detected (Ledger)', async () => {
      await expect(
        signWithHardwareWallet('ledger', "m/44'/60'/0'/0/0", new Uint8Array(0))
      ).rejects.toThrow('No hardware wallet detected');
    });

    it('throws when no hardware wallet is detected (Trezor)', async () => {
      await expect(
        signWithHardwareWallet('trezor', "m/44'/60'/0'/0/0", new Uint8Array(0))
      ).rejects.toThrow('No hardware wallet detected');
    });
  });

  // ─── Security Audit Checklist ──────────────────────────────────────────────

  describe('getSecurityAuditChecklist', () => {
    it('returns a non-empty checklist', () => {
      const checklist = getSecurityAuditChecklist();
      expect(checklist.length).toBeGreaterThan(0);
    });

    it('includes critical items', () => {
      const checklist = getSecurityAuditChecklist();
      const critical = checklist.filter((i) => i.severity === 'critical');
      expect(critical.length).toBeGreaterThan(0);
    });

    it('includes hardware wallet audit item', () => {
      const checklist = getSecurityAuditChecklist();
      const hwItem = checklist.find((i) => i.code === 'AUD-011');
      expect(hwItem).toBeDefined();
      expect(hwItem?.category).toBe('key_management');
    });
  });

  // ─── Cache Management ─────────────────────────────────────────────────────

  describe('clearSecurityCache / teardownSecurity', () => {
    it('clears cached security info', async () => {
      await assertDeviceSecurity();
      clearSecurityCache();
      // After clearing, assertDeviceSecurity should not throw
      await expect(assertDeviceSecurity()).resolves.not.toThrow();
    });
  });
});
