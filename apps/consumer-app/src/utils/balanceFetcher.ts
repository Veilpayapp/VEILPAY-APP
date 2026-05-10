/**
 * Blockchain Balance Fetcher
 * Fetches real-time wallet balances from multiple blockchain networks
 *
 * Supported chains:
 * - EVM: Ethereum, Polygon, Arbitrum, Sepolia (using ethers.js)
 * - SVM: Solana, Solana Devnet (using JSON-RPC getBalance)
 * - MVM: Aptos (using REST API /v1/accounts/{address}/resource)
 */

import { ethers, Contract } from 'ethers';
import { captureError } from './sentry';
import { poolCall } from './rpcPool';
import { getRpcUrl } from './rpc';

export interface BalanceResult {
  balance: string;
  balanceFormatted: string;
  symbol: string;
  decimals: number;
  usdValue?: number;
  lastUpdated: number;
  source: 'rpc' | 'indexer' | 'cache' | 'fallback';
  error?: string;
}

export interface TokenBalance extends BalanceResult {
  tokenAddress?: string;
  tokenName: string;
  tokenSymbol: string;
}

export interface WalletBalances {
  native: BalanceResult;
  tokens: TokenBalance[];
  totalUsdValue: number;
  lastUpdated: number;
}

const REQUEST_TIMEOUT_MS = 15000;

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
];

const NATIVE_TOKENS: Record<string, { symbol: string; name: string; decimals: number }> = {
  ethereum: { symbol: 'ETH', name: 'Ether', decimals: 18 },
  polygon: { symbol: 'MATIC', name: 'MATIC', decimals: 18 },
  arbitrum: { symbol: 'ETH', name: 'Ether', decimals: 18 },
  sepolia: { symbol: 'ETH', name: 'Ether', decimals: 18 },
  solana: { symbol: 'SOL', name: 'Solana', decimals: 9 },
  'solana-devnet': { symbol: 'SOL', name: 'Solana', decimals: 9 },
  aptos: { symbol: 'APT', name: 'Aptos', decimals: 8 },
};

const POPULAR_TOKENS: Record<string, Array<{ address: string; symbol: string; name: string; decimals: number }>> = {
  ethereum: [
    { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
    { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
    { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18 },
  ],
  polygon: [
    { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
    { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa8f49a', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  ],
  arbitrum: [
    { address: '0xFd086bC7CD5C481DCC946852337f388B320e6b60', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
    { address: '0xaf88d06a609973603eC6DDde780F52eBdfb93154', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  ],
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
    ),
  ]);
}

function getChainTypeFromKey(key: string): 'evm' | 'svm' | 'mvm' | null {
  const map: Record<string, 'evm' | 'svm' | 'mvm'> = {
    ethereum: 'evm',
    polygon: 'evm',
    arbitrum: 'evm',
    sepolia: 'evm',
    solana: 'svm',
    'solana-devnet': 'svm',
    aptos: 'mvm',
  };
  return map[key] || null;
}

async function fetchSolanaBalance(
  address: string,
  chainKey: string
): Promise<BalanceResult> {
  const nativeToken = NATIVE_TOKENS[chainKey] || NATIVE_TOKENS['solana'];
  const rpcUrl = getRpcUrl(chainKey);

  try {
    const response = await withTimeout(
      fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getBalance',
          params: [address, { commitment: 'confirmed' }],
        }),
      }),
      REQUEST_TIMEOUT_MS
    );

    if (!response.ok) {
      throw new Error(`Solana RPC error: ${response.status}`);
    }

    const data = await response.json() as { result?: { value?: number }; error?: { message?: string } };

    if (data.error) {
      throw new Error(data.error.message || 'Solana RPC error');
    }

    const lamports = data.result?.value ?? 0;
    const solBalance = lamports / 1e9;

    return {
      balance: String(lamports),
      balanceFormatted: solBalance.toFixed(9).replace(/\.?0+$/, '') || '0',
      symbol: nativeToken.symbol,
      decimals: nativeToken.decimals,
      lastUpdated: Date.now(),
      source: 'rpc',
    };
  } catch (error) {
    captureError(error instanceof Error ? error : new Error('Failed to fetch Solana balance'), {
      scope: 'balance-fetcher',
      chain: chainKey,
      address: address.substring(0, 10) + '...',
    });

    return {
      balance: '0',
      balanceFormatted: '0.000',
      symbol: nativeToken.symbol,
      decimals: nativeToken.decimals,
      lastUpdated: Date.now(),
      source: 'fallback',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function fetchAptosBalance(
  address: string,
  chainKey: string
): Promise<BalanceResult> {
  const nativeToken = NATIVE_TOKENS[chainKey] || NATIVE_TOKENS['aptos'];
  const rpcUrl = getRpcUrl(chainKey);
  const baseUrl = rpcUrl.replace(/\/$/, '');

  try {
    const resourceUrl = `${baseUrl}/v1/accounts/${address}/resource/0x1::coin::CoinStore%3C0x1::aptos_coin::AptosCoin%3E`;

    const response = await withTimeout(
      fetch(resourceUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      }),
      REQUEST_TIMEOUT_MS
    );

    if (!response.ok) {
      if (response.status === 404) {
        return {
          balance: '0',
          balanceFormatted: '0.000',
          symbol: nativeToken.symbol,
          decimals: nativeToken.decimals,
          lastUpdated: Date.now(),
          source: 'rpc',
        };
      }
      throw new Error(`Aptos API error: ${response.status}`);
    }

    const data = await response.json() as {
      data?: { coin?: { value?: string } };
    };

    const octas = BigInt(data.data?.coin?.value || '0');
    const aptBalance = Number(octas) / 1e8;

    return {
      balance: octas.toString(),
      balanceFormatted: aptBalance.toFixed(8).replace(/\.?0+$/, '') || '0',
      symbol: nativeToken.symbol,
      decimals: nativeToken.decimals,
      lastUpdated: Date.now(),
      source: 'rpc',
    };
  } catch (error) {
    captureError(error instanceof Error ? error : new Error('Failed to fetch Aptos balance'), {
      scope: 'balance-fetcher',
      chain: chainKey,
      address: address.substring(0, 10) + '...',
    });

    return {
      balance: '0',
      balanceFormatted: '0.000',
      symbol: nativeToken.symbol,
      decimals: nativeToken.decimals,
      lastUpdated: Date.now(),
      source: 'fallback',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function fetchNativeBalance(
  address: string,
  chainKey: string
): Promise<BalanceResult> {
  const nativeToken = NATIVE_TOKENS[chainKey];
  if (!nativeToken) {
    return {
      balance: '0',
      balanceFormatted: '0.000',
      symbol: 'UNKNOWN',
      decimals: 18,
      lastUpdated: Date.now(),
      source: 'fallback',
      error: `Unknown chain: ${chainKey}`,
    };
  }

  const chainType = getChainTypeFromKey(chainKey);

  if (chainType === 'svm') {
    return fetchSolanaBalance(address, chainKey);
  }

  if (chainType === 'mvm') {
    return fetchAptosBalance(address, chainKey);
  }

  try {
    const balance = await withTimeout(
      poolCall(chainKey, (p) => p.getBalance(address)),
      REQUEST_TIMEOUT_MS
    );

    const balanceBigInt = balance.toString();
    const balanceFormatted = ethers.formatEther(balance);

    return {
      balance: balanceBigInt,
      balanceFormatted: parseFloat(balanceFormatted).toFixed(6),
      symbol: nativeToken.symbol,
      decimals: nativeToken.decimals,
      lastUpdated: Date.now(),
      source: 'rpc',
    };
  } catch (error) {
    captureError(error instanceof Error ? error : new Error('Failed to fetch native balance'), {
      scope: 'balance-fetcher',
      chain: chainKey,
      address: address.substring(0, 10) + '...',
    });

    return {
      balance: '0',
      balanceFormatted: '0.000',
      symbol: nativeToken.symbol,
      decimals: nativeToken.decimals,
      lastUpdated: Date.now(),
      source: 'fallback',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function fetchERC20Balances(
  address: string,
  chainKey: string
): Promise<TokenBalance[]> {
  const tokens = POPULAR_TOKENS[chainKey];

  if (!tokens || tokens.length === 0) {
    return [];
  }
  const results: TokenBalance[] = [];

  await Promise.all(
    tokens.map(async (token) => {
      try {
        const [balance, decimals] = await Promise.all([
          withTimeout(
            poolCall(chainKey, (p) => {
              const contract = new Contract(token.address, ERC20_ABI, p);
              return contract.balanceOf(address) as Promise<bigint>;
            }),
            REQUEST_TIMEOUT_MS
          ),
          token.decimals,
        ]);

        const balanceBigInt = balance.toString();
        
        if (BigInt(balanceBigInt) === BigInt(0)) {
          return;
        }

        const balanceFormatted = ethers.formatUnits(balanceBigInt, decimals);

        results.push({
          tokenAddress: token.address,
          tokenName: token.name,
          tokenSymbol: token.symbol,
          balance: balanceBigInt,
          balanceFormatted: parseFloat(balanceFormatted).toFixed(6),
          symbol: token.symbol,
          decimals: decimals,
          lastUpdated: Date.now(),
          source: 'rpc',
        });
      } catch (error) {
        // Silently skip failed token fetches
        console.warn(`Failed to fetch ${token.symbol} balance on ${chainKey}:`, error);
      }
    })
  );

  return results;
}

export async function fetchAllBalances(
  address: string,
  chainKey: string
): Promise<WalletBalances> {
  const [nativeBalance, tokenBalances] = await Promise.all([
    fetchNativeBalance(address, chainKey),
    fetchERC20Balances(address, chainKey),
  ]);

  return {
    native: nativeBalance,
    tokens: tokenBalances,
    totalUsdValue: 0, // Will be calculated by caller with price data
    lastUpdated: Date.now(),
  };
}

export function formatBalanceForDisplay(balance: string, decimals: number = 18): string {
  try {
    const formatted = ethers.formatUnits(balance, decimals);
    const num = parseFloat(formatted);
    
    if (num === 0) return '0.00';
    if (num < 0.000001) return '< 0.000001';
    if (num < 0.01) return num.toFixed(6);
    if (num < 1000) return num.toFixed(4);
    return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
  } catch {
    return '0.00';
  }
}

export { ethers };
