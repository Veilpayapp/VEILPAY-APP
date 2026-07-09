/**
 * Andrej Karpathy first-principles style unit tests for validation.ts
 * Thoroughly covers getChainTypeFromKey, address formatting/patterns (EVM, SVM, MVM, XLM),
 * multi-chain validations, and normalizations under valid/invalid states.
 */

import { getChainTypeFromKey, validateAddress, normalizeAddress } from '../validation';
import {
  SUPPORTED_CHAINS,
  validateAddress as chainsValidateAddress,
  normalizeAddress as chainsNormalizeAddress,
} from '../chains';
import {
  validateAddress as storeValidateAddress,
  normalizeAddress as storeNormalizeAddress,
  type ChainType,
} from '../../stores/walletStore';

describe('validation utility tests', () => {
  describe('getChainTypeFromKey', () => {
    it('correctly maps known blockchain identifiers to supported chain types', () => {
      expect(getChainTypeFromKey('ethereum')).toBe('evm');
      expect(getChainTypeFromKey('bsc')).toBe('evm');
      expect(getChainTypeFromKey('polygon')).toBe('evm');
      expect(getChainTypeFromKey('arbitrum')).toBe('evm');
      expect(getChainTypeFromKey('base')).toBe('evm');
      expect(getChainTypeFromKey('sepolia')).toBe('evm');

      expect(getChainTypeFromKey('solana')).toBe('svm');
      expect(getChainTypeFromKey('solana-devnet')).toBe('svm');

      expect(getChainTypeFromKey('aptos')).toBe('mvm');

      expect(getChainTypeFromKey('stellar')).toBe('xlm');
      expect(getChainTypeFromKey('stellar-testnet')).toBe('xlm');
    });

    it('resolves every SUPPORTED_CHAINS key to a non-null chain type (drift guard)', () => {
      // The map must stay in lockstep with the chain registry — a supported chain
      // that resolves to null silently breaks address validation and routing for
      // that chain. This catches any future chain added to chains.ts without a
      // corresponding CHAIN_TYPES_BY_KEY entry (as happened with `base`).
      for (const chain of SUPPORTED_CHAINS) {
        expect(getChainTypeFromKey(chain.key)).not.toBeNull();
      }
    });

    it('returns null for unknown keys', () => {
      expect(getChainTypeFromKey('cardano')).toBeNull();
      expect(getChainTypeFromKey('')).toBeNull();
      expect(getChainTypeFromKey('bitcoin')).toBeNull();
    });
  });

  describe('validateAddress', () => {
    const validEvm = '0x9858effd232b4033e47d90003d41ec34ecaeda94';
    const validSvm = '5tzGtK1xNn86nKBgvwB3gG3nZz6f81sF6zM99m4rZgLg';
    const validMvm = '0x9858effd232b4033e47d90003d41ec34ecaeda94a8f8d8b8c8b8b8b8b8b8b8b8';
    const validXlm = 'GB2S5N7HMX5W6NUXP2D7BZXMX6S7BZXMX6S7BZXMX6S7BZXMX6S7BZX3';

    it('fails immediately for falsy, non-string, or empty addresses', () => {
      expect(validateAddress('')).toBe(false);
      expect(validateAddress(null as any)).toBe(false);
      expect(validateAddress(undefined as any)).toBe(false);
      expect(validateAddress(12345 as any)).toBe(false);
    });

    it('successfully validates a single chain type explicitly', () => {
      // EVM
      expect(validateAddress(validEvm, 'evm')).toBe(true);
      // '0x' + uppercase hex chars (keep 0x lowercase)
      expect(validateAddress('0x' + validEvm.slice(2).toUpperCase(), 'evm')).toBe(true);
      expect(validateAddress(validSvm, 'evm')).toBe(false);

      // SVM (Solana)
      expect(validateAddress(validSvm, 'svm')).toBe(true);
      expect(validateAddress('invalidBase58AddressContaining0', 'svm')).toBe(false); // '0' is invalid in Base58

      // MVM (Aptos)
      expect(validateAddress(validMvm, 'mvm')).toBe(true);
      expect(validateAddress('0xinvalidHexChars', 'mvm')).toBe(false);

      // XLM (Stellar)
      expect(validateAddress(validXlm, 'xlm')).toBe(true);
      expect(validateAddress('HB2S5N7HMX5W6NUXP2D7BZXMX6S7BZXMX6S7BZXMX6S7BZXMX6S7BZX3', 'xlm')).toBe(false); // Must start with G
    });

    it('validates across all patterns when chainType is omitted', () => {
      expect(validateAddress(validEvm)).toBe(true);
      expect(validateAddress(validSvm)).toBe(true);
      expect(validateAddress(validMvm)).toBe(true);
      expect(validateAddress(validXlm)).toBe(true);
      expect(validateAddress('completely-invalid-address-string')).toBe(false);
    });
  });

  describe('normalizeAddress', () => {
    const mixedEvm = '0x9858EfFd232b4033e47d90003d41ec34ecaeda94';
    const normalizedEvm = '0x9858effd232b4033e47d90003d41ec34ecaeda94';
    const validSvm = '5tzGtK1xNn86nKBgvwB3gG3nZz6f81sF6zM99m4rZgLg';

    it('returns null if address is invalid', () => {
      expect(normalizeAddress('invalid-addr', 'evm')).toBeNull();
      expect(normalizeAddress('')).toBeNull();
    });

    it('lowercases EVM and MVM addresses', () => {
      expect(normalizeAddress(mixedEvm, 'evm')).toBe(normalizedEvm);
      expect(normalizeAddress('0xABCDEF1234', 'mvm')).toBe('0xabcdef1234');
    });

    it('returns original address format for SVM or XLM (case-sensitive formats)', () => {
      expect(normalizeAddress(validSvm, 'svm')).toBe(validSvm);
    });

    it('returns normalized address if valid but chainType is omitted (EVM remains unchanged if chainType not provided)', () => {
      // Since chainType is omitted, the function falls back to returning the original string
      expect(normalizeAddress(mixedEvm)).toBe(mixedEvm);
      expect(normalizeAddress(validSvm)).toBe(validSvm);
    });
  });

  // Regression guard for the "two divergent validateAddress implementations"
  // finding: `stores/walletStore.ts` used to carry its own copy of the
  // address-format logic (with a redundant `length <= 66` mvm clause). It now
  // delegates to `utils/validation.ts`. These tests assert the store's exported
  // delegates agree with the canonical implementation for every chain type and
  // for the edge cases that first exposed the drift.
  describe('walletStore delegates match canonical validation', () => {
    const chainTypes: ChainType[] = ['evm', 'svm', 'mvm', 'xlm'];

    const samples: string[] = [
      // valid-ish per chain
      '0x9858effd232b4033e47d90003d41ec34ecaeda94',
      '5tzGtK1xNn86nKBgvwB3gG3nZz6f81sF6zM99m4rZgLg',
      '0x9858effd232b4033e47d90003d41ec34ecaeda94a8f8d8b8c8b8b8b8b8b8b8b8',
      'GB2S5N7HMX5W6NUXP2D7BZXMX6S7BZXMX6S7BZXMX6S7BZXMX6S7BZX3',
      // edge cases
      '',
      '0x',
      // Aptos boundary: exactly 66 chars (0x + 64 hex) — must be valid mvm on both
      '0x' + 'a'.repeat(64),
      // 67-char over-length hex — must be rejected as mvm on both
      '0x' + 'a'.repeat(65),
      'not-an-address',
    ];

    it('agrees on validateAddress across all chain types and samples', () => {
      for (const chainType of chainTypes) {
        for (const sample of samples) {
          expect(storeValidateAddress(sample, chainType)).toBe(
            validateAddress(sample, chainType)
          );
        }
      }
    });

    it('agrees on normalizeAddress across all chain types and samples', () => {
      for (const chainType of chainTypes) {
        for (const sample of samples) {
          expect(storeNormalizeAddress(sample, chainType)).toBe(
            normalizeAddress(sample, chainType)
          );
        }
      }
    });

    it('rejects over-length Aptos (mvm) addresses on both entry points', () => {
      const overLong = '0x' + 'a'.repeat(65); // 67 chars total
      expect(validateAddress(overLong, 'mvm')).toBe(false);
      expect(storeValidateAddress(overLong, 'mvm')).toBe(false);
    });
  });

  // A2: chains.ts used to carry a third copy of the address-format logic.
  // It now delegates to validation.ts the same way walletStore does.
  describe('chains.ts delegates match canonical validation', () => {
    const chainTypes: ChainType[] = ['evm', 'svm', 'mvm', 'xlm'];
    const samples: string[] = [
      '0x9858effd232b4033e47d90003d41ec34ecaeda94',
      '5tzGtK1xNn86nKBgvwB3gG3nZz6f81sF6zM99m4rZgLg',
      '0x' + 'a'.repeat(64),
      '0x' + 'a'.repeat(65),
      'GB2S5N7HMX5W6NUXP2D7BZXMX6S7BZXMX6S7BZXMX6S7BZXMX6S7BZX3',
      '',
      'not-an-address',
    ];

    it('agrees on validateAddress across all chain types and samples', () => {
      for (const chainType of chainTypes) {
        for (const sample of samples) {
          expect(chainsValidateAddress(sample, chainType)).toBe(
            validateAddress(sample, chainType)
          );
        }
      }
    });

    it('agrees on normalizeAddress across all chain types and samples', () => {
      for (const chainType of chainTypes) {
        for (const sample of samples) {
          expect(chainsNormalizeAddress(sample, chainType)).toBe(
            normalizeAddress(sample, chainType)
          );
        }
      }
    });
  });
});
