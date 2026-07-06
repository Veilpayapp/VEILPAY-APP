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
  /**
   * Non-native tokens the provider sells, keyed by chainKey (lowercase).
   * The chain's native token (ETH, MATIC, BNB, SOL…) is ALWAYS implicitly
   * supported by any provider that supports the chain, so it is intentionally
   * omitted here — only stablecoins/extras are listed.
   *
   * NOTE: fiat-onramp asset coverage is dynamic and jurisdiction-dependent.
   * These lists capture the high-confidence combinations only; reconcile against
   * each provider's live supported-assets config before relying on them:
   *   - MoonPay:       GET /v3/currencies
   *   - Transak:       GET /api/v2/currencies/crypto-currencies
   *   - Onramp.money:  "All Config Mapping" endpoint
   */
  supportedTokensByChain: ReadonlyMap<string, ReadonlySet<string>>;
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
  // Onramp.money sells both major stablecoins across the EVM chains it covers.
  supportedTokensByChain: new Map<string, ReadonlySet<string>>([
    ['ethereum', new Set(['USDC', 'USDT'])],
    ['polygon', new Set(['USDC', 'USDT'])],
    ['arbitrum', new Set(['USDC', 'USDT'])],
    ['base', new Set(['USDC', 'USDT'])],
    ['bsc', new Set(['USDC', 'USDT'])],
    ['solana', new Set(['USDC', 'USDT'])],
  ]),
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
  // USDC is universal on MoonPay; USDT lags on Base (native Base USDT is recent
  // and MoonPay coverage has not caught up) so it is intentionally omitted there.
  supportedTokensByChain: new Map<string, ReadonlySet<string>>([
    ['ethereum', new Set(['USDC', 'USDT'])],
    ['polygon', new Set(['USDC', 'USDT'])],
    ['arbitrum', new Set(['USDC', 'USDT'])],
    ['base', new Set(['USDC'])],
    ['bsc', new Set(['USDC', 'USDT'])],
    ['solana', new Set(['USDC', 'USDT'])],
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
  // Mirrors MoonPay's high-confidence coverage; USDT on Base omitted for the
  // same reason (recent native deployment, onramp support still catching up).
  supportedTokensByChain: new Map<string, ReadonlySet<string>>([
    ['ethereum', new Set(['USDC', 'USDT'])],
    ['polygon', new Set(['USDC', 'USDT'])],
    ['arbitrum', new Set(['USDC', 'USDT'])],
    ['base', new Set(['USDC'])],
    ['bsc', new Set(['USDC', 'USDT'])],
    ['solana', new Set(['USDC', 'USDT'])],
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

/**
 * Returns the tokens a provider sells on a given chain, for display.
 * The chain's native symbol is always first (a provider that supports the chain
 * can always sell its native token), followed by the provider's stablecoins for
 * that chain. All symbols are uppercased and de-duplicated.
 */
export function getSupportedTokens(
  providerId: string,
  chainKey: string,
  nativeSymbol: string,
): string[] {
  const native = nativeSymbol.toUpperCase();
  const tokens = [native];
  const seen = new Set([native]);

  const provider = PROVIDER_MATRIX.get(providerId);
  const extras = provider?.supportedTokensByChain.get(chainKey.toLowerCase());
  if (extras) {
    for (const token of extras) {
      const upper = token.toUpperCase();
      if (!seen.has(upper)) {
        seen.add(upper);
        tokens.push(upper);
      }
    }
  }

  return tokens;
}

/**
 * True if the provider sells `token` on `chainKey`. Native token is always
 * supported; everything else must be listed in `supportedTokensByChain`.
 */
export function isTokenSupported(
  providerId: string,
  chainKey: string,
  token: string,
  nativeSymbol: string,
): boolean {
  return getSupportedTokens(providerId, chainKey, nativeSymbol).includes(token.toUpperCase());
}
