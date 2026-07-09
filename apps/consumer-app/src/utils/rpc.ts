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
  ethereum:       'https://ethereum-rpc.publicnode.com',
  bsc:            'https://bsc-dataseed.binance.org',
  polygon:        'https://polygon-rpc.com',
  arbitrum:       'https://arb1.arbitrum.io/rpc',
  base:           'https://mainnet.base.org',
  sepolia:        'https://rpc.sepolia.org',
  solana:         'https://api.mainnet-beta.solana.com',
  'solana-devnet': 'https://api.devnet.solana.com',
  stellar:        'https://horizon.stellar.org',
  'stellar-testnet': 'https://horizon-testnet.stellar.org',
};

// ─── Environment variable map ─────────────────────────────────────────────────
// Explicit per-chain overrides take highest precedence.

const RPC_ENV_VARS: Record<string, string | undefined> = {
  ethereum:       process.env.EXPO_PUBLIC_RPC_ETHEREUM,
  polygon:        process.env.EXPO_PUBLIC_RPC_POLYGON,
  arbitrum:       process.env.EXPO_PUBLIC_RPC_ARBITRUM,
  base:           process.env.EXPO_PUBLIC_RPC_BASE,
  sepolia:        process.env.EXPO_PUBLIC_RPC_SEPOLIA,
  solana:         process.env.EXPO_PUBLIC_RPC_SOLANA,
  'solana-devnet': process.env.EXPO_PUBLIC_RPC_SOLANA_DEVNET,
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the best available RPC URL for the given chain.
 *
 * Priority:
 *   1. Explicit env override (EXPO_PUBLIC_RPC_<CHAIN>)
 *   2. Backend RPC Proxy (EXPO_PUBLIC_BACKEND_BASE_URL + /api/v1/rpc/<CHAIN>)
 *   3. Public fallback (read-only). Used in dev, and as an emergency
 *      degradation path in production when the backend proxy is not
 *      configured — a public node keeps balance/tx reads working (though
 *      Alchemy-enhanced methods will be rejected) instead of failing all reads.
 *
 * For resilient multi-provider failover, use rpcPool.ts instead:
 *   import { getPoolProvider, poolCall } from './rpcPool';
 */
export function getRpcUrl(chainKey: string): string {
  // 1. Explicit override
  const override = RPC_ENV_VARS[chainKey]?.trim();
  if (override) return override;

  // 2. Proxy via Backend (Production default)
  const backendBase = process.env.EXPO_PUBLIC_BACKEND_BASE_URL?.trim();
  if (backendBase) {
    return `${backendBase}/api/v1/rpc/${chainKey}`;
  }

  // 3. Public fallback in dev — no alerting needed.
  if (process.env.NODE_ENV !== 'production') {
    return PUBLIC_FALLBACKS[chainKey] || '';
  }

  // 4. Production with no backend configured. This is a misconfiguration
  //    (the backend base URL should always be set in prod), so alert — but
  //    degrade to a read-only public node so the app keeps functioning
  //    instead of failing every blockchain read.
  const err = new Error(`Missing RPC backend configuration for chain: ${chainKey}`);
  captureError(err, { scope: 'rpc-config', chain: chainKey });
  const publicFallback = PUBLIC_FALLBACKS[chainKey] || '';
  if (publicFallback) {
    console.warn('[rpc] Backend RPC proxy not configured for', chainKey, '— degrading to public node.');
    return publicFallback;
  }
  console.error('[rpc] No RPC endpoint for', chainKey, '— blockchain calls will fail.');
  return '';
}

/**
 * Returns all supported chain keys.
 */
export function getSupportedChainKeys(): string[] {
  return Object.keys(PUBLIC_FALLBACKS);
}