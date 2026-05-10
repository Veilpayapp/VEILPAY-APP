/**
 * Veilpay RPC URL Resolver
 *
 * Single source of truth for RPC endpoints.
 * In production: Alchemy/Infura keys are injected by Doppler.
 * All blockchain calls should go through rpcPool.ts (getPoolProvider / poolCall)
 * which handles failover and circuit breaking.
 *
 * This module is kept as a thin compatibility shim so existing code that calls
 * getRpcUrl() directly continues to compile, but callers should migrate to
 * getPoolProvider(chainKey) for resilient access.
 */

import { captureError } from './sentry';

// ─── Public fallback URLs ─────────────────────────────────────────────────────
// Used only in development or when no API key is configured.
// In production all chains go through Alchemy/Infura via rpcPool.ts.

const PUBLIC_FALLBACKS: Record<string, string> = {
  ethereum:       'https://eth.llamarpc.com',
  bsc:            'https://binance.llamarpc.com',
  polygon:        'https://polygon.llamarpc.com',
  arbitrum:       'https://arb1.arbitrum.io/rpc',
  sepolia:        'https://rpc.sepolia.org',
  solana:         'https://api.mainnet-beta.solana.com',
  'solana-devnet': 'https://api.devnet.solana.com',
  aptos:          'https://fullnode.mainnet.aptoslabs.com',
  stellar:        'https://horizon.stellar.org',
  'stellar-testnet': 'https://horizon-testnet.stellar.org',
};

// ─── Environment variable map ─────────────────────────────────────────────────
// Explicit per-chain overrides take highest precedence.

const RPC_ENV_VARS: Record<string, string | undefined> = {
  ethereum:       process.env.EXPO_PUBLIC_RPC_ETHEREUM,
  polygon:        process.env.EXPO_PUBLIC_RPC_POLYGON,
  arbitrum:       process.env.EXPO_PUBLIC_RPC_ARBITRUM,
  sepolia:        process.env.EXPO_PUBLIC_RPC_SEPOLIA,
  solana:         process.env.EXPO_PUBLIC_RPC_SOLANA,
  'solana-devnet': process.env.EXPO_PUBLIC_RPC_SOLANA_DEVNET,
  aptos:          process.env.EXPO_PUBLIC_RPC_APTOS,
};

// ─── Key-based URL builder ────────────────────────────────────────────────────

function buildAlchemyUrl(chainKey: string): string | null {
  const apiKey = process.env.EXPO_PUBLIC_ALCHEMY_API_KEY?.trim();
  if (!apiKey) return null;

  const slugs: Record<string, string> = {
    ethereum:  'eth-mainnet',
    polygon:   'polygon-mainnet',
    arbitrum:  'arb-mainnet',
    sepolia:   'eth-sepolia',
    solana:    'solana-mainnet',
  };

  const slug = slugs[chainKey];
  if (!slug) return null;

  return chainKey === 'solana'
    ? `https://solana-mainnet.g.alchemy.com/v2/${apiKey}`
    : `https://${slug}.g.alchemy.com/v2/${apiKey}`;
}

function buildInfuraUrl(chainKey: string): string | null {
  const apiKey = process.env.EXPO_PUBLIC_INFURA_API_KEY?.trim();
  if (!apiKey) return null;

  const slugs: Record<string, string> = {
    ethereum: 'mainnet',
    polygon:  'polygon-mainnet',
    arbitrum: 'arbitrum-mainnet',
    sepolia:  'sepolia',
  };

  const slug = slugs[chainKey];
  if (!slug) return null;

  return `https://${slug}.infura.io/v3/${apiKey}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the best available RPC URL for the given chain.
 *
 * Priority:
 *   1. Explicit env override (EXPO_PUBLIC_RPC_<CHAIN>)
 *   2. Alchemy keyed endpoint (EXPO_PUBLIC_ALCHEMY_API_KEY)
 *   3. Infura keyed endpoint  (EXPO_PUBLIC_INFURA_API_KEY)
 *   4. Public fallback (dev/emergency only)
 *   5. '' in production if nothing is configured (triggers Sentry alert)
 *
 * For resilient multi-provider failover, use rpcPool.ts instead:
 *   import { getPoolProvider, poolCall } from './rpcPool';
 */
export function getRpcUrl(chainKey: string): string {
  // 1. Explicit override
  const override = RPC_ENV_VARS[chainKey]?.trim();
  if (override) return override;

  // 2. Alchemy
  const alchemyUrl = buildAlchemyUrl(chainKey);
  if (alchemyUrl) return alchemyUrl;

  // 3. Infura
  const infuraUrl = buildInfuraUrl(chainKey);
  if (infuraUrl) return infuraUrl;

  // 4. Public fallback — only allowed outside production
  if (process.env.NODE_ENV !== 'production') {
    return PUBLIC_FALLBACKS[chainKey] || '';
  }

  // 5. Production with no configuration — alert and return empty
  const err = new Error(`Missing RPC configuration for chain: ${chainKey}`);
  captureError(err, { scope: 'rpc-config', chain: chainKey });
  console.error('[rpc] No RPC endpoint for', chainKey, '— blockchain calls will fail.');
  return '';
}

/**
 * Returns all supported chain keys.
 */
export function getSupportedChainKeys(): string[] {
  return Object.keys(PUBLIC_FALLBACKS);
}