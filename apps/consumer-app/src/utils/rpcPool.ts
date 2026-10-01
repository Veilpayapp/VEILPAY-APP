import { createPublicClient, http, PublicClient } from 'viem';
import { captureError } from './sentry';
import { getAttestationHeaders } from '../services/attestation';
import { getExpectedChainId, validateChainIdMatch } from './rpcValidation';

/**
 * SEC-008: per-request attestation for the backend RPC proxy. The nonce is
 * single-use, so headers must be minted inside fetchFn (once per request), not
 * configured statically. When Play Integrity is disabled the helper returns
 * `{}` and this is a transparent pass-through to global fetch.
 */
const backendProxyFetch: NonNullable<Parameters<typeof http>[1]>['fetchFn'] = async (input, init) => {
  const headers = await getAttestationHeaders();
  if (Object.keys(headers).length === 0) return fetch(input as any, init);
  const merged = new Headers(init?.headers as any);
  for (const [k, v] of Object.entries(headers)) merged.set(k, v);
  return fetch(input as any, { ...init, headers: merged });
};

/**
 * Chain IDs that eth_chainId can be validated against. Non-EVM keys are
 * excluded explicitly: NETWORKS carries an *arbitrary* positive chainId for
 * solana (101), which eth_chainId against a Solana RPC would spuriously
 * "mismatch" and open its circuit.
 */
const CHAIN_ID_VALIDATED_KEYS = new Set(['ethereum', 'polygon', 'bsc', 'arbitrum', 'base', 'sepolia']);

type RpcProviderStatus = 'healthy' | 'degraded' | 'open';

interface RpcEndpoint {
  name: string;
  url: string;
  weight: number;
}

interface CircuitBreakerState {
  status: RpcProviderStatus;
  failureCount: number;
  lastFailureAt: number;
  openUntil: number;
}

const CIRCUIT_OPEN_THRESHOLD = 3;
const CIRCUIT_RESET_MS = 30_000;
const REQUEST_TIMEOUT_MS = 5_000;
const HEALTH_CHECK_INTERVAL_MS = 60_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 300;

// Per-chain RPC URL overrides. Each env var is read via a static
// `process.env.EXPO_PUBLIC_*` reference so Expo/Babel inlines it at build time
// (a computed `process.env[key]` is NOT inlined and silently reads undefined).
const RPC_URL_OVERRIDES: Record<string, string | undefined> = {
  ethereum: process.env.EXPO_PUBLIC_RPC_ETHEREUM,
  polygon: process.env.EXPO_PUBLIC_RPC_POLYGON,
  arbitrum: process.env.EXPO_PUBLIC_RPC_ARBITRUM,
  base: process.env.EXPO_PUBLIC_RPC_BASE,
  sepolia: process.env.EXPO_PUBLIC_RPC_SEPOLIA,
  solana: process.env.EXPO_PUBLIC_RPC_SOLANA,
  'solana-devnet': process.env.EXPO_PUBLIC_RPC_SOLANA_DEVNET,
};

function buildEndpoints(chainKey: string): RpcEndpoint[] {
  const publicFallbacks: Record<string, string> = {
    ethereum: 'https://ethereum-rpc.publicnode.com',
    polygon: 'https://polygon-rpc.com',
    arbitrum: 'https://arb1.arbitrum.io/rpc',
    base: 'https://mainnet.base.org',
    sepolia: 'https://rpc.sepolia.org',
    solana: 'https://api.mainnet-beta.solana.com',
    'solana-devnet': 'https://api.devnet.solana.com',
  };

  const overrideUrl = (RPC_URL_OVERRIDES[chainKey] || '').trim();

  const endpoints: RpcEndpoint[] = [];

  try {
    const customChains = require('../stores/walletStore').useWalletStore.getState().customChains;
    const customChain = customChains?.find((c: any) => c.key === chainKey);
    if (customChain && customChain.rpcUrl) {
      endpoints.push({ name: `custom-${chainKey}`, url: customChain.rpcUrl, weight: 100 });
      return endpoints;
    }
  } catch (e) {
    // Ignore store initialization errors
  }

  if (overrideUrl) {
    endpoints.push({ name: `override-${chainKey}`, url: overrideUrl, weight: 10 });
    return endpoints;
  }

  const backendBase = process.env.EXPO_PUBLIC_BACKEND_BASE_URL?.trim();
  if (backendBase) {
    endpoints.push({
      name: `backend-proxy-${chainKey}`,
      url: `${backendBase}/api/v1/rpc/${chainKey}`,
      weight: 5
    });
  }

  const publicUrl = publicFallbacks[chainKey];
  if (publicUrl) {
    endpoints.push({ name: `public-${chainKey}`, url: publicUrl, weight: 1 });
  }

  return endpoints;
}

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

class RpcProviderPool {
  private readonly chainKey: string;
  private endpoints: RpcEndpoint[];
  private providers = new Map<string, PublicClient>();
  private healthTimer: ReturnType<typeof setInterval> | null = null;

  constructor(chainKey: string) {
    this.chainKey = chainKey;
    this.endpoints = buildEndpoints(chainKey);

    if (this.endpoints.length === 0) {
      console.warn(`[rpcPool] No endpoints configured for chain: ${chainKey}`);
    }

    this.startHealthChecks();
  }

  getProvider(): PublicClient {
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

  async call<T>(fn: (provider: PublicClient) => Promise<T>): Promise<T> {
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
          // Sequential failover/retry: we must try one endpoint at a time and
          // stop on the first success — parallelizing would hammer every RPC.
          // react-doctor-disable-next-line react-doctor/async-await-in-loop
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

  private startHealthChecks(): void {
    if (typeof setInterval === 'undefined') return;

    this.healthTimer = setInterval(() => {
      void this.runHealthChecks();
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  private async runHealthChecks(): Promise<void> {
    // Health checks are independent per endpoint — run them concurrently.
    await Promise.all(
      this.endpoints.map(async (endpoint) => {
        const state = getCircuit(endpoint.name);
        if (state.status !== 'open' && Date.now() < state.openUntil) return;
        const provider = this.getOrCreateProvider(endpoint);
        try {
          // SEC-008: on EVM pools the probe doubles as chain-ID validation —
          // a proxied/MITM'd endpoint answering with a different network's id
          // must fail the health check, not just read blocks from anywhere.
          if (CHAIN_ID_VALIDATED_KEYS.has(this.chainKey)) {
            const chainId = await this.withTimeout(provider.getChainId());
            validateChainIdMatch(this.chainKey, chainId);
            const expected = getExpectedChainId(this.chainKey);
            if (expected === null) {
              throw new Error(`[rpcPool] no expected chainId for ${this.chainKey}`);
            }
          } else {
            await this.withTimeout(provider.getBlockNumber());
          }
          recordSuccess(endpoint.name);
          console.log(`[rpcPool] Health check passed: ${endpoint.name}`);
        } catch (err) {
          recordFailure(endpoint.name);
          console.warn(`[rpcPool] Health check failed: ${endpoint.name}`, err instanceof Error ? err.message : err);
        }
      })
    );
  }

  private getOrCreateProvider(endpoint: RpcEndpoint): PublicClient {
    if (!this.providers.has(endpoint.name)) {
      // Attestation headers go ONLY to our own backend proxy — never leak an
      // integrity token to third-party public RPC endpoints.
      const config = endpoint.name.startsWith('backend-proxy') ? { fetchFn: backendProxyFetch } : undefined;
      this.providers.set(
        endpoint.name,
        createPublicClient({ transport: http(endpoint.url, config) })
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

const pools = new Map<string, RpcProviderPool>();

export function getPool(chainKey: string): RpcProviderPool {
  if (!pools.has(chainKey)) {
    pools.set(chainKey, new RpcProviderPool(chainKey));
  }
  return pools.get(chainKey)!;
}

export function getPoolProvider(chainKey: string): PublicClient {
  return getPool(chainKey).getProvider();
}

export function poolCall<T>(
  chainKey: string,
  fn: (provider: PublicClient) => Promise<T>
): Promise<T> {
  return getPool(chainKey).call(fn);
}

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
