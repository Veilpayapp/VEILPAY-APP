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
 * Fiat currencies Onramp.money supports, mirroring the backend's
 * `OnrampService.FIAT_TYPE_MAP` numeric `fiatType` ids one-for-one. The backend
 * translates each `code` here into the numeric id the hosted widget requires
 * (INR=1, USD=21, …); keep the two lists in sync so the picker never offers a
 * currency the widget will reject with "Currency not supported".
 */
export const ONRAMP_FIAT_CURRENCIES = [
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham' },
  { code: 'TRY', symbol: '₺', name: 'Turkish Lira' },
  { code: 'MXN', symbol: '$', name: 'Mexican Peso' },
  { code: 'VND', symbol: '₫', name: 'Vietnamese Dong' },
  { code: 'NGN', symbol: '₦', name: 'Nigerian Naira' },
  { code: 'BRL', symbol: 'R$', name: 'Brazilian Real' },
  { code: 'PEN', symbol: 'S/', name: 'Peruvian Sol' },
  { code: 'COP', symbol: '$', name: 'Colombian Peso' },
  { code: 'CLP', symbol: '$', name: 'Chilean Peso' },
  { code: 'PHP', symbol: '₱', name: 'Philippine Peso' },
  { code: 'IDR', symbol: 'Rp', name: 'Indonesian Rupiah' },
  { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling' },
  { code: 'GHS', symbol: '₵', name: 'Ghanaian Cedi' },
  { code: 'ZAR', symbol: 'R', name: 'South African Rand' },
  { code: 'RWF', symbol: 'FRw', name: 'Rwandan Franc' },
  { code: 'XAF', symbol: 'FCFA', name: 'Central African CFA Franc' },
  { code: 'THB', symbol: '฿', name: 'Thai Baht' },
  { code: 'MYR', symbol: 'RM', name: 'Malaysian Ringgit' },
  { code: 'ARS', symbol: '$', name: 'Argentine Peso' },
  { code: 'EGP', symbol: 'E£', name: 'Egyptian Pound' },
];
