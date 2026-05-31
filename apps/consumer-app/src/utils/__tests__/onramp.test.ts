/**
 * Andrej Karpathy first-principles style unit tests for onramp.ts
 * Covers token symbols, network mapping overrides, base parameters, and default supported fiat currencies.
 */

import { getOnrampConfig, ONRAMP_FIAT_CURRENCIES } from '../onramp';

describe('onramp utility tests', () => {
  describe('getOnrampConfig', () => {
    it('successfully maps common native and ERC20 tokens onto network combinations', () => {
      // 1. USDC on Arbitrum
      const config1 = getOnrampConfig('USDC', 'arbitrum');
      expect(config1).toEqual({
        coinCode: 'USDC',
        network: 'arbitrum',
      });

      // 2. ETH on Ethereum
      const config2 = getOnrampConfig('eth', 'Ethereum');
      expect(config2).toEqual({
        coinCode: 'ETH',
        network: 'ethereum',
      });

      // 3. Solana native SOL
      const config3 = getOnrampConfig('SOL', 'solana');
      expect(config3).toEqual({
        coinCode: 'SOL',
        network: 'solana',
      });
    });

    it('falls back to uppercase symbol and lowercase network if mapping is not explicitly overridden', () => {
      const config = getOnrampConfig('doge', 'Dogechain');
      expect(config).toEqual({
        coinCode: 'DOGE',
        network: 'dogechain',
      });
    });
  });

  describe('ONRAMP_FIAT_CURRENCIES', () => {
    it('contains valid and premium localized fiat default values', () => {
      expect(ONRAMP_FIAT_CURRENCIES).toContainEqual({
        code: 'INR',
        symbol: '₹',
        name: 'Indian Rupee',
      });
      expect(ONRAMP_FIAT_CURRENCIES).toContainEqual({
        code: 'USD',
        symbol: '$',
        name: 'US Dollar',
      });
    });
  });
});
