import { formatEther } from 'viem';
import { Connection, PublicKey } from '@solana/web3.js';
import type { TransactionRecord } from '../types/transactions';
import { captureError } from './sentry';
import { getSppConfigForChain } from '../constants/spp';

const REQUEST_TIMEOUT_MS = 10000;

/** Stellar contract IDs are C… base32 (56 chars). */
const STELLAR_CONTRACT_ID_RE = /\bC[A-Z2-7]{55}\b/g;

/**
 * Collect any Soroban contract IDs present on a Horizon operation record.
 * Horizon shapes vary (contract_id, nested parameters, host_function_details).
 */
export function extractSorobanContractIds(record: Record<string, unknown>): string[] {
  const found = new Set<string>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 6 || value == null) return;
    if (typeof value === 'string') {
      if (/^C[A-Z2-7]{55}$/i.test(value)) {
        found.add(value.toUpperCase());
        return;
      }
      const matches = value.toUpperCase().match(STELLAR_CONTRACT_ID_RE);
      if (matches) matches.forEach((m) => found.add(m));
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value === 'object') {
      for (const v of Object.values(value as Record<string, unknown>)) {
        visit(v, depth + 1);
      }
    }
  };
  visit(record, 0);
  return [...found];
}

/**
 * True when this op is ASP membership plumbing (insert_leaf / tree writes).
 * Hide from user activity — not a payment.
 */
export function isAspMembershipOperation(
  record: Record<string, unknown>,
  chainKey: string
): boolean {
  const config = getSppConfigForChain(chainKey);
  if (!config) return false;
  const aspId = config.aspMembershipId.toUpperCase();
  return extractSorobanContractIds(record).some((id) => id === aspId);
}

/**
 * True when this Soroban invoke targets SPP infrastructure (pool, verifier,
 * ASP trees, registry). These must not appear in **public** activity —
 * private mode shows the local `createSppActivityRecord` summary instead.
 * Leaving them as Horizon "Contract / -0 XLM" rows polluted public feed and
 * duplicated what private history is for.
 */
export function isSppInfrastructureOperation(
  record: Record<string, unknown>,
  chainKey: string
): boolean {
  const config = getSppConfigForChain(chainKey);
  if (!config) return false;
  const sppIds = new Set(
    [
      config.poolId,
      config.verifierId,
      config.aspMembershipId,
      config.aspNonMembershipId,
      config.registryId,
    ].map((id) => id.toUpperCase())
  );
  return extractSorobanContractIds(record).some((id) => sppIds.has(id));
}

export async function fetchEvmHistory(
  address: string,
  chainKey: string,
  cursor: string | undefined,
  limit: number
): Promise<{ transactions: TransactionRecord[]; nextCursor: string | null; hasMore: boolean }> {
  // Map chainKey to Etherscan V2 API
  const apiMap: Record<string, string> = {
    ethereum: 'https://api.etherscan.io/v2/api?chainid=1',
    polygon: 'https://api.etherscan.io/v2/api?chainid=137',
    arbitrum: 'https://api.etherscan.io/v2/api?chainid=42161',
    sepolia: 'https://api.etherscan.io/v2/api?chainid=11155111',
  };

  const apiKeyMap: Record<string, string | undefined> = {
    ethereum: process.env.EXPO_PUBLIC_ETHERSCAN_API_KEY,
    polygon: process.env.EXPO_PUBLIC_ETHERSCAN_API_KEY, // V2 uses Etherscan key for all
    arbitrum: process.env.EXPO_PUBLIC_ETHERSCAN_API_KEY,
    sepolia: process.env.EXPO_PUBLIC_ETHERSCAN_API_KEY,
  };

  const baseUrl = apiMap[chainKey];
  if (!baseUrl) {
    throw new Error(`Unsupported EVM chain for public indexer: ${chainKey}`);
  }

  const apiKey = apiKeyMap[chainKey] || '';
  const page = cursor ? parseInt(cursor, 10) : 1;
  const offset = limit;

  let url = `${baseUrl}&module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=${page}&offset=${offset}&sort=desc`;
  if (apiKey) {
    url += `&apikey=${apiKey}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const data = await response.json();

    if (data.status === '0' && data.message !== 'No transactions found') {
      throw new Error(`Etherscan API error: ${data.result}`);
    }

    const rawTxs = Array.isArray(data.result) ? data.result : [];
    
    const transactions: TransactionRecord[] = rawTxs.map((tx: any) => {
      const isSender = tx.from.toLowerCase() === address.toLowerCase();
      return {
        id: tx.hash,
        type: isSender ? 'sent' : 'received',
        amount: formatEther(BigInt(tx.value || '0')),
        token: 'Ether', // Can be expanded for ERC20 via tokentx action
        tokenSymbol: 'ETH',
        from: tx.from,
        to: tx.to,
        timestamp: parseInt(tx.timeStamp, 10) * 1000,
        status: tx.isError === '0' ? 'completed' : 'failed',
        hash: tx.hash,
        network: chainKey,
        fee: formatEther(BigInt(tx.gasUsed || '0') * BigInt(tx.gasPrice || '0')),
      };
    });

    const hasMore = rawTxs.length === limit;
    const nextCursor = hasMore ? (page + 1).toString() : null;

    return { transactions, nextCursor, hasMore };
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError';
    if (!isAbort) {
      captureError(error instanceof Error ? error : new Error('EVM Indexer failed'), { chain: chainKey });
    }
    return { transactions: [], nextCursor: null, hasMore: false };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchSolanaHistory(
  address: string,
  chainKey: string,
  cursor: string | undefined,
  limit: number
): Promise<{ transactions: TransactionRecord[]; nextCursor: string | null; hasMore: boolean }> {
  try {
    const rpcUrl = chainKey === 'solana' 
      ? (process.env.EXPO_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com')
      : (process.env.EXPO_PUBLIC_SOLANA_DEVNET_RPC_URL || 'https://api.devnet.solana.com');
      
    const connection = new Connection(rpcUrl);
    const pubKey = new PublicKey(address);

    // Fetch signatures
    const signatures = await connection.getSignaturesForAddress(pubKey, {
      before: cursor,
      limit,
    });

    if (signatures.length === 0) {
      return { transactions: [], nextCursor: null, hasMore: false };
    }

    // Parse transactions
    const parsedTxs = await connection.getParsedTransactions(
      signatures.map((s) => s.signature),
      { maxSupportedTransactionVersion: 0 }
    );

    const transactions: TransactionRecord[] = [];

    parsedTxs.forEach((tx, idx) => {
      if (!tx || !tx.meta || !tx.transaction) return;
      const signature = signatures[idx].signature;
      const blockTime = tx.blockTime ? tx.blockTime * 1000 : Date.now();
      
      // Calculate native balance change for the address
      const accountIndex = tx.transaction.message.accountKeys.findIndex(
        (k) => k.pubkey.toBase58() === address
      );
      
      if (accountIndex === -1) return;
      
      const preBalance = tx.meta.preBalances[accountIndex];
      const postBalance = tx.meta.postBalances[accountIndex];
      const change = postBalance - preBalance;
      
      // If change is negative, we sent. If positive, we received.
      const isSender = change < 0;
      const amountAbs = Math.abs(change);
      
      // Rough approximation of to/from since Solana uses many accounts
      const from = isSender ? address : (tx.transaction.message.accountKeys[0]?.pubkey.toBase58() || 'unknown');
      const to = isSender ? (tx.transaction.message.accountKeys[1]?.pubkey.toBase58() || 'unknown') : address;

      transactions.push({
        id: signature,
        type: isSender ? 'sent' : 'received',
        amount: (amountAbs / 1e9).toString(), // lamports to SOL
        token: 'Solana',
        tokenSymbol: 'SOL',
        from,
        to,
        timestamp: blockTime,
        status: tx.meta.err ? 'failed' : 'completed',
        hash: signature,
        network: chainKey,
        fee: (tx.meta.fee / 1e9).toString(),
      });
    });

    const hasMore = signatures.length === limit;
    const nextCursor = hasMore ? signatures[signatures.length - 1].signature : null;

    return { transactions, nextCursor, hasMore };
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError';
    if (!isAbort) {
      captureError(error instanceof Error ? error : new Error('Solana Indexer failed'), { chain: chainKey });
    }
    return { transactions: [], nextCursor: null, hasMore: false };
  }
}

/** Horizon page size when we need to skip noise ops (trustlines, offers, etc.). */
const STELLAR_HORIZON_PAGE_SIZE = 50;
/** Cap Horizon pages so a noisy account can't spin forever. */
const STELLAR_MAX_HORIZON_PAGES = 5;

function stellarAssetFields(record: {
  asset_type?: string;
  asset_code?: string;
}): { tokenSymbol: string; tokenName: string } {
  const isNative = !record.asset_type || record.asset_type === 'native';
  const tokenSymbol = isNative ? 'XLM' : (record.asset_code || 'XLM');
  return {
    tokenSymbol,
    tokenName: isNative ? 'Stellar' : tokenSymbol,
  };
}

/**
 * Map a Horizon `/operations` record into a home/history row.
 * Returns null for noise ops we deliberately hide (change_trust, manage_offer, …).
 */
export function mapStellarOperationToTransaction(
  record: Record<string, unknown>,
  address: string,
  chainKey: string
): TransactionRecord | null {
  const opType = String(record.type || '');
  const createdAt = String(record.created_at || '');
  const txHash = String(record.transaction_hash || record.id || '');
  const id = String(record.id || txHash);
  const timestamp = createdAt ? new Date(createdAt).getTime() : Date.now();
  const status: TransactionRecord['status'] = record.transaction_hash ? 'completed' : 'pending';
  const addrLower = address.toLowerCase();

  let from = '';
  let to = '';
  let amount = '0';
  let tokenSymbol = 'XLM';
  let tokenName = 'Stellar';
  let displayTitle: string | undefined;
  let displaySubtitle: string | undefined;

  if (opType === 'payment') {
    from = String(record.from || '');
    to = String(record.to || '');
    amount = String(record.amount || '0');
    ({ tokenSymbol, tokenName } = stellarAssetFields(record as { asset_type?: string; asset_code?: string }));
  } else if (opType === 'create_account') {
    from = String(record.funder || '');
    to = String(record.account || '');
    amount = String(record.starting_balance || '0');
  } else if (opType === 'path_payment_strict_send' || opType === 'path_payment_strict_receive') {
    from = String(record.from || '');
    to = String(record.to || '');
    // dest amount is always `amount`; source amount may differ on path payments
    amount = String(record.amount || record.source_amount || '0');
    ({ tokenSymbol, tokenName } = stellarAssetFields({
      asset_type: String(record.asset_type || record.source_asset_type || 'native'),
      asset_code: String(record.asset_code || record.source_asset_code || ''),
    }));
    displayTitle = 'Path payment';
  } else if (opType === 'account_merge') {
    from = String(record.account || record.source_account || '');
    to = String(record.into || '');
    amount = '0';
    displayTitle = 'Account merge';
  } else if (opType === 'invoke_host_function') {
    // SPP pool / verifier / ASP / registry: private activity only (local rows).
    if (isSppInfrastructureOperation(record, chainKey)) {
      return null;
    }

    // Soroban (non-SPP). Amount/counterparty aren't always on the op the way
    // payments are — only surface rows with a real balance change.
    from = String(record.source_account || '');
    to = String(
      (record as { contract_id?: string }).contract_id
        || (Array.isArray(record.asset_balance_changes)
          ? ''
          : '')
        || 'Contract'
    );
    // Prefer first balance change if Horizon attaches them
    const changes = record.asset_balance_changes as
      | Array<{ amount?: string; asset_type?: string; asset_code?: string; from?: string; to?: string }>
      | undefined;
    if (Array.isArray(changes) && changes.length > 0) {
      const c = changes[0];
      amount = String(c.amount || '0').replace(/^-/, '');
      if (c.from) from = c.from;
      if (c.to) to = c.to;
      ({ tokenSymbol, tokenName } = stellarAssetFields(c));
    }
    // Hide zero-amount contract spam ("Contract / -0 XLM") — not user payments.
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum === 0) {
      return null;
    }
    const isSender = from.toLowerCase() === addrLower || String(record.source_account || '').toLowerCase() === addrLower;
    displayTitle = 'Contract';
    displaySubtitle = 'On-chain contract call';
    return {
      id,
      type: isSender ? 'sent' : 'received',
      amount,
      token: tokenName,
      tokenSymbol,
      from: from || String(record.source_account || 'unknown'),
      to: to || 'Contract',
      timestamp,
      status,
      hash: txHash,
      network: chainKey,
      displayTitle,
      displaySubtitle,
    };
  } else {
    // change_trust, manage_sell_offer, set_options, bump_sequence, …
    return null;
  }

  const isSender = from.toLowerCase() === addrLower;

  return {
    id,
    type: isSender ? 'sent' : 'received',
    amount,
    token: tokenName,
    tokenSymbol,
    from: from || 'unknown',
    to: to || 'unknown',
    timestamp,
    status,
    hash: txHash,
    network: chainKey,
    ...(displayTitle ? { displayTitle } : {}),
    ...(displaySubtitle ? { displaySubtitle } : {}),
  };
}

export async function fetchStellarHistory(
  address: string,
  chainKey: string,
  cursor: string | undefined,
  limit: number
): Promise<{ transactions: TransactionRecord[]; nextCursor: string | null; hasMore: boolean }> {
  const horizonUrl =
    chainKey === 'stellar'
      ? 'https://horizon.stellar.org'
      : 'https://horizon-testnet.stellar.org';

  const collected: TransactionRecord[] = [];
  let pageCursor = cursor;
  let pages = 0;
  let lastRawPagingToken: string | null = null;
  let lastPageFull = false;

  try {
    // Keep paging Horizon until we have `limit` *displayable* rows or run out of
    // ops. Raw pages often include trustlines/offers that we filter out — a
    // single page of 20 can otherwise yield an empty home list after SPP use.
    while (collected.length < limit && pages < STELLAR_MAX_HORIZON_PAGES) {
      pages += 1;
      const pageLimit = Math.max(limit, STELLAR_HORIZON_PAGE_SIZE);
      let url = `${horizonUrl}/accounts/${address}/operations?limit=${pageLimit}&order=desc`;
      if (pageCursor) {
        url += `&cursor=${encodeURIComponent(pageCursor)}`;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        if (response.status === 404 && pages === 1) {
          return { transactions: [], nextCursor: null, hasMore: false };
        }
        throw new Error(`Horizon API error: ${response.status}`);
      }

      const data = (await response.json()) as {
        _embedded?: { records?: Record<string, unknown>[] };
      };
      const records = data._embedded?.records || [];
      lastPageFull = records.length === pageLimit;

      if (records.length === 0) {
        lastPageFull = false;
        break;
      }

      lastRawPagingToken = String(records[records.length - 1]?.paging_token || '');
      pageCursor = lastRawPagingToken || undefined;

      for (const record of records) {
        const mapped = mapStellarOperationToTransaction(record, address, chainKey);
        if (mapped) {
          collected.push(mapped);
          if (collected.length >= limit) break;
        }
      }

      if (!lastPageFull) break;
    }

    const hasMore = lastPageFull;
    const nextCursor = hasMore && lastRawPagingToken ? lastRawPagingToken : null;

    return {
      transactions: collected.slice(0, limit),
      nextCursor,
      hasMore,
    };
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError';
    if (!isAbort) {
      captureError(error instanceof Error ? error : new Error('Stellar Indexer failed'), {
        chain: chainKey,
      });
    }
    // If we already collected rows from earlier pages, return them rather than wiping.
    if (collected.length > 0) {
      return {
        transactions: collected.slice(0, limit),
        nextCursor: lastRawPagingToken,
        hasMore: true,
      };
    }
    return { transactions: [], nextCursor: null, hasMore: false };
  }
}
