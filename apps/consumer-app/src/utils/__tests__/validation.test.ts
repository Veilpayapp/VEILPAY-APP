/**
 * Unit tests for validation.ts — EVM / SVM / XLM address formats.
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

      expect(getChainTypeFromKey('aptos')).toBeNull();

      expect(getChainTypeFromKey('stellar')).toBe('xlm');
      expect(getChainTypeFromKey('stellar-testnet')).toBe('xlm');
    });

    it('resolves every SUPPORTED_CHAINS key to a non-null chain type (drift guard)', () => {
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
    const validXlm = 'GB2S5N7HMX5W6NUXP2D7BZXMX6S7BZXMX6S7BZXMX6S7BZXMX6S7BZX3';

    it('fails immediately for falsy, non-string, or empty addresses', () => {
      expect(validateAddress('')).toBe(false);
      expect(validateAddress(null as any)).toBe(false);
      expect(validateAddress(undefined as any)).toBe(false);
      expect(validateAddress(12345 as any)).toBe(false);
    });

    it('successfully validates a single chain type explicitly', () => {
      expect(validateAddress(validEvm, 'evm')).toBe(true);
      expect(validateAddress('0x' + validEvm.slice(2).toUpperCase(), 'evm')).toBe(true);
      expect(validateAddress(validSvm, 'evm')).toBe(false);

      expect(validateAddress(validSvm, 'svm')).toBe(true);
      expect(validateAddress('invalidBase58AddressContaining0', 'svm')).toBe(false);

      expect(validateAddress(validXlm, 'xlm')).toBe(true);
      expect(
        validateAddress('HB2S5N7HMX5W6NUXP2D7BZXMX6S7BZXMX6S7BZXMX6S7BZXMX6S7BZX3', 'xlm')
      ).toBe(false);
    });

    it('validates across all patterns when chainType is omitted', () => {
      expect(validateAddress(validEvm)).toBe(true);
      expect(validateAddress(validSvm)).toBe(true);
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

    it('lowercases EVM addresses', () => {
      expect(normalizeAddress(mixedEvm, 'evm')).toBe(normalizedEvm);
    });

    it('returns original address format for SVM or XLM (case-sensitive formats)', () => {
      expect(normalizeAddress(validSvm, 'svm')).toBe(validSvm);
    });

    it('returns original address when chainType is omitted', () => {
      expect(normalizeAddress(mixedEvm)).toBe(mixedEvm);
      expect(normalizeAddress(validSvm)).toBe(validSvm);
    });
  });

  describe('walletStore delegates match canonical validation', () => {
    const chainTypes: ChainType[] = ['evm', 'svm', 'xlm'];

    const samples: string[] = [
      '0x9858effd232b4033e47d90003d41ec34ecaeda94',
      '5tzGtK1xNn86nKBgvwB3gG3nZz6f81sF6zM99m4rZgLg',
      'GB2S5N7HMX5W6NUXP2D7BZXMX6S7BZXMX6S7BZXMX6S7BZXMX6S7BZX3',
      '',
      '0x',
      '0x' + 'a'.repeat(64),
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
  });

  describe('chains.ts delegates match canonical validation', () => {
    const chainTypes: ChainType[] = ['evm', 'svm', 'xlm'];
    const samples: string[] = [
      '0x9858effd232b4033e47d90003d41ec34ecaeda94',
      '5tzGtK1xNn86nKBgvwB3gG3nZz6f81sF6zM99m4rZgLg',
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
