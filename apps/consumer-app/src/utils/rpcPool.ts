/**
 * Veilpay RPC Provider Pool
 *
 * Eliminates single-point-of-failure RPC endpoints with:
 * - Weighted round-robin across Alchemy → Infura → LlamaRPC
 * - Per-provider circuit breakers (3 failures → 30s cooldown)
 * - Automatic health checks every 60 seconds
 * - Request timeout (5s) + 3 retries with exponential backoff
 * - Zero-downtime failover at the provider level
 *
 * Free tier maximums:
 *   Alchemy  → 300M Compute Units/month
 *   Infura   → 100K requests/day
 *   LlamaRPC → public, no key required (emergency fallback)
 */

import { JsonRpcProvider } from 'ethers';
import { captureError } from './sentry';

// ─── Types ────────────────────────────────────────────────────────────────────

type RpcProviderStatus = 'healthy' | 'degraded' | 'open';

interface RpcEndpoint {
  /** Human-readable name for logging */
  name: string;
  /** Full RPC URL including API key if needed */
  url: string;
  /** Lower weight = lower priority. Alchemy=3, Infura=2, Public=1 */
  weight: number;
}

interface CircuitBreakerState {
  status: RpcProviderStatus;
  failureCount: number;
  lastFailureAt: number;
  openUntil: number;
}

// ─── Configuration ────────────────────────────────────────────────────────────

const CIRCUIT_OPEN_THRESHOLD = 3;          // Failures before opening circuit
const CIRCUIT_RESET_MS = 30_000;           // 30s cooldown when open
const REQUEST_TIMEOUT_MS = 5_000;          // 5s per RPC call
const HEALTH_CHECK_INTERVAL_MS = 60_000;   // 60s periodic health check
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 300;           // Doubles on each retry

// ─── Endpoint Registry ────────────────────────────────────────────────────────

function buildEndpoints(chainKey: string): RpcEndpoint[] {
  const alchemyKey = process.env.EXPO_PUBLIC_ALCHEMY_API_KEY?.trim();
  const infuraKey = process.env.EXPO_PUBLIC_INFURA_API_KEY?.trim();

  // Chain-specific Alchemy network slugs
  const alchemyNetworks: Record<string, string> = {
    ethereum: 'eth-mainnet',
    polygon: 'polygon-mainnet',
    arbitrum: 'arb-mainnet',
    sepolia: 'eth-sepolia',
    solana: 'solana-mainnet',
  };

  // Chain-specific Infura network slugs
  const infuraNetworks: Record<string, string> = {
    ethereum: 'mainnet',
    polygon: 'polygon-mainnet',
    arbitrum: 'arbitrum-mainnet',
    sepolia: 'sepolia',
  };

  // Public emergency fallbacks (no key required)
  const publicFallbacks: Record<string, string> = {
    ethereum: 'https://eth.llamarpc.com',
    polygon: 'https://polygon.llamarpc.com',
    arbitrum: 'https://arb1.arbitrum.io/rpc',
    sepolia: 'https://rpc.sepolia.org',
    solana: 'https://api.mainnet-beta.solana.com',
    'solana-devnet': 'https://api.devnet.solana.com',
    aptos: 'https://fullnode.mainnet.aptoslabs.com',
  };

  // Allow full URL override per chain
  const overrideEnvKey = `EXPO_PUBLIC_RPC_${chainKey.replace(/-/g, '_').toUpperCase()}`;
  const overrideUrl = (process.env[overrideEnvKey] || '').trim();

  const endpoints: RpcEndpoint[] = [];

  if (overrideUrl) {
    // If an explicit override is set, use it exclusively
    endpoints.push({ name: `override-${chainKey}`, url: overrideUrl, weight: 10 });
    return endpoints;
  }

  // ── Primary: Alchemy ──────────────────────────────────────────────────────
  const alchemyNetwork = alchemyNetworks[chainKey];
  if (alchemyKey && alchemyNetwork) {
    const url = chainKey === 'solana'
      ? `https://solana-mainnet.g.alchemy.com/v2/${alchemyKey}`
      : `https://${alchemyNetwork}.g.alchemy.com/v2/${alchemyKey}`;
    endpoints.push({ name: `alchemy-${chainKey}`, url, weight: 3 });
  }

  // ── Fallback: Infura ──────────────────────────────────────────────────────
  const infuraNetwork = infuraNetworks[chainKey];
  if (infuraKey && infuraNetwork) {
    endpoints.push({
      name: `infura-${chainKey}`,
      url: `https://${infuraNetwork}.infura.io/v3/${infuraKey}`,
      weight: 2,
    });
  }

  // ── Emergency: Public LlamaRPC / official endpoints ───────────────────────
  const publicUrl = publicFallbacks[chainKey];
  if (publicUrl) {
    endpoints.push({ name: `public-${chainKey}`, url: publicUrl, weight: 1 });
  }

  return endpoints;
}

// ─── Circuit Breaker ──────────────────────────────────────────────────────────

const circuitState = new Map<string, CircuitBreakerState>();

function getCircuit(key: string): CircuitBreakerState {
  if (!circuitState.has(key)) {
    circuitState.set(key, {
      status: 'healthy',
      failureCount: 0,
      lastFailureAt: 0,
      openUntil: 0,
    });
  }
  return circuitState.get(key)!;
}

function isCircuitOpen(endpointName: string): boolean {
  const state = getCircuit(endpointName);
  if (state.status !== 'open') return false;
  if (Date.now() >= state.openUntil) {
    // Allow one probe request through (half-open)
    state.status = 'degraded';
    return false;
  }
  return true;
}

function recordSuccess(endpointName: string): void {
  const state = getCircuit(endpointName);
  state.status = 'healthy';
  state.failureCount = 0;
}

function recordFailure(endpointName: string): void {
  const state = getCircuit(endpointName);
  state.failureCount += 1;
  state.lastFailureAt = Date.now();

  if (state.failureCount >= CIRCUIT_OPEN_THRESHOLD) {
    state.status = 'open';
    state.openUntil = Date.now() + CIRCUIT_RESET_MS;
    console.warn(`[rpcPool] Circuit OPEN for ${endpointName} — cooldown 30s`);
  } else {
    state.status = 'degraded';
  }
}

// ─── Pool Class ───────────────────────────────────────────────────────────────

class RpcProviderPool {
  private readonly chainKey: string;
  private endpoints: RpcEndpoint[];
  private providers = new Map<string, JsonRpcProvider>();
  private healthTimer: ReturnType<typeof setInterval> | null = null;

  constructor(chainKey: string) {
    this.chainKey = chainKey;
    this.endpoints = buildEndpoints(chainKey);

    if (this.endpoints.length === 0) {
      console.warn(`[rpcPool] No endpoints configured for chain: ${chainKey}`);
    }

    this.startHealthChecks();
  }

  // ── Provider access ─────────────────────────────────────────────────────────

  /**
   * Returns the best available provider for this chain.
   * Throws if no healthy provider is available.
   */
  getProvider(): JsonRpcProvider {
    const available = this.endpoints
      .filter((ep) => !isCircuitOpen(ep.name))
      .sort((a, b) => b.weight - a.weight);

    if (available.length === 0) {
      const err = new Error(`[rpcPool] All providers circuit-open for chain: ${this.chainKey}`);
      captureError(err, { scope: 'rpc-pool', chain: this.chainKey });
      throw err;
    }

    const chosen = available[0];
    return this.getOrCreateProvider(chosen);
  }

  /**
   * Executes a call with automatic retry and failover across providers.
   */
  async call<T>(fn: (provider: JsonRpcProvider) => Promise<T>): Promise<T> {
    const available = this.endpoints
      .filter((ep) => !isCircuitOpen(ep.name))
      .sort((a, b) => b.weight - a.weight);

    if (available.length === 0) {
      throw new Error(`[rpcPool] No available providers for: ${this.chainKey}`);
    }

    let lastError: unknown;

    for (const endpoint of available) {
      const provider = this.getOrCreateProvider(endpoint);

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const result = await this.withTimeout(fn(provider));
          recordSuccess(endpoint.name);
          return result;
        } catch (err) {
          lastError = err;
          recordFailure(endpoint.name);

          if (attempt < MAX_RETRIES - 1) {
            const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
            await sleep(delay);
          }

          // If circuit just opened, stop retrying this provider
          if (isCircuitOpen(endpoint.name)) break;
        }
      }
    }

    const finalErr = lastError instanceof Error
      ? lastError
      : new Error(`[rpcPool] All providers failed for: ${this.chainKey}`);
    captureError(finalErr, { scope: 'rpc-pool', chain: this.chainKey });
    throw finalErr;
  }

  // ── Health checks ───────────────────────────────────────────────────────────

  private startHealthChecks(): void {
    if (typeof setInterval === 'undefined') return;

    this.healthTimer = setInterval(() => {
      void this.runHealthChecks();
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  private async runHealthChecks(): Promise<void> {
    for (const endpoint of this.endpoints) {
      // Only check open circuits to see if they've recovered
      const state = getCircuit(endpoint.name);
      if (state.status !== 'open' && Date.now() < state.openUntil) continue;

      const provider = this.getOrCreateProvider(endpoint);
      try {
        await this.withTimeout(provider.getBlockNumber());
        recordSuccess(endpoint.name);
        console.log(`[rpcPool] Health check passed: ${endpoint.name}`);
      } catch {
        console.warn(`[rpcPool] Health check failed: ${endpoint.name}`);
      }
    }
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  private getOrCreateProvider(endpoint: RpcEndpoint): JsonRpcProvider {
    if (!this.providers.has(endpoint.name)) {
      this.providers.set(
        endpoint.name,
        new JsonRpcProvider(endpoint.url, undefined, { staticNetwork: true })
      );
    }
    return this.providers.get(endpoint.name)!;
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`RPC timeout after ${REQUEST_TIMEOUT_MS}ms`)), REQUEST_TIMEOUT_MS)
      ),
    ]);
  }

  destroy(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    this.providers.clear();
  }
}

// ─── Pool Registry ────────────────────────────────────────────────────────────
// Singleton pools, one per chain key.

const pools = new Map<string, RpcProviderPool>();

export function getPool(chainKey: string): RpcProviderPool {
  if (!pools.has(chainKey)) {
    pools.set(chainKey, new RpcProviderPool(chainKey));
  }
  return pools.get(chainKey)!;
}

/**
 * Get the best available ethers.js JsonRpcProvider for a chain.
 *
 * @example
 * const provider = getPoolProvider('ethereum');
 * const balance = await provider.getBalance(address);
 */
export function getPoolProvider(chainKey: string): JsonRpcProvider {
  return getPool(chainKey).getProvider();
}

/**
 * Execute a call with automatic failover and retries.
 *
 * @example
 * const balance = await poolCall('ethereum', (p) => p.getBalance(address));
 */
export function poolCall<T>(
  chainKey: string,
  fn: (provider: JsonRpcProvider) => Promise<T>
): Promise<T> {
  return getPool(chainKey).call(fn);
}

/**
 * Returns circuit breaker status for all providers on a chain.
 * Useful for diagnostics / dev tooling.
 */
export function getPoolStatus(chainKey: string): Record<string, CircuitBreakerState> {
  const pool = pools.get(chainKey);
  if (!pool) return {};
  const endpoints = buildEndpoints(chainKey);
  const result: Record<string, CircuitBreakerState> = {};
  for (const ep of endpoints) {
    result[ep.name] = getCircuit(ep.name);
  }
  return result;
}

export function destroyAllPools(): void {
  for (const pool of pools.values()) {
    pool.destroy();
  }
  pools.clear();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
