import { formatEther } from 'viem';
import { poolCall } from './rpcPool';
import { captureError } from './sentry';

export interface GasEstimate {
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  gasPrice: bigint;
  estimatedCostWei: bigint;
  estimatedCostEth: string;
  estimatedCostUsd: string | null;
  isStale: boolean;
  fetchedAt: number;
}

const BUFFER_MULTIPLIER = 115n;
const BUFFER_DIVISOR = 100n;
const CACHE_TTL_MS = 30_000;

const STATIC_FALLBACKS: Record<string, { gasPrice: bigint; maxFee: bigint; priorityFee: bigint }> = {
  ethereum:  { gasPrice: 20_000_000_000n, maxFee: 30_000_000_000n, priorityFee: 2_000_000_000n },
  polygon:   { gasPrice: 50_000_000_000n, maxFee: 60_000_000_000n, priorityFee: 30_000_000_000n },
  arbitrum:  { gasPrice:  1_000_000_000n, maxFee:  2_000_000_000n, priorityFee:    100_000_000n },
  sepolia:   { gasPrice:  5_000_000_000n, maxFee: 10_000_000_000n, priorityFee:  1_000_000_000n },
};

const STANDARD_GAS_LIMITS = {
  ETH_TRANSFER: 21_000n,
  ERC20_TRANSFER: 65_000n,
  CONTRACT_CALL: 200_000n,
} as const;

interface CacheEntry {
  estimate: GasEstimate;
  expiresAt: number;
}

const feeCache = new Map<string, CacheEntry>();

function getCacheKey(chainKey: string, toAddress: string, data?: string): string {
  const hasData = data && data !== '0x' && data.length > 2;
  return `${chainKey}:${hasData ? 'contract' : 'transfer'}:${toAddress.toLowerCase()}`;
}

export async function estimateTransactionGas(
  txRequest: { to?: string; value?: bigint; data?: string; from?: string },
  chainKey: string,
  ethPriceUsd?: number
): Promise<GasEstimate> {
  const cacheKey = getCacheKey(chainKey, String(txRequest.to || ''), String(txRequest.data || ''));
  const cached = feeCache.get(cacheKey);

  if (cached && Date.now() < cached.expiresAt) {
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
  txRequest: { to?: string; value?: bigint; data?: string; from?: string },
  chainKey: string,
  ethPriceUsd?: number
): Promise<GasEstimate> {
  const [feeData, rawGasLimit] = await Promise.all([
    poolCall(chainKey, async (p) => {
      try {
        const fees = await p.estimateFeesPerGas();
        return { maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas, gasPrice: null };
      } catch {
        const gasPrice = await p.getGasPrice();
        return { maxFeePerGas: null, maxPriorityFeePerGas: null, gasPrice };
      }
    }),
    poolCall(chainKey, (p) => p.estimateGas({
      account: (txRequest.from || '0x0000000000000000000000000000000000000000') as `0x${string}`,
      to: txRequest.to as `0x${string}`,
      value: txRequest.value,
      data: txRequest.data as `0x${string}` | undefined,
    })).catch(() => {
      const hasData = txRequest.data && txRequest.data !== '0x';
      return hasData ? STANDARD_GAS_LIMITS.ERC20_TRANSFER : STANDARD_GAS_LIMITS.ETH_TRANSFER;
    }),
  ]);

  const gasLimit = applyBuffer(rawGasLimit);

  const maxFeePerGas = feeData.maxFeePerGas != null
    ? applyBuffer(feeData.maxFeePerGas)
    : applyBuffer(feeData.gasPrice ?? 1_000_000_000n);

  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas != null
    ? applyBuffer(feeData.maxPriorityFeePerGas)
    : 1_000_000_000n;

  const gasPrice = feeData.gasPrice != null
    ? applyBuffer(feeData.gasPrice)
    : maxFeePerGas;

  const estimatedCostWei = gasLimit * maxFeePerGas;
  const estimatedCostEth = formatEther(estimatedCostWei);

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
  txRequest: { to?: string; value?: bigint; data?: string },
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
    estimatedCostEth: formatEther(estimatedCostWei),
    estimatedCostUsd: ethPriceUsd != null ? computeUsdCost(estimatedCostWei, ethPriceUsd) : null,
    isStale: true,
    fetchedAt: Date.now(),
  };
}

function applyBuffer(value: bigint): bigint {
  return (value * BUFFER_MULTIPLIER) / BUFFER_DIVISOR;
}

function computeUsdCost(costWei: bigint, ethPriceUsd: number): string {
  const costEth = parseFloat(formatEther(costWei));
  return (costEth * ethPriceUsd).toFixed(4);
}

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

export function isGasExpensive(estimate: GasEstimate, thresholdUsd = 10): boolean {
  if (!estimate.estimatedCostUsd) return false;
  return parseFloat(estimate.estimatedCostUsd) > thresholdUsd;
}
