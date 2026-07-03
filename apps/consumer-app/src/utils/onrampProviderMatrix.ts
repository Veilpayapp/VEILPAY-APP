/**
 * On-Ramp Provider Support Matrix
 *
 * Defines which chains and tokens each on-ramp provider supports.
 * Used to filter the quote list and prevent users from selecting
 * a provider that cannot deliver funds to their target chain.
 */

export interface ProviderCapability {
  /** Human-readable provider name */
  name: string;
  /** Internal provider ID (matches backend quote `provider` field) */
  id: string;
  /** Chain keys this provider supports */
  supportedChains: ReadonlySet<string>;
  /** Fiat currencies this provider supports */
  supportedFiatCurrencies: ReadonlySet<string>;
}

const ONRAMP_MONEY: ProviderCapability = {
  name: 'Onramp.money',
  id: 'onramp_money',
  supportedChains: new Set([
    'ethereum',
    'polygon',
    'arbitrum',
    'base',
    'optimism',
    'bsc',
    'solana',
  ]),
  supportedFiatCurrencies: new Set(['INR']),
};

const MOONPAY: ProviderCapability = {
  name: 'MoonPay',
  id: 'moonpay',
  supportedChains: new Set([
    'ethereum',
    'polygon',
    'arbitrum',
    'base',
    'optimism',
    'bsc',
    'solana',
  ]),
  supportedFiatCurrencies: new Set([
    'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'INR', 'JPY',
  ]),
};

const TRANSAK: ProviderCapability = {
  name: 'Transak',
  id: 'transak',
  supportedChains: new Set([
    'ethereum',
    'polygon',
    'arbitrum',
    'base',
    'bsc',
    'solana',
    'avalanche',
  ]),
  supportedFiatCurrencies: new Set([
    'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'INR', 'JPY',
  ]),
};

export const PROVIDER_MATRIX: ReadonlyMap<string, ProviderCapability> = new Map([
  [ONRAMP_MONEY.id, ONRAMP_MONEY],
  [MOONPAY.id, MOONPAY],
  [TRANSAK.id, TRANSAK],
]);

/**
 * Returns true if the given provider supports the chain + fiat combination.
 */
export function isProviderSupported(
  providerId: string,
  chainKey: string,
  fiatCurrency: string,
): boolean {
  const provider = PROVIDER_MATRIX.get(providerId);
  if (!provider) return false;

  return (
    provider.supportedChains.has(chainKey.toLowerCase()) &&
    provider.supportedFiatCurrencies.has(fiatCurrency.toUpperCase())
  );
}

/**
 * Filters a list of quote objects, removing providers that don't support
 * the target chain + fiat combination. Returns the filtered list.
 */
export function filterSupportedQuotes<T extends { provider: string }>(
  quotes: T[],
  chainKey: string,
  fiatCurrency: string,
): T[] {
  return quotes.filter((q) => isProviderSupported(q.provider, chainKey, fiatCurrency));
}
