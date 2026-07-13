import { config } from '../config';

export interface GoldrushTxResponse {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  /** Human-readable amount (invoice units), never raw base units when decimals known. */
  amount: string;
  tokenSymbol: string;
  blockNumber: number;
  /** Optional token contract / mint when present on the Transfer log. */
  tokenAddress?: string;
}

/** Thrown when Goldrush cannot be used (missing key, unsupported chain, HTTP error). */
export class GoldrushError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoldrushError';
  }
}

/**
 * Covalent / GoldRush chain slugs. Only chains we actually product-support are
 * listed; unknown keys fail closed rather than probing a guess slug.
 * @see https://goldrush.dev/docs/networks
 */
const CHAIN_SLUGS: Record<string, string> = {
  ethereum: 'eth-mainnet',
  sepolia: 'eth-sepolia',
  polygon: 'matic-mainnet',
  arbitrum: 'arbitrum-mainnet',
  optimism: 'optimism-mainnet',
  base: 'base-mainnet',
  bsc: 'bsc-mainnet',
  solana: 'solana-mainnet',
  // Stellar is not a GoldRush chain slug today — callers get a clear error.
};

/** Native asset decimals for base-unit → human conversion. */
const NATIVE_DECIMALS: Record<string, number> = {
  ethereum: 18,
  sepolia: 18,
  polygon: 18,
  arbitrum: 18,
  optimism: 18,
  base: 18,
  bsc: 18,
  solana: 9,
  'solana-devnet': 9,
  stellar: 7,
  'stellar-testnet': 7,
};

/** Native ticker used when gas_metadata is missing (avoids symbolsMatch vs "NATIVE"). */
const NATIVE_SYMBOL: Record<string, string> = {
  ethereum: 'ETH',
  sepolia: 'ETH',
  polygon: 'MATIC',
  arbitrum: 'ETH',
  optimism: 'ETH',
  base: 'ETH',
  bsc: 'BNB',
  solana: 'SOL',
  'solana-devnet': 'SOL',
  stellar: 'XLM',
  'stellar-testnet': 'XLM',
};

export function goldrushChainSlug(chainKey: string): string | null {
  return CHAIN_SLUGS[chainKey.trim().toLowerCase()] ?? null;
}

export function nativeSymbolForChain(chainKey: string): string {
  return NATIVE_SYMBOL[chainKey.trim().toLowerCase()] ?? 'NATIVE';
}

/**
 * Convert integer base units to a human decimal string.
 * Exported for unit tests.
 */
export function baseUnitsToHuman(raw: string, decimals: number): string {
  const cleaned = String(raw ?? '').trim();
  if (!cleaned || cleaned === '0') return '0';
  // Already human (has a decimal point) — do not re-scale.
  if (cleaned.includes('.')) return cleaned;
  if (!/^-?\d+$/.test(cleaned)) return cleaned;
  if (!Number.isFinite(decimals) || decimals <= 0) return cleaned.replace(/^0+(?=\d)/, '') || '0';

  const negative = cleaned.startsWith('-');
  const digits = (negative ? cleaned.slice(1) : cleaned).replace(/^0+(?=\d)/, '') || '0';
  const padded = digits.padStart(decimals + 1, '0');
  const whole = padded.slice(0, padded.length - decimals);
  const frac = padded.slice(padded.length - decimals).replace(/0+$/, '');
  const out = frac ? `${whole}.${frac}` : whole;
  return negative && out !== '0' ? `-${out}` : out;
}

interface CovalentTxItem {
  tx_hash?: string;
  from_address?: string;
  to_address?: string;
  value?: string | number | null;
  block_height?: number;
  successful?: boolean;
  log_events?: Array<{
    sender_address?: string;
    sender_contract_ticker_symbol?: string;
    sender_contract_decimals?: number;
    decoded?: {
      name?: string;
      params?: Array<{ name?: string; value?: unknown }>;
    };
  }>;
  gas_metadata?: { contract_ticker_symbol?: string };
}

/**
 * Fetch recent transactions for an address via GoldRush (Covalent) transactions_v3.
 *
 * Fail-closed:
 * - missing API key → empty list (dev/indexer quiet); verifiers should treat as unavailable
 * - unsupported chain → throws GoldrushError
 * - HTTP / parse failure → throws GoldrushError
 *
 * Only **credits to `address`** are returned (native `to_address` or Transfer `to`).
 * Token amounts are converted from base units using `sender_contract_decimals` when present.
 */
export async function fetchGoldrushTransactions(
  chainKey: string,
  address: string
): Promise<GoldrushTxResponse[]> {
  if (!config.rpc.goldrushApiKey) {
    return [];
  }

  const slug = goldrushChainSlug(chainKey);
  if (!slug) {
    throw new GoldrushError(
      `GoldRush does not support chain "${chainKey}" — configure a chain-specific verifier`
    );
  }

  const url =
    `https://api.covalenthq.com/v1/${encodeURIComponent(slug)}` +
    `/address/${encodeURIComponent(address)}/transactions_v3/`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.rpc.goldrushApiKey}`,
        Accept: 'application/json',
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new GoldrushError(`GoldRush network error: ${msg}`);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new GoldrushError(
      `GoldRush HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`
    );
  }

  const json = (await response.json()) as {
    data?: { items?: CovalentTxItem[] };
    error?: boolean;
    error_message?: string;
  };

  if (json.error) {
    throw new GoldrushError(json.error_message || 'GoldRush API returned error');
  }

  const items = json.data?.items ?? [];
  const out: GoldrushTxResponse[] = [];
  const watched = address.trim();

  for (const item of items) {
    if (item.successful === false) continue;
    const txHash = item.tx_hash?.trim();
    if (!txHash) continue;

    const fromAddress = (item.from_address || '').trim();
    const toAddress = (item.to_address || '').trim();
    const blockNumber = Number(item.block_height ?? 0);

    const tokenTransfers = extractTokenTransfers(
      item,
      fromAddress,
      toAddress,
      txHash,
      blockNumber,
      watched
    );
    if (tokenTransfers.length > 0) {
      out.push(...tokenTransfers);
      continue;
    }

    // Native transfer: only credits to the watched payment address.
    if (toAddress && addressesEqual(toAddress, watched)) {
      const decimals = NATIVE_DECIMALS[chainKey.trim().toLowerCase()] ?? 0;
      out.push({
        txHash,
        fromAddress,
        toAddress,
        amount: baseUnitsToHuman(stringifyAmount(item.value), decimals),
        tokenSymbol: (
          item.gas_metadata?.contract_ticker_symbol || nativeSymbolForChain(chainKey)
        ).toUpperCase(),
        blockNumber,
      });
    }
  }

  return out;
}

/**
 * Case-insensitive address equality (EVM hex and base58/strkey safe).
 */
export function addressesEqual(a: string, b: string): boolean {
  return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
}

function extractTokenTransfers(
  item: CovalentTxItem,
  fallbackFrom: string,
  fallbackTo: string,
  txHash: string,
  blockNumber: number,
  watchedAddress: string
): GoldrushTxResponse[] {
  const logs = item.log_events ?? [];
  const results: GoldrushTxResponse[] = [];

  for (const log of logs) {
    if (log.decoded?.name !== 'Transfer') continue;
    const params = log.decoded.params ?? [];
    const toParam = params.find((p) => (p.name || '').toLowerCase() === 'to');
    const fromParam = params.find((p) => (p.name || '').toLowerCase() === 'from');
    const valueParam = params.find(
      (p) => (p.name || '').toLowerCase() === 'value' || (p.name || '').toLowerCase() === 'amount'
    );

    const toAddress = String(toParam?.value ?? fallbackTo).trim();
    const fromAddress = String(fromParam?.value ?? fallbackFrom).trim();
    if (!toAddress) continue;

    // Only credit legs to the invoice payment address (prevents false-confirm
    // on multi-leg txs that also move the same amount to someone else).
    if (!addressesEqual(toAddress, watchedAddress)) continue;

    const decimals =
      typeof log.sender_contract_decimals === 'number' && log.sender_contract_decimals >= 0
        ? log.sender_contract_decimals
        : 0;

    results.push({
      txHash,
      fromAddress,
      toAddress,
      amount: baseUnitsToHuman(stringifyAmount(valueParam?.value), decimals),
      tokenSymbol: (log.sender_contract_ticker_symbol || 'UNKNOWN').toUpperCase(),
      blockNumber,
      tokenAddress: log.sender_address?.trim() || undefined,
    });
  }

  return results;
}

function stringifyAmount(value: unknown): string {
  if (value === null || value === undefined) return '0';
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Avoid scientific notation for integer-ish values.
    if (Number.isInteger(value)) return String(value);
    return String(value);
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') return value.toString();
  return String(value);
}
