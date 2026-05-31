import { createPublicClient, http, PublicClient } from 'viem';
import { captureError } from './sentry';

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

function buildEndpoints(chainKey: string): RpcEndpoint[] {
  const alchemyKey = process.env.EXPO_PUBLIC_ALCHEMY_API_KEY?.trim();
  const infuraKey = process.env.EXPO_PUBLIC_INFURA_API_KEY?.trim();

  const alchemyNetworks: Record<string, string> = {
    ethereum: 'eth-mainnet',
    polygon: 'polygon-mainnet',
    arbitrum: 'arb-mainnet',
    base: 'base-mainnet',
    sepolia: 'eth-sepolia',
    solana: 'solana-mainnet',
  };

  const infuraNetworks: Record<string, string> = {
    ethereum: 'mainnet',
    polygon: 'polygon-mainnet',
    arbitrum: 'arbitrum-mainnet',
    base: 'base-mainnet',
    sepolia: 'sepolia',
  };

  const publicFallbacks: Record<string, string> = {
    ethereum: 'https://ethereum-rpc.publicnode.com',
    polygon: 'https://polygon-rpc.com',
    arbitrum: 'https://arb1.arbitrum.io/rpc',
    base: 'https://mainnet.base.org',
    sepolia: 'https://rpc.sepolia.org',
    solana: 'https://api.mainnet-beta.solana.com',
    'solana-devnet': 'https://api.devnet.solana.com',
    aptos: 'https://fullnode.mainnet.aptoslabs.com',
  };

  const overrideEnvKey = `EXPO_PUBLIC_RPC_${chainKey.replace(/-/g, '_').toUpperCase()}`;
  const overrideUrl = (process.env[overrideEnvKey] || '').trim();

  const endpoints: RpcEndpoint[] = [];

  if (overrideUrl) {
    endpoints.push({ name: `override-${chainKey}`, url: overrideUrl, weight: 10 });
    return endpoints;
  }

  const alchemyNetwork = alchemyNetworks[chainKey];
  if (alchemyKey && alchemyNetwork) {
    const url = chainKey === 'solana'
      ? `https://solana-mainnet.g.alchemy.com/v2/${alchemyKey}`
      : `https://${alchemyNetwork}.g.alchemy.com/v2/${alchemyKey}`;
    endpoints.push({ name: `alchemy-${chainKey}`, url, weight: 3 });
  }

  const infuraNetwork = infuraNetworks[chainKey];
  if (infuraKey && infuraNetwork) {
    endpoints.push({
      name: `infura-${chainKey}`,
      url: `https://${infuraNetwork}.infura.io/v3/${infuraKey}`,
      weight: 2,
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
    for (const endpoint of this.endpoints) {
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

  private getOrCreateProvider(endpoint: RpcEndpoint): PublicClient {
    if (!this.providers.has(endpoint.name)) {
      this.providers.set(
        endpoint.name,
        createPublicClient({ transport: http(endpoint.url) })
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
