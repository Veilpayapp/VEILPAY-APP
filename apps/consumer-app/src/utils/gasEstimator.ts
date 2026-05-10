/**
 * Veilpay Gas Estimator
 *
 * Provides accurate EIP-1559 gas estimates with:
 * - Live fee data from provider (maxFeePerGas + maxPriorityFeePerGas)
 * - Per-call gas limit estimation via provider.estimateGas()
 * - 15% safety buffer on both gas price and gas limit
 * - 30-second in-memory TTL cache per network
 * - Conservative static fallback when live estimation fails
 * - USD cost conversion using current ETH price
 *
 * Usage:
 *   const estimate = await estimateTransactionGas(params, 'ethereum');
 *   if (estimate.isStale) showGasWarning();
 */

import { ethers, TransactionRequest } from 'ethers';
import { poolCall } from './rpcPool';
import { captureError } from './sentry';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GasEstimate {
  /** Estimated gas limit (with 15% buffer) */
  gasLimit: bigint;
  /** Max fee per gas in wei (EIP-1559) */
  maxFeePerGas: bigint;
  /** Max priority fee per gas (miner tip) in wei */
  maxPriorityFeePerGas: bigint;
  /** Legacy gas price in wei (for non-EIP-1559 chains) */
  gasPrice: bigint;
  /** Estimated total cost in wei */
  estimatedCostWei: bigint;
  /** Estimated total cost in ETH (formatted string) */
  estimatedCostEth: string;
  /** Estimated USD cost (null if price unavailable) */
  estimatedCostUsd: string | null;
  /** Whether estimate came from live network or static fallback */
  isStale: boolean;
  /** Timestamp of when this estimate was fetched */
  fetchedAt: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BUFFER_MULTIPLIER = 115n;    // 15% buffer  (x * 115 / 100)
const BUFFER_DIVISOR = 100n;
const CACHE_TTL_MS = 30_000;       // 30 seconds

/** Conservative static fallback when live estimation fails */
const STATIC_FALLBACKS: Record<string, { gasPrice: bigint; maxFee: bigint; priorityFee: bigint }> = {
  ethereum:  { gasPrice: 20_000_000_000n, maxFee: 30_000_000_000n, priorityFee: 2_000_000_000n },
  polygon:   { gasPrice: 50_000_000_000n, maxFee: 60_000_000_000n, priorityFee: 30_000_000_000n },
  arbitrum:  { gasPrice:  1_000_000_000n, maxFee:  2_000_000_000n, priorityFee:    100_000_000n },
  sepolia:   { gasPrice:  5_000_000_000n, maxFee: 10_000_000_000n, priorityFee:  1_000_000_000n },
};

/** Standard gas limits by transaction type */
const STANDARD_GAS_LIMITS = {
  ETH_TRANSFER: 21_000n,
  ERC20_TRANSFER: 65_000n,
  CONTRACT_CALL: 200_000n,
} as const;

// ─── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry {
  estimate: GasEstimate;
  expiresAt: number;
}

const feeCache = new Map<string, CacheEntry>();

function getCacheKey(chainKey: string, toAddress: string, data?: string): string {
  // Cache per chain+call-type (transfer vs contract call)
  const hasData = data && data !== '0x' && data.length > 2;
  return `${chainKey}:${hasData ? 'contract' : 'transfer'}:${toAddress.toLowerCase()}`;
}

// ─── Core Estimation ──────────────────────────────────────────────────────────

/**
 * Estimate gas for an EVM transaction with live network data.
 *
 * @param txRequest - Partial transaction (to, value, data)
 * @param chainKey  - Chain identifier ('ethereum', 'sepolia', etc.)
 * @param ethPriceUsd - Current ETH price for USD conversion (optional)
 */
export async function estimateTransactionGas(
  txRequest: Pick<TransactionRequest, 'to' | 'value' | 'data' | 'from'>,
  chainKey: string,
  ethPriceUsd?: number
): Promise<GasEstimate> {
  const cacheKey = getCacheKey(chainKey, String(txRequest.to || ''), String(txRequest.data || ''));
  const cached = feeCache.get(cacheKey);

  if (cached && Date.now() < cached.expiresAt) {
    // Return fresh cached estimate with updated USD value
    const estimate = { ...cached.estimate };
    if (ethPriceUsd != null) {
      estimate.estimatedCostUsd = computeUsdCost(estimate.estimatedCostWei, ethPriceUsd);
    }
    return estimate;
  }

  try {
    const estimate = await fetchLiveEstimate(txRequest, chainKey, ethPriceUsd);
    feeCache.set(cacheKey, { estimate, expiresAt: Date.now() + CACHE_TTL_MS });
    return estimate;
  } catch (err) {
    captureError(err instanceof Error ? err : new Error('Gas estimation failed'), {
      scope: 'gas-estimator',
      chain: chainKey,
    });
    return buildStaticFallback(txRequest, chainKey, ethPriceUsd);
  }
}

async function fetchLiveEstimate(
  txRequest: Pick<TransactionRequest, 'to' | 'value' | 'data' | 'from'>,
  chainKey: string,
  ethPriceUsd?: number
): Promise<GasEstimate> {
  const [feeData, rawGasLimit] = await Promise.all([
    poolCall(chainKey, (p) => p.getFeeData()),
    poolCall(chainKey, (p) => p.estimateGas(txRequest as TransactionRequest)).catch(() => {
      // estimateGas can fail if from is missing or state is invalid —
      // fall back to known standard limits
      const hasData = txRequest.data && txRequest.data !== '0x';
      return hasData ? STANDARD_GAS_LIMITS.ERC20_TRANSFER : STANDARD_GAS_LIMITS.ETH_TRANSFER;
    }),
  ]);

  const gasLimit = applyBuffer(BigInt(rawGasLimit.toString()));

  // Prefer EIP-1559, fall back to legacy
  const maxFeePerGas = feeData.maxFeePerGas != null
    ? applyBuffer(feeData.maxFeePerGas)
    : applyBuffer(feeData.gasPrice ?? 1_000_000_000n);

  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas != null
    ? applyBuffer(feeData.maxPriorityFeePerGas)
    : 1_000_000_000n; // 1 Gwei default tip

  const gasPrice = feeData.gasPrice != null
    ? applyBuffer(feeData.gasPrice)
    : maxFeePerGas;

  const estimatedCostWei = gasLimit * maxFeePerGas;
  const estimatedCostEth = ethers.formatEther(estimatedCostWei);

  return {
    gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
    gasPrice,
    estimatedCostWei,
    estimatedCostEth,
    estimatedCostUsd: ethPriceUsd != null ? computeUsdCost(estimatedCostWei, ethPriceUsd) : null,
    isStale: false,
    fetchedAt: Date.now(),
  };
}

function buildStaticFallback(
  txRequest: Pick<TransactionRequest, 'to' | 'value' | 'data'>,
  chainKey: string,
  ethPriceUsd?: number
): GasEstimate {
  const fallback = STATIC_FALLBACKS[chainKey] ?? STATIC_FALLBACKS.ethereum;
  const hasData = txRequest.data && txRequest.data !== '0x';
  const gasLimit = hasData ? STANDARD_GAS_LIMITS.ERC20_TRANSFER : STANDARD_GAS_LIMITS.ETH_TRANSFER;
  const estimatedCostWei = gasLimit * fallback.maxFee;

  return {
    gasLimit,
    maxFeePerGas: fallback.maxFee,
    maxPriorityFeePerGas: fallback.priorityFee,
    gasPrice: fallback.gasPrice,
    estimatedCostWei,
    estimatedCostEth: ethers.formatEther(estimatedCostWei),
    estimatedCostUsd: ethPriceUsd != null ? computeUsdCost(estimatedCostWei, ethPriceUsd) : null,
    isStale: true,
    fetchedAt: Date.now(),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function applyBuffer(value: bigint): bigint {
  return (value * BUFFER_MULTIPLIER) / BUFFER_DIVISOR;
}

function computeUsdCost(costWei: bigint, ethPriceUsd: number): string {
  const costEth = parseFloat(ethers.formatEther(costWei));
  return (costEth * ethPriceUsd).toFixed(4);
}

/**
 * Clears the fee cache for a specific chain (or all chains).
 * Call this when the user switches networks.
 */
export function clearGasCache(chainKey?: string): void {
  if (chainKey) {
    for (const key of feeCache.keys()) {
      if (key.startsWith(`${chainKey}:`)) {
        feeCache.delete(key);
      }
    }
  } else {
    feeCache.clear();
  }
}

/**
 * Checks whether the gas estimate would be considered high.
 * Returns true if the estimated USD cost exceeds the threshold.
 */
export function isGasExpensive(estimate: GasEstimate, thresholdUsd = 10): boolean {
  if (!estimate.estimatedCostUsd) return false;
  return parseFloat(estimate.estimatedCostUsd) > thresholdUsd;
}
