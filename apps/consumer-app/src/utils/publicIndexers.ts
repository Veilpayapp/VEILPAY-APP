import { formatEther } from 'viem';
import { Connection, PublicKey } from '@solana/web3.js';
import type { TransactionRecord } from '../types/transactions';
import { captureError } from './sentry';

const REQUEST_TIMEOUT_MS = 10000;

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

export async function fetchStellarHistory(
  address: string,
  chainKey: string,
  cursor: string | undefined,
  limit: number
): Promise<{ transactions: TransactionRecord[]; nextCursor: string | null; hasMore: boolean }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const horizonUrl = chainKey === 'stellar'
      ? 'https://horizon.stellar.org'
      : 'https://horizon-testnet.stellar.org';
      
    // Use /operations endpoint — covers payments AND create_account ops
    let url = `${horizonUrl}/accounts/${address}/operations?limit=${limit}&order=desc`;
    if (cursor) {
      url += `&cursor=${cursor}`;
    }

    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      if (response.status === 404) {
        // Account not funded yet — not an error
        return { transactions: [], nextCursor: null, hasMore: false };
      }
      throw new Error(`Horizon API error: ${response.status}`);
    }

    const data = await response.json();
    const records: any[] = data._embedded?.records || [];

    const transactions: TransactionRecord[] = records
      .map((record: any): TransactionRecord | null => {
        const opType: string = record.type || '';

        let from = '';
        let to = '';
        let amount = '0';
        let tokenSymbol = 'XLM';
        let tokenName = 'Stellar';

        if (opType === 'payment') {
          from = record.from || '';
          to = record.to || '';
          amount = record.amount || '0';
          const isNative = record.asset_type === 'native';
          tokenSymbol = isNative ? 'XLM' : (record.asset_code || 'XLM');
          tokenName = isNative ? 'Stellar' : tokenSymbol;
        } else if (opType === 'create_account') {
          from = record.funder || '';
          to = record.account || '';
          amount = record.starting_balance || '0';
        } else {
          // Skip unsupported operation types (path_payment, change_trust, etc.)
          return null;
        }

        const isSender = from.toLowerCase() === address.toLowerCase();

        return {
          id: record.id,
          type: isSender ? 'sent' : 'received',
          amount,
          token: tokenName,
          tokenSymbol,
          from: from || 'unknown',
          to: to || 'unknown',
          timestamp: new Date(record.created_at).getTime(),
          // operations endpoint doesn't have transaction_successful — check transaction_hash existence
          status: record.transaction_hash ? 'completed' : 'pending',
          hash: record.transaction_hash || record.id,
          network: chainKey,
        };
      })
      .filter((tx): tx is TransactionRecord => tx !== null);

    const hasMore = records.length === limit;
    const nextCursor = hasMore ? records[records.length - 1].paging_token : null;

    return { transactions, nextCursor, hasMore };
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError';
    if (!isAbort) {
      captureError(error instanceof Error ? error : new Error('Stellar Indexer failed'), { chain: chainKey });
    }
    return { transactions: [], nextCursor: null, hasMore: false };
  } finally {
    clearTimeout(timeoutId);
  }
}
