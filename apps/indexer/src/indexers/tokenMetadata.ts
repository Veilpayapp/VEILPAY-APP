/**
 * Token metadata (symbol + decimals) for the EVM chains this indexer tracks.
 *
 * The address→symbol map mirrors `apps/backend/src/lib/tokenRegistry.ts`
 * (the shared token registry the backend uses to bind invoice token identity),
 * restricted to the EVM chains the indexer indexes. Address comparison is
 * case-insensitive because event args arrive checksummed while the registry
 * keys are stored checksummed too — both are lowercased here.
 *
 * Decimals: native ETH/MATIC-style chains are 18; USDC/USDT are 6; DAI/WETH 18.
 * These are the canonical on-chain decimals for the allowlisted contracts.
 */

export interface TokenMetadata {
  /** Short ticker symbol (max ~5 chars) — fits the `token_symbol VarChar(20)` column. */
  symbol: string;
  /** Decimal places used by the token contract (18 for native ETH-style). */
  decimals: number;
}

const NATIVE_TOKEN_METADATA: Record<string, TokenMetadata> = {
  ethereum: { symbol: 'ETH', decimals: 18 },
  sepolia: { symbol: 'ETH', decimals: 18 },
  polygon: { symbol: 'POL', decimals: 18 },
  arbitrum: { symbol: 'ETH', decimals: 18 },
};

/** EVM zero address — the pool's marker for a native-asset transfer. */
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Allowlisted token contracts (lowercased address → metadata), sourced from
 * apps/backend/src/lib/tokenRegistry.ts.
 */
const TOKEN_METADATA_BY_ADDRESS: Record<string, Record<string, TokenMetadata>> = {
  ethereum: {
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { symbol: 'USDC', decimals: 6 },
    '0xdac17f958d2ee523a2206206994597c13d831ec7': { symbol: 'USDT', decimals: 6 },
    '0x6b175474e89094c44da98b954eedeac495271d0f': { symbol: 'DAI', decimals: 18 },
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { symbol: 'WETH', decimals: 18 },
  },
  sepolia: {
    '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238': { symbol: 'USDC', decimals: 6 },
  },
  polygon: {
    '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359': { symbol: 'USDC', decimals: 6 },
    '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': { symbol: 'USDT', decimals: 6 },
    '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063': { symbol: 'DAI', decimals: 18 },
    '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619': { symbol: 'WETH', decimals: 18 },
  },
  arbitrum: {
    '0xaf88d065e77c8cc2239327c5edb3a432268e5831': { symbol: 'USDC', decimals: 6 },
    '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': { symbol: 'USDT', decimals: 6 },
    '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': { symbol: 'DAI', decimals: 18 },
    '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': { symbol: 'WETH', decimals: 18 },
  },
};

/** Stable fallback symbol for tokens outside the allowlist — never a 42-char address. */
export const UNKNOWN_TOKEN_SYMBOL = 'TOKEN';

/** Default decimals for unlisted tokens (EVM convention). */
export const UNKNOWN_TOKEN_DECIMALS = 18;

export function isZeroAddress(address: string): boolean {
  return (address || '').trim().toLowerCase() === ZERO_ADDRESS;
}

/**
 * Resolve symbol + decimals for an on-chain token address on a chain.
 * Zero address → the chain's native asset. Unknown contracts get the
 * stable short symbol 'TOKEN' with 18 decimals so the `tokenSymbol`
 * VarChar(20) column is never fed a 42-char contract address.
 */
export function getTokenMetadata(chainKey: string, tokenAddress: string): TokenMetadata {
  if (isZeroAddress(tokenAddress)) {
    return NATIVE_TOKEN_METADATA[chainKey] ?? { symbol: 'ETH', decimals: 18 };
  }
  const byChain = TOKEN_METADATA_BY_ADDRESS[chainKey];
  const meta = byChain?.[tokenAddress.trim().toLowerCase()];
  return meta ?? { symbol: UNKNOWN_TOKEN_SYMBOL, decimals: UNKNOWN_TOKEN_DECIMALS };
}

/**
 * Convert an integer base-units string (e.g. "1000000000000000000") to a
 * human-units decimal string (e.g. "1") using the token's decimals, so it
 * can be compared with `Invoice.amount` which is stored in human units.
 *
 * Mirrors the backend's `baseUnitsToHuman` (apps/backend/src/services/goldrush.ts):
 * trailing zero fraction digits are stripped ("1.5", never "1.500000..."),
 * and non-integer input (already human, or garbage) is passed through
 * unchanged rather than crashing the settlement path.
 */
export function baseUnitsToHumanAmount(raw: string, decimals: number): string {
  const cleaned = String(raw ?? '').trim();
  if (!cleaned || cleaned === '0') return '0';
  if (cleaned.includes('.')) return cleaned;
  if (!/^-?\d+$/.test(cleaned)) return cleaned;
  if (!Number.isFinite(decimals) || decimals <= 0) {
    return cleaned.replace(/^0+(?=\d)/, '') || '0';
  }

  const negative = cleaned.startsWith('-');
  const digits = (negative ? cleaned.slice(1) : cleaned).replace(/^0+(?=\d)/, '') || '0';
  const padded = digits.padStart(decimals + 1, '0');
  const whole = padded.slice(0, padded.length - decimals);
  const frac = padded.slice(padded.length - decimals).replace(/0+$/, '');
  const out = frac ? `${whole}.${frac}` : whole;
  return negative && out !== '0' ? `-${out}` : out;
}
