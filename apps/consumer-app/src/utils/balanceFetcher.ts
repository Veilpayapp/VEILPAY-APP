import { formatEther, formatUnits, parseAbi } from 'viem';
import { captureError } from './sentry';
import { poolCall } from './rpcPool';
import { getRpcUrl, buildAlchemyUrl } from './rpc';
import { useWalletStore } from '../stores/walletStore';
import type { ChainConfig } from '../stores/walletStore';

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

const ERC20_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
]);

const POPULAR_TOKENS: Record<string, Array<{ address: string; symbol: string; name: string; decimals: number }>> = {
  ethereum: [
    { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
    { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
    { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18 },
  ],
  polygon: [
    { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
    { address: '0x2791bca1f2de4661ed88a30c99a7a9449aa8f49a', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  ],
  arbitrum: [
    { address: '0xFd086bC7CD5C481DCC946852337f388B320e6b60', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
    { address: '0xaf88d06a609973603eC6DDde780F52eBdfb93154', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  ],
  base: [
    { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  ],
  bsc: [
    { address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT', name: 'Tether USD', decimals: 18 },
    { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC', name: 'USD Coin', decimals: 18 },
  ],
  sepolia: [
    { address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
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

function getChainConfig(chainKey: string): ChainConfig | null {
  const chains = useWalletStore.getState().allChains();
  return chains.find((c: ChainConfig) => c.key === chainKey) || null;
}

async function fetchSolanaBalance(address: string, chainConfig: ChainConfig): Promise<BalanceResult> {
  const nativeToken = chainConfig.nativeToken;
  const rpcUrl = chainConfig.rpcUrl || getRpcUrl(chainConfig.key);

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

    if (!response.ok) throw new Error(`Solana RPC error: ${response.status}`);
    const data = await response.json() as { result?: { value?: number }; error?: { message?: string } };
    if (data.error) throw new Error(data.error.message || 'Solana RPC error');

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
      scope: 'balance-fetcher', chain: chainConfig.key, address: address.substring(0, 10) + '...',
    });
    return {
      balance: '0', balanceFormatted: '0.000', symbol: nativeToken.symbol, decimals: nativeToken.decimals,
      lastUpdated: Date.now(), source: 'fallback', error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function fetchSolanaTokens(address: string, chainConfig: ChainConfig): Promise<TokenBalance[]> {
  const rpcUrl = chainConfig.rpcUrl || getRpcUrl(chainConfig.key);
  try {
    const response = await withTimeout(
      fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTokenAccountsByOwner',
          params: [
            address,
            { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, // SPL Token Program
            { encoding: 'jsonParsed' }
          ]
        })
      }),
      REQUEST_TIMEOUT_MS
    );
    
    if (!response.ok) throw new Error(`Solana RPC error: ${response.status}`);
    const data = await response.json() as any;
    if (data.error) throw new Error(data.error.message || 'Solana RPC error');
    
    const results: TokenBalance[] = [];
    const accounts = data.result?.value || [];
    
    for (const acc of accounts) {
      const info = acc.account?.data?.parsed?.info;
      if (!info) continue;
      
      const balance = info.tokenAmount?.amount || '0';
      if (balance === '0') continue; // Skip zero balances
      
      const decimals = info.tokenAmount?.decimals || 0;
      const mint = info.mint;
      
      const symbol = mint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' ? 'USDC' : 
                     mint === 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB' ? 'USDT' :
                     `${mint.substring(0, 4)}...${mint.substring(mint.length - 4)}`;
                     
      const balanceFormatted = formatUnits(BigInt(balance), decimals);
      
      results.push({
        tokenAddress: mint,
        tokenName: symbol,
        tokenSymbol: symbol,
        balance: balance,
        balanceFormatted: parseFloat(balanceFormatted).toFixed(6),
        symbol: symbol,
        decimals: decimals,
        lastUpdated: Date.now(),
        source: 'rpc',
      });
    }
    return results;
  } catch (error) {
    console.warn(`Failed to fetch Solana tokens on ${chainConfig.key}`, error);
    return [];
  }
}

async function fetchAptosBalance(address: string, chainConfig: ChainConfig): Promise<BalanceResult> {
  const nativeToken = chainConfig.nativeToken;
  const rpcUrl = chainConfig.rpcUrl || getRpcUrl(chainConfig.key);
  const baseUrl = rpcUrl.replace(/\/$/, '');

  try {
    const resourceUrl = `${baseUrl}/v1/accounts/${address}/resource/0x1::coin::CoinStore%3C0x1::aptos_coin::AptosCoin%3E`;
    const response = await withTimeout(fetch(resourceUrl, { method: 'GET', headers: { Accept: 'application/json' } }), REQUEST_TIMEOUT_MS);

    if (!response.ok) {
      if (response.status === 404) {
        return { balance: '0', balanceFormatted: '0.000', symbol: nativeToken.symbol, decimals: nativeToken.decimals, lastUpdated: Date.now(), source: 'rpc' };
      }
      throw new Error(`Aptos API error: ${response.status}`);
    }

    const data = await response.json() as { data?: { coin?: { value?: string } } };
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
      scope: 'balance-fetcher', chain: chainConfig.key, address: address.substring(0, 10) + '...',
    });
    return {
      balance: '0', balanceFormatted: '0.000', symbol: nativeToken.symbol, decimals: nativeToken.decimals,
      lastUpdated: Date.now(), source: 'fallback', error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ── NEW: Stellar Fetcher ──
async function fetchStellarBalance(address: string, chainConfig: ChainConfig): Promise<BalanceResult> {
  const nativeToken = chainConfig.nativeToken;
  const rpcUrl = chainConfig.rpcUrl || getRpcUrl(chainConfig.key);
  const baseUrl = rpcUrl.replace(/\/$/, '');

  try {
    const response = await withTimeout(fetch(`${baseUrl}/accounts/${address}`), REQUEST_TIMEOUT_MS);
    
    if (!response.ok) {
      if (response.status === 404 || response.status === 400) {
        return { balance: '0', balanceFormatted: '0.000', symbol: nativeToken.symbol, decimals: nativeToken.decimals, lastUpdated: Date.now(), source: 'rpc' };
      }
      throw new Error(`Stellar API error: ${response.status}`);
    }

    const data = await response.json() as { balances?: Array<{ balance: string; asset_type: string }> };
    
    const nativeBal = data.balances?.find((b: any) => b.asset_type === 'native');
    const balanceStr = nativeBal?.balance || '0'; 
    
    const numValue = parseFloat(balanceStr);
    const stroops = Math.floor(numValue * 1e7).toString();

    return {
      balance: stroops,
      balanceFormatted: numValue.toFixed(7).replace(/\.?0+$/, '') || '0',
      symbol: nativeToken.symbol,
      decimals: nativeToken.decimals,
      lastUpdated: Date.now(),
      source: 'rpc',
    };
  } catch (error) {
    captureError(error instanceof Error ? error : new Error('Failed to fetch Stellar balance'), {
      scope: 'balance-fetcher', chain: chainConfig.key, address: address.substring(0, 10) + '...',
    });
    return {
      balance: '0', balanceFormatted: '0.000', symbol: nativeToken.symbol, decimals: nativeToken.decimals,
      lastUpdated: Date.now(), source: 'fallback', error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function fetchStellarTokens(address: string, chainConfig: ChainConfig): Promise<TokenBalance[]> {
  const rpcUrl = chainConfig.rpcUrl || getRpcUrl(chainConfig.key);
  const baseUrl = rpcUrl.replace(/\/$/, '');

  try {
    const response = await withTimeout(fetch(`${baseUrl}/accounts/${address}`), REQUEST_TIMEOUT_MS);
    if (!response.ok) return [];

    const data = await response.json() as { balances?: Array<{ balance: string; asset_type: string; asset_code?: string; asset_issuer?: string }> };
    const balances = data.balances || [];
    
    const tokenBalances: TokenBalance[] = [];
    
    for (const b of balances) {
      if (b.asset_type === 'native' || !b.asset_code) continue;
      if (b.balance === '0' || b.balance === '0.0000000') continue;
      
      const numValue = parseFloat(b.balance);
      const stroops = Math.floor(numValue * 1e7).toString();
      
      tokenBalances.push({
        tokenAddress: b.asset_issuer || '',
        tokenName: b.asset_code,
        tokenSymbol: b.asset_code,
        balance: stroops,
        balanceFormatted: numValue.toFixed(7).replace(/\.?0+$/, '') || '0',
        symbol: b.asset_code,
        decimals: 7,
        lastUpdated: Date.now(),
        source: 'rpc'
      });
    }
    
    return tokenBalances;
  } catch (error) {
    console.warn(`Failed to fetch Stellar tokens on ${chainConfig.key}`, error);
    return [];
  }
}

export async function fetchNativeBalance(address: string, chainKey: string): Promise<BalanceResult> {
  const chainConfig = getChainConfig(chainKey);
  
  if (!chainConfig) {
    return { balance: '0', balanceFormatted: '0.000', symbol: 'UNKNOWN', decimals: 18, lastUpdated: Date.now(), source: 'fallback', error: `Unknown chain: ${chainKey}` };
  }

  const nativeToken = chainConfig.nativeToken;
  const chainType = chainConfig.type;

  if (chainType === 'svm') return fetchSolanaBalance(address, chainConfig);
  if (chainType === 'mvm') return fetchAptosBalance(address, chainConfig);
  if (chainType === 'xlm') return fetchStellarBalance(address, chainConfig);

  // Fallback for EVM and all others natively supported by Viem JSON-RPC
  try {
    const balance = await withTimeout(
      poolCall(chainKey, (p) => p.getBalance({ address: address as `0x${string}` })),
      REQUEST_TIMEOUT_MS
    );

    const balanceBigInt = balance.toString();
    const balanceFormatted = formatEther(balance);

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
      scope: 'balance-fetcher', chain: chainKey, address: address.substring(0, 10) + '...',
    });
    return { balance: '0', balanceFormatted: '0.000', symbol: nativeToken.symbol, decimals: nativeToken.decimals, lastUpdated: Date.now(), source: 'fallback', error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function fetchERC20Balances(address: string, chainKey: string): Promise<TokenBalance[]> {
  const alchemyUrl = buildAlchemyUrl(chainKey);
  if (alchemyUrl) {
    try {
      const response = await withTimeout(
        fetch(alchemyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'alchemy_getTokenBalances',
            params: [address, 'erc20'],
          })
        }),
        REQUEST_TIMEOUT_MS
      );
      
      if (!response.ok) throw new Error(`Alchemy HTTP error: ${response.status}`);
      const data = await response.json() as any;
      if (data.error) throw new Error(data.error.message || 'Alchemy RPC error');

      const rawTokenBalances = data.result?.tokenBalances || [];
      const nonZeroTokens = rawTokenBalances.filter((t: any) => {
        if (!t.tokenBalance || t.tokenBalance === '0' || t.tokenBalance === '0x0') return false;
        return true;
      });

      if (nonZeroTokens.length > 0) {
        const metadataPayload = nonZeroTokens.map((t: any, idx: number) => ({
          jsonrpc: '2.0',
          id: idx + 2,
          method: 'alchemy_getTokenMetadata',
          params: [t.contractAddress],
        }));

        const metaResponse = await withTimeout(
          fetch(alchemyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(metadataPayload)
          }),
          REQUEST_TIMEOUT_MS
        );
        
        if (!metaResponse.ok) throw new Error(`Alchemy metadata HTTP error: ${metaResponse.status}`);
        const metaDataBatch = await metaResponse.json() as any[];
        
        const dynamicResults: TokenBalance[] = [];
        
        for (let i = 0; i < nonZeroTokens.length; i++) {
          const t = nonZeroTokens[i];
          const metaItem = metaDataBatch.find((m: any) => m.id === i + 2);
          const meta = metaItem?.result;
          
          if (!meta || typeof meta.decimals !== 'number') continue;
          if (!meta.symbol || meta.symbol.length > 15) continue;

          try {
            const balanceBigInt = BigInt(t.tokenBalance).toString();
            const balanceFormatted = formatUnits(BigInt(balanceBigInt), meta.decimals);

            dynamicResults.push({
              tokenAddress: t.contractAddress,
              tokenName: meta.name || meta.symbol,
              tokenSymbol: meta.symbol,
              balance: balanceBigInt,
              balanceFormatted: parseFloat(balanceFormatted).toFixed(6),
              symbol: meta.symbol,
              decimals: meta.decimals,
              lastUpdated: Date.now(),
              source: 'rpc',
            });
          } catch (err) {
            console.warn(`Failed parsing balance for dynamic token ${t.contractAddress}`, err);
          }
        }
        
        return dynamicResults;
      }
      return [];
    } catch (error) {
      console.warn(`Dynamic token discovery failed on ${chainKey}, falling back to hardcoded.`, error);
    }
  }

  // Fallback: Use standard viem readContract for hardcoded popular tokens if Alchemy fails
  const tokens = POPULAR_TOKENS[chainKey];
  if (!tokens || tokens.length === 0) return [];
  const results: TokenBalance[] = [];

  await Promise.all(
    tokens.map(async (token) => {
      try {
        const [balance, decimals] = await Promise.all([
          withTimeout(
            poolCall(chainKey, (p) => p.readContract({
              address: token.address as `0x${string}`,
              abi: ERC20_ABI,
              functionName: 'balanceOf',
              args: [address as `0x${string}`],
            }) as Promise<bigint>),
            REQUEST_TIMEOUT_MS
          ),
          token.decimals,
        ]);

        const balanceBigInt = balance.toString();
        if (BigInt(balanceBigInt) === BigInt(0)) return;

        const balanceFormatted = formatUnits(BigInt(balanceBigInt), decimals);

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
        console.warn(`Failed to fetch ${token.symbol} balance on ${chainKey}:`, error);
      }
    })
  );
  return results;
}

export async function fetchAllBalances(address: string, chainKey: string): Promise<WalletBalances> {
  const chainConfig = getChainConfig(chainKey);
  const chainType = chainConfig?.type || 'evm';
  
  const [nativeBalance, tokenBalances] = await Promise.all([
    fetchNativeBalance(address, chainKey),
    chainType === 'svm' && chainConfig ? fetchSolanaTokens(address, chainConfig) : 
    chainType === 'xlm' && chainConfig ? fetchStellarTokens(address, chainConfig) : 
    (chainType === 'evm' ? fetchERC20Balances(address, chainKey) : Promise.resolve([])),
  ]);
  
  return { native: nativeBalance, tokens: tokenBalances, totalUsdValue: 0, lastUpdated: Date.now() };
}

export function formatBalanceForDisplay(balance: string, decimals: number = 18): string {
  try {
    const formatted = formatUnits(BigInt(balance), decimals);
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
