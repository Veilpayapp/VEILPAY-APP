/**
 * Chain-aware public assets for Token Selector (and related pickers).
 *
 * Rules:
 * 1. Native gas asset always comes from the chain config (`nativeToken`), so
 *    every SUPPORTED_CHAINS entry and custom chains get the right ticker.
 * 2. Optional well-known stables are keyed by `chainKey` — never a single
 *    global EVM dump (ETH/MATIC on BSC).
 * 3. Unknown / custom chain keys still get native-only if config is provided.
 */

import type { ChainTypeKey, PaymentToken } from '../types/tokens';

export type PublicTokenMeta = Omit<PaymentToken, 'balance' | 'usdPrice'>;

export type StableDef = {
  symbol: string;
  name: string;
  address?: string;
  decimals?: number;
  icon?: string;
};

const ICON_BY_SYMBOL: Record<string, string> = {
  ETH: '◆',
  BNB: '◈',
  MATIC: '⬢',
  POL: '⬢',
  SOL: '◍',
  XLM: '✦',
  USDT: '◉',
  USDC: '●',
  DAI: '◐',
  WETH: '◇',
};

/**
 * Well-known non-native tokens per chainKey.
 * Keep in sync with `balanceFetcher` POPULAR_TOKENS where addresses matter.
 * Empty array = native only (Stellar public list; pXLM is under Privacy).
 */
export const CHAIN_STABLES: Record<string, StableDef[]> = {
  ethereum: [
    {
      symbol: 'USDT',
      name: 'Tether USD',
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      decimals: 6,
    },
    {
      symbol: 'USDC',
      name: 'USD Coin',
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      decimals: 6,
    },
    {
      symbol: 'DAI',
      name: 'Dai Stablecoin',
      address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      decimals: 18,
    },
  ],
  sepolia: [
    {
      symbol: 'USDC',
      name: 'USD Coin',
      address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      decimals: 6,
    },
  ],
  polygon: [
    {
      symbol: 'USDT',
      name: 'Tether USD',
      address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
      decimals: 6,
    },
    {
      symbol: 'USDC',
      name: 'USD Coin',
      address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      decimals: 6,
    },
  ],
  arbitrum: [
    {
      symbol: 'USDT',
      name: 'Tether USD',
      address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
      decimals: 6,
    },
    {
      symbol: 'USDC',
      name: 'USD Coin',
      address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      decimals: 6,
    },
  ],
  /** Optional / custom; not in default SUPPORTED_CHAINS today. */
  optimism: [
    {
      symbol: 'USDT',
      name: 'Tether USD',
      address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
      decimals: 6,
    },
    {
      symbol: 'USDC',
      name: 'USD Coin',
      address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
      decimals: 6,
    },
  ],
  base: [
    {
      symbol: 'USDC',
      name: 'USD Coin',
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      decimals: 6,
    },
  ],
  bsc: [
    {
      symbol: 'USDT',
      name: 'Tether USD',
      address: '0x55d398326f99059fF775485246999027B3197955',
      decimals: 18,
    },
    {
      symbol: 'USDC',
      name: 'USD Coin',
      address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
      decimals: 18,
    },
  ],
  solana: [
    { symbol: 'USDC', name: 'USD Coin' },
    { symbol: 'USDT', name: 'Tether USD' },
  ],
  'solana-devnet': [{ symbol: 'USDC', name: 'USD Coin' }],
  /**
   * Stellar classic assets: `address` is the **issuer** G… account (not a contract).
   * Circle USDC — https://www.circle.com/en/usdc-multichain/stellar
   * Horizon balances use up to 7 decimal places.
   */
  stellar: [
    {
      symbol: 'USDC',
      name: 'USD Coin',
      // Circle / centre USDC issuer on Stellar public network
      address: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      decimals: 7,
    },
  ],
  'stellar-testnet': [
    {
      symbol: 'USDC',
      name: 'USD Coin',
      // Common Circle/centre testnet USDC issuer
      address: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      decimals: 7,
    },
  ],
};

export interface ChainLike {
  key: string;
  type: ChainTypeKey | string;
  symbol?: string;
  name?: string;
  nativeToken?: {
    name: string;
    symbol: string;
    decimals: number;
  };
}

function nativeMeta(chain: ChainLike): PublicTokenMeta {
  const symbol = (chain.nativeToken?.symbol || chain.symbol || 'TOKEN').toUpperCase();
  const name = chain.nativeToken?.name || symbol;
  const type = (chain.type as ChainTypeKey) || inferChainType(chain.key);
  return {
    id: `native-${chain.key}`,
    name,
    symbol,
    chainTypes: [type],
    icon: ICON_BY_SYMBOL[symbol] || '◆',
    decimals: chain.nativeToken?.decimals,
  };
}

function stableMeta(chain: ChainLike, stable: StableDef): PublicTokenMeta {
  const type = (chain.type as ChainTypeKey) || inferChainType(chain.key);
  return {
    id: `${chain.key}-${stable.symbol.toLowerCase()}`,
    name: stable.name,
    symbol: stable.symbol,
    chainTypes: [type],
    icon: stable.icon || ICON_BY_SYMBOL[stable.symbol] || '◉',
    address: stable.address,
    decimals: stable.decimals,
  };
}

function inferChainType(chainKey: string): ChainTypeKey {
  const k = chainKey.toLowerCase();
  if (k.includes('solana')) return 'svm';
  if (k.includes('stellar') || k === 'xlm') return 'xlm';
  return 'evm';
}

function fallbackNative(chainKey: string): {
  symbol: string;
  name: string;
  decimals: number;
  type: ChainTypeKey;
} {
  const k = chainKey.toLowerCase();
  if (k === 'bsc') return { symbol: 'BNB', name: 'BNB', decimals: 18, type: 'evm' };
  if (k === 'polygon') return { symbol: 'MATIC', name: 'MATIC', decimals: 18, type: 'evm' };
  if (k.includes('solana')) return { symbol: 'SOL', name: 'Solana', decimals: 9, type: 'svm' };
  if (k.includes('stellar')) {
    return { symbol: 'XLM', name: 'Stellar Lumens', decimals: 7, type: 'xlm' };
  }
  return { symbol: 'ETH', name: 'Ether', decimals: 18, type: 'evm' };
}

/**
 * Public (non-privacy) tokens for the given chain.
 * Prefer passing full `chain` from wallet `allChains()` / activeChain so custom
 * networks keep correct native ticker + type.
 */
export function listPublicTokensForChain(
  chainKey: string | null | undefined,
  chain?: ChainLike | null
): PublicTokenMeta[] {
  const key = (chainKey || chain?.key || '').trim();
  if (!key && !chain?.key) {
    return [];
  }

  const resolvedKey = (chain?.key || key).toLowerCase();
  const fallback = fallbackNative(resolvedKey);

  const resolved: ChainLike = {
    key: resolvedKey,
    type: chain?.type || fallback.type,
    symbol: chain?.symbol || chain?.nativeToken?.symbol || fallback.symbol,
    name: chain?.name,
    nativeToken: chain?.nativeToken || {
      name: fallback.name,
      symbol: fallback.symbol,
      decimals: fallback.decimals,
    },
  };

  const rows: PublicTokenMeta[] = [nativeMeta(resolved)];
  const stables = CHAIN_STABLES[resolvedKey] ?? [];
  const nativeSym = rows[0]!.symbol.toUpperCase();

  for (const s of stables) {
    if (s.symbol.toUpperCase() === nativeSym) continue;
    rows.push(stableMeta(resolved, s));
  }

  return rows;
}

/** Symbols to request from market data for the active catalog. */
export function marketSymbolsForPublicCatalog(metas: PublicTokenMeta[]): string[] {
  const base = ['XLM', 'BNB', 'SOL', 'ETH', 'MATIC', 'POL', 'USDT', 'USDC', 'DAI'];
  return [...new Set(metas.map((m) => m.symbol).concat(base))];
}

/**
 * Assert every configured product chain has a stable catalog entry key
 * (may be empty array). Used by tests to keep SUPPORTED_CHAINS in lockstep.
 */
export function hasCatalogEntryForChainKey(chainKey: string): boolean {
  return Object.prototype.hasOwnProperty.call(CHAIN_STABLES, chainKey.toLowerCase());
}

/** Expected native symbol for a chain key (for tests / guards). */
export function expectedNativeSymbol(
  chainKey: string,
  chain?: ChainLike | null
): string {
  if (chain?.nativeToken?.symbol) return chain.nativeToken.symbol.toUpperCase();
  if (chain?.symbol) return chain.symbol.toUpperCase();
  return fallbackNative(chainKey).symbol;
}

/**
 * Resolve a listed public asset on a chain (e.g. Stellar USDC issuer).
 * Used when navigation only carries `token` symbol.
 */
export function resolvePublicTokenMeta(
  chainKey: string | null | undefined,
  symbol: string | null | undefined,
  chain?: ChainLike | null
): PublicTokenMeta | null {
  if (!chainKey || !symbol) return null;
  const sym = symbol.trim().toUpperCase();
  const rows = listPublicTokensForChain(chainKey, chain);
  return rows.find((r) => r.symbol.toUpperCase() === sym) ?? null;
}
