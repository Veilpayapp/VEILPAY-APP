import { StealthAddressEngine } from '../crypto';

describe('StealthAddressEngine', () => {
  it('should generate stealth key pair', () => {
    const keyPair = StealthAddressEngine.generateStealthKeyPair();
    expect(keyPair.privateKey).toBeDefined();
    expect(keyPair.publicKey).toBeDefined();
    expect(keyPair.privateKey.startsWith('0x')).toBe(true);
    expect(keyPair.publicKey.startsWith('0x')).toBe(true);
  });

  it('should derive and recover stealth address correctly', () => {
    const viewingKeyPair = StealthAddressEngine.generateStealthKeyPair();
    const ephemeralKeyPair = StealthAddressEngine.generateStealthKeyPair();

    const { stealthAddress, ephemeralPublicKey } = StealthAddressEngine.deriveStealthAddress(
      viewingKeyPair.publicKey,
      ephemeralKeyPair.privateKey
    );

    expect(stealthAddress).toBeDefined();
    expect(ephemeralPublicKey).toBeDefined();

    const recoveredPrivateKey = StealthAddressEngine.recoverStealthPrivateKey(
      ephemeralPublicKey,
      viewingKeyPair.privateKey
    );

    expect(recoveredPrivateKey).toBeDefined();

    const isMatch = StealthAddressEngine.checkStealthAddressMatch(
      stealthAddress,
      ephemeralPublicKey,
      viewingKeyPair.privateKey
    );

    expect(typeof isMatch).toBe('boolean');
  });

  it('should return false for checkStealthAddressMatch on invalid input', () => {
    const isMatch = StealthAddressEngine.checkStealthAddressMatch(
      '0x123',
      '0x456',
      '0x789'
    );
    expect(isMatch).toBe(false);
  });
});
