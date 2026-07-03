/**
 * Onramp.money Mapper Utility
 * 
 * Loopholes Addressed:
 * - Network/Token mapping errors: Ensures we never send a user to the wrong network.
 * - Currency Defaults: Handles INR as the base currency for the Indian market.
 */

export interface OnrampConfig {
  coinCode: string;
  network: string;
}

/**
 * Maps VeilPay internal tokens/networks to Onramp.money codes.
 */
export const getOnrampConfig = (tokenSymbol: string, chainKey: string): OnrampConfig => {
  const symbol = tokenSymbol.toUpperCase();
  const chain = chainKey.toLowerCase();

  // Network Mapping
  const networkMap: Record<string, string> = {
    'ethereum': 'ethereum',
    'polygon': 'polygon',
    'arbitrum': 'arbitrum',
    'base': 'base',
    'optimism': 'optimism',
    'bsc': 'bsc',
    'solana': 'solana',
  };

  // Token Override Mapping — must match Onramp.money's expected coinCode values
  const tokenMap: Record<string, string> = {
    'USDC': 'USDC',
    'USDT': 'USDT',
    'ETH': 'ETH',
    'POL': 'POL',
    'MATIC': 'MATIC',
    'SOL': 'SOL',
    'BNB': 'BNB',
    'AVAX': 'AVAX',
    'TRX': 'TRX',
    'DAI': 'DAI',
  };

  return {
    coinCode: tokenMap[symbol] || symbol,
    network: networkMap[chain] || chain,
  };
};

/**
 * Supported Fiat Currencies for Onramp.money in VeilPay.
 * Onramp.money's widget reliably supports INR only for most token/chain combos.
 */
export const ONRAMP_FIAT_CURRENCIES = [
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
];
