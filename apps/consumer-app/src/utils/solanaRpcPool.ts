import { Connection } from '@solana/web3.js';
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
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 300;

function buildSolanaEndpoints(chainKey: string): RpcEndpoint[] {
  const alchemyKey = process.env.EXPO_PUBLIC_ALCHEMY_API_KEY?.trim();

  const endpoints: RpcEndpoint[] = [];

  const overrideEnvKey = `EXPO_PUBLIC_RPC_${chainKey.replace(/-/g, '_').toUpperCase()}`;
  const overrideUrl = (process.env[overrideEnvKey] || '').trim();

  if (overrideUrl) {
    endpoints.push({ name: `override-${chainKey}`, url: overrideUrl, weight: 10 });
    return endpoints;
  }

  if (chainKey === 'solana' && alchemyKey) {
    endpoints.push({ name: `alchemy-${chainKey}`, url: `https://solana-mainnet.g.alchemy.com/v2/${alchemyKey}`, weight: 3 });
  }

  const publicUrl = chainKey === 'solana' 
    ? 'https://api.mainnet-beta.solana.com' 
    : 'https://api.devnet.solana.com';
    
  endpoints.push({ name: `public-${chainKey}`, url: publicUrl, weight: 1 });

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
    console.warn(`[solanaRpcPool] Circuit OPEN for ${endpointName} — cooldown 30s`);
  } else {
    state.status = 'degraded';
  }
}

class SolanaRpcPool {
  private readonly chainKey: string;
  private endpoints: RpcEndpoint[];
  private connections = new Map<string, Connection>();

  constructor(chainKey: string) {
    this.chainKey = chainKey;
    this.endpoints = buildSolanaEndpoints(chainKey);

    if (this.endpoints.length === 0) {
      console.warn(`[solanaRpcPool] No endpoints configured for chain: ${chainKey}`);
    }
  }

  getConnection(): Connection {
    const available = this.endpoints
      .filter((ep) => !isCircuitOpen(ep.name))
      .sort((a, b) => b.weight - a.weight);

    if (available.length === 0) {
      const err = new Error(`[solanaRpcPool] All providers circuit-open for chain: ${this.chainKey}`);
      captureError(err, { scope: 'rpc-pool-solana', chain: this.chainKey });
      throw err;
    }

    const chosen = available[0];
    return this.getOrCreateConnection(chosen);
  }

  async call<T>(fn: (connection: Connection) => Promise<T>): Promise<T> {
    const available = this.endpoints
      .filter((ep) => !isCircuitOpen(ep.name))
      .sort((a, b) => b.weight - a.weight);

    if (available.length === 0) {
      throw new Error(`[solanaRpcPool] No available providers for: ${this.chainKey}`);
    }

    let lastError: unknown;

    for (const endpoint of available) {
      const connection = this.getOrCreateConnection(endpoint);

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const result = await this.withTimeout(fn(connection));
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
      : new Error(`[solanaRpcPool] All providers failed for: ${this.chainKey}`);
    captureError(finalErr, { scope: 'rpc-pool-solana', chain: this.chainKey });
    throw finalErr;
  }

  private getOrCreateConnection(endpoint: RpcEndpoint): Connection {
    if (!this.connections.has(endpoint.name)) {
      this.connections.set(
        endpoint.name,
        new Connection(endpoint.url, { commitment: 'confirmed' })
      );
    }
    return this.connections.get(endpoint.name)!;
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
    this.connections.clear();
  }
}

const pools = new Map<string, SolanaRpcPool>();

export function getSolanaPool(chainKey: string): SolanaRpcPool {
  const actualKey = chainKey === 'solana-devnet' ? chainKey : 'solana'; // default to mainnet
  if (!pools.has(actualKey)) {
    pools.set(actualKey, new SolanaRpcPool(actualKey));
  }
  return pools.get(actualKey)!;
}

export function getSolanaConnection(chainKey: string): Connection {
  return getSolanaPool(chainKey).getConnection();
}

export function poolCallSolana<T>(
  chainKey: string,
  fn: (connection: Connection) => Promise<T>
): Promise<T> {
  return getSolanaPool(chainKey).call(fn);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
