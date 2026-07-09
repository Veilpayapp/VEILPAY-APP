import type { TransactionRecord, TransactionStatus, TransactionType } from '../types/transactions';
import { validateAddress, type ChainType, type ChainConfig } from '../stores/walletStore';
import { useTransactionStore, useTransactions } from '../stores/transactionStore';
import { formatEther } from 'viem';
import { captureError } from './sentry';
import { poolCall } from './rpcPool';
import { fetchEvmHistory, fetchSolanaHistory, fetchStellarHistory } from './publicIndexers';
import { getChainTypeFromKey } from './validation';

interface RawResponse {
  data?: {
    transactions?: unknown[];
    items?: unknown[];
    nextCursor?: string | null;
    hasMore?: boolean;
  };
  transactions?: unknown[];
  items?: unknown[];
  nextCursor?: string | null;
  hasMore?: boolean;
  pagination?: {
    nextCursor?: string | null;
    hasMore?: boolean;
  };
}

export interface FetchTransactionHistoryParams {
  address: string;
  chainKey?: string;
  cursor?: string;
  limit?: number;
}

export interface TransactionHistoryPage {
  transactions: TransactionRecord[];
  nextCursor: string | null;
  hasMore: boolean;
}

const REQUEST_TIMEOUT_MS = 10000;
const INDEXER_BASE_URL =
  process.env.EXPO_PUBLIC_INDEXER_BASE_URL || process.env.EXPO_PUBLIC_BACKEND_BASE_URL || '';
const INDEXER_HISTORY_PATH = process.env.EXPO_PUBLIC_INDEXER_HISTORY_PATH || '/api/v1/transactions';

function normalizeType(rawType: unknown, from: string, to: string, address: string): TransactionType {
  const value = String(rawType || '').toLowerCase();
  if (value === 'sent' || value === 'send' || value === 'outgoing' || value === 'out') {
    return 'sent';
  }

  if (value === 'received' || value === 'receive' || value === 'incoming' || value === 'in') {
    return 'received';
  }

  const normalizedAddress = address.toLowerCase();
  if (from.toLowerCase() === normalizedAddress) {
    return 'sent';
  }

  if (to.toLowerCase() === normalizedAddress) {
    return 'received';
  }

  return 'sent';
}

function normalizeStatus(rawStatus: unknown): TransactionStatus {
  const value = String(rawStatus || '').toLowerCase();

  if (value === 'completed' || value === 'confirmed' || value === 'success' || value === 'succeeded') {
    return 'completed';
  }

  if (value === 'pending' || value === 'queued' || value === 'processing') {
    return 'pending';
  }

  if (value === 'failed' || value === 'reverted' || value === 'error') {
    return 'failed';
  }

  return 'pending';
}

function normalizeTimestamp(rawTimestamp: unknown): number {
  if (typeof rawTimestamp === 'number' && Number.isFinite(rawTimestamp)) {
    return rawTimestamp > 1e12 ? rawTimestamp : rawTimestamp * 1000;
  }

  if (typeof rawTimestamp === 'string') {
    const numeric = Number(rawTimestamp);
    if (!Number.isNaN(numeric)) {
      return numeric > 1e12 ? numeric : numeric * 1000;
    }

    const parsed = Date.parse(rawTimestamp);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return Date.now();
}

function normalizeAmount(rawAmount: unknown): string {
  if (typeof rawAmount === 'number' && Number.isFinite(rawAmount)) {
    return rawAmount.toString();
  }

  if (typeof rawAmount === 'string' && rawAmount.trim().length > 0) {
    return rawAmount;
  }

  return '0';
}

function mapTransaction(raw: unknown, walletAddress: string, defaultChainKey?: string): TransactionRecord | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const item = raw as Record<string, unknown>;
  const from = String(item.from || item.sender || '').trim();
  const to = String(item.to || item.recipient || '').trim();
  const hash = String(item.hash || item.txHash || item.transactionHash || '').trim();
  const id = String(item.id || item.txId || hash || '').trim();

  if (!id && !hash) {
    return null;
  }

  const tokenSymbol = String(item.tokenSymbol || item.symbol || item.assetSymbol || 'ETH').trim() || 'ETH';
  const tokenName = String(item.token || item.tokenName || item.assetName || tokenSymbol).trim() || tokenSymbol;
  const timestamp = normalizeTimestamp(item.timestamp || item.time || item.createdAt || item.blockTimestamp);

  const normalized: TransactionRecord = {
    id: id || hash,
    type: normalizeType(item.type || item.direction, from, to, walletAddress),
    amount: normalizeAmount(item.amount || item.value || item.amountFormatted),
    token: tokenName,
    tokenSymbol,
    from,
    to,
    timestamp,
    status: normalizeStatus(item.status),
    hash: hash || id,
    network: String(item.network || item.chain || defaultChainKey || '').trim() || undefined,
  };

  const privacyLevel = String(item.privacyLevel || item.privacy || '').toLowerCase();
  if (privacyLevel === 'max' || privacyLevel === 'standard') {
    normalized.privacyLevel = privacyLevel;
  }

  if (item.fee !== undefined && item.fee !== null) {
    normalized.fee = String(item.fee);
  }

  return normalized;
}

function getTransactionsArray(payload: RawResponse | unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const response = payload as RawResponse;
  if (Array.isArray(response.transactions)) {
    return response.transactions;
  }

  if (Array.isArray(response.items)) {
    return response.items;
  }

  if (Array.isArray(response.data?.transactions)) {
    return response.data?.transactions ?? [];
  }

  if (Array.isArray(response.data?.items)) {
    return response.data?.items ?? [];
  }

  return [];
}

function getCursor(payload: RawResponse | unknown): { nextCursor: string | null; hasMore: boolean } {
  if (!payload || typeof payload !== 'object') {
    return { nextCursor: null, hasMore: false };
  }

  const response = payload as RawResponse;
  const nextCursor =
    response.nextCursor ?? response.data?.nextCursor ?? response.pagination?.nextCursor ?? null;
  const hasMore =
    response.hasMore ?? response.data?.hasMore ?? response.pagination?.hasMore ?? Boolean(nextCursor);

  return { nextCursor, hasMore };
}

// Chain-type resolution is delegated to the canonical map in `utils/validation.ts`
// (single source of truth, kept in lockstep with `chains.ts` by a drift-guard
// test). The previous local copy here silently omitted `bsc` and `base`, which
// routed those EVM chains to the "unsupported" fallback and returned empty
// history for them.

async function fetchBlockchainTransactions(
  address: string,
  chainKey: string,
  cursor: string | undefined,
  limit: number = 20
): Promise<TransactionHistoryPage> {
  const chainType = getChainTypeFromKey(chainKey);
  
  if (chainType === 'evm') {
    return fetchEvmHistory(address, chainKey, cursor, limit);
  }
  
  if (chainType === 'svm') {
    return fetchSolanaHistory(address, chainKey, cursor, limit);
  }
  
  if (chainType === 'xlm') {
    return fetchStellarHistory(address, chainKey, cursor, limit);
  }

  // Fallback for unsupported chains (e.g. mvm/aptos) - return empty for now since indexer is required
  console.warn(`Public indexer not yet implemented for chain type: ${chainType}`);
  return { transactions: [], nextCursor: null, hasMore: false };
}

async function fetchIndexerTransactions(
  address: string,
  chainKey: string | undefined,
  cursor: string | undefined,
  limit: number
): Promise<TransactionHistoryPage> {
  const params = new URLSearchParams();
  params.set('address', address);
  params.set('limit', String(limit));

  if (chainKey) {
    params.set('chain', chainKey);
  }

  if (cursor) {
    params.set('cursor', cursor);
  }

  const normalizedBase = INDEXER_BASE_URL.replace(/\/$/, '');
  const normalizedPath = INDEXER_HISTORY_PATH.startsWith('/')
    ? INDEXER_HISTORY_PATH
    : `/${INDEXER_HISTORY_PATH}`;
  const url = `${normalizedBase}${normalizedPath}?${params.toString()}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Indexer request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as RawResponse | unknown;
    const rawItems = getTransactionsArray(payload);

    const transactions = rawItems
      .map((raw) => mapTransaction(raw, address, chainKey))
      .filter((item): item is TransactionRecord => item !== null)
      .sort((a, b) => b.timestamp - a.timestamp);

    const { nextCursor, hasMore } = getCursor(payload);

    return {
      transactions,
      nextCursor,
      hasMore,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchTransactionHistoryPage({
  address,
  chainKey,
  cursor,
  limit = 20,
}: FetchTransactionHistoryParams): Promise<TransactionHistoryPage> {
  if (!address) {
    return {
      transactions: [],
      nextCursor: null,
      hasMore: false,
    };
  }

  const chainType = getChainTypeFromKey(chainKey);
  if (chainType && !validateAddress(address, chainType)) {
    console.warn(`Invalid ${chainType} address format: ${address.substring(0, 10)}...`);
    return {
      transactions: [],
      nextCursor: null,
      hasMore: false,
    };
  }

  if (INDEXER_BASE_URL) {
    try {
      return await fetchIndexerTransactions(address, chainKey, cursor, limit);
    } catch (error) {
      // AbortError = request timed out or was cancelled (expected on devnets / no indexer)
      // Silently fall back to blockchain without polluting console or Sentry.
      const isAbort = error instanceof Error && error.name === 'AbortError';

      if (!isAbort) {
        console.warn('Indexer fetch failed, falling back to blockchain:', error);
        captureError(error instanceof Error ? error : new Error('Indexer fetch failed'), {
          scope: 'transaction-history',
          chain: chainKey,
        });
      }
    }
  }

  if (chainKey) {
    return fetchBlockchainTransactions(address, chainKey, cursor, limit);
  }

  return { transactions: [], nextCursor: null, hasMore: false };
}

export async function fetchPendingTransactions(
  address: string,
  chainKey: string
): Promise<TransactionRecord[]> {
  try {
    const pendingBlock = await poolCall(chainKey, (p) => p.getBlock({ blockTag: 'pending', includeTransactions: true }));
    if (!pendingBlock || !pendingBlock.transactions) return [];

    const pending: TransactionRecord[] = [];
    const lowerAddress = address.toLowerCase();

    for (const tx of pendingBlock.transactions as any[]) {
      try {
        if (tx && tx.from && tx.to) {
          const txHash = tx.hash;
          const fromLower = tx.from.toLowerCase();
          const toLower = tx.to.toLowerCase();
          
          if (fromLower === lowerAddress || toLower === lowerAddress) {
            pending.push({
              id: txHash,
              type: fromLower === lowerAddress ? 'sent' : 'received',
              amount: formatEther(tx.value),
              token: 'Ether',
              tokenSymbol: 'ETH',
              from: tx.from,
              to: tx.to,
              timestamp: Date.now(),
              status: 'pending',
              hash: txHash,
              network: chainKey,
            });
          }
        }
      } catch {
        continue;
      }
    }

    return pending;
  } catch (error) {
    captureError(error instanceof Error ? error : new Error('Pending tx fetch failed'), {
      scope: 'transaction-history',
      chain: chainKey,
    });
    return [];
  }
}

export function getTransactionExplorerUrl(txHash: string, chainKey: string): string {
  const explorers: Record<string, string> = {
    ethereum:        'https://etherscan.io/tx/',
    polygon:         'https://polygonscan.com/tx/',
    arbitrum:        'https://arbiscan.io/tx/',
    sepolia:         'https://sepolia.etherscan.io/tx/',
    'solana-devnet': 'https://explorer.solana.com/tx/',
    solana:          'https://explorer.solana.com/tx/',
    stellar:         'https://stellar.expert/explorer/public/tx/',
    'stellar-testnet':'https://stellar.expert/explorer/testnet/tx/',
  };
  
  if (chainKey === 'solana-devnet') {
    return `${explorers[chainKey]}${txHash}?cluster=devnet`;
  }
  
  return explorers[chainKey] ? `${explorers[chainKey]}${txHash}` : '';
}
