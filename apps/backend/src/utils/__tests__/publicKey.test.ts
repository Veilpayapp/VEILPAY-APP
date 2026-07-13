import { SigningKey } from 'ethers';
import { validatePublishedViewingKey } from '../publicKey';

// A real secp256k1 keypair used to derive valid public-key encodings.
const PRIV = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const EVM_COMPRESSED = SigningKey.computePublicKey(PRIV, true); // 33 bytes, 0x02/0x03
const EVM_UNCOMPRESSED = SigningKey.computePublicKey(PRIV, false); // 65 bytes, 0x04

describe('validatePublishedViewingKey', () => {
  describe('evm (secp256k1)', () => {
    it('accepts a compressed public key', () => {
      expect(validatePublishedViewingKey('evm', EVM_COMPRESSED).ok).toBe(true);
    });

    it('accepts an uncompressed public key', () => {
      expect(validatePublishedViewingKey('evm', EVM_UNCOMPRESSED).ok).toBe(true);
    });

    it('accepts a compressed key without the 0x prefix', () => {
      expect(validatePublishedViewingKey('evm', EVM_COMPRESSED.slice(2)).ok).toBe(true);
    });

    it('rejects a 32-byte private key', () => {
      const r = validatePublishedViewingKey('evm', PRIV);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/PRIVATE key/);
    });

    it('rejects an off-curve 33-byte value with a valid prefix', () => {
      const r = validatePublishedViewingKey('evm', '0x02' + '11'.repeat(32));
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/secp256k1 curve/);
    });

    it('rejects non-hex / placeholder strings', () => {
      expect(validatePublishedViewingKey('evm', 'vk_test_key').ok).toBe(false);
      expect(validatePublishedViewingKey('evm', '').ok).toBe(false);
    });
  });

  describe('svm (ed25519 base58)', () => {
    it('accepts a 32-byte base58 public key', () => {
      expect(
        validatePublishedViewingKey('svm', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA').ok
      ).toBe(true);
      expect(
        validatePublishedViewingKey('svm', '11111111111111111111111111111111').ok
      ).toBe(true);
    });

    it('rejects a base58 string that does not decode to 32 bytes', () => {
      // Too short (< 32 bytes) — same branch that rejects a 64-byte secret key.
      const r = validatePublishedViewingKey('svm', 'abc');
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/32-byte/);
    });

    it('rejects invalid base58 characters (0, O, I, l)', () => {
      expect(validatePublishedViewingKey('svm', '0000000000000000000000000000000O').ok).toBe(false);
    });
  });

  describe('xlm (StrKey)', () => {
    // ed25519 public key all-zeros with valid CRC16-XModem (Stellar StrKey).
    const VALID_G = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

    it('accepts a G… public key with valid checksum', () => {
      expect(validatePublishedViewingKey('xlm', VALID_G).ok).toBe(true);
    });

    it('rejects a G… key that fails the StrKey checksum', () => {
      const r = validatePublishedViewingKey('xlm', 'G' + 'A'.repeat(55));
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/checksum/i);
    });

    it('rejects an S… secret seed', () => {
      const r = validatePublishedViewingKey('xlm', 'S' + 'A'.repeat(55));
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/secret keys/i);
    });

    it('rejects wrong-length or wrong-charset StrKeys', () => {
      expect(validatePublishedViewingKey('xlm', 'GABC').ok).toBe(false);
      expect(validatePublishedViewingKey('xlm', 'G' + '1'.repeat(55)).ok).toBe(false); // 0,1,8,9 not in base32 alphabet
    });
  });
});
