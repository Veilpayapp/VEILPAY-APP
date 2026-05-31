/**
 * Veilpay Transaction Status Poller
 *
 * After a transaction is broadcast, this module polls for on-chain confirmation
 * and updates the wallet store with the final status. This ensures the user
 * sees the transaction in their history immediately, even before the backend
 * indexer picks it up.
 *
 * Key features:
 * - Adds a "pending" transaction record to the store immediately after broadcast
 * - Polls for receipt using exponential backoff (2s → 4s → 6s → 8s, max 8s)
 * - Updates the record to "completed" or "failed" once confirmed
 * - Timeout after 120s with "pending" status preserved (not marked failed)
 * - Cleans up polling on unmount via AbortController
 */

import type { TransactionRecord, TransactionStatus } from '../types/transactions';
import { waitForTransaction } from './transactions';
import { captureError, captureMessage } from './sentry';
import { useWalletStore } from '../stores/walletStore';
import { useTransactionStore, useTransactions } from '../stores/transactionStore';

// ── Configuration ──────────────────────────────────────────────────────────

const INITIAL_POLL_INTERVAL_MS = 2_000;
const MAX_POLL_INTERVAL_MS = 8_000;
const BACKOFF_MULTIPLIER = 1.5;
const MAX_POLL_DURATION_MS = 120_000;
const REQUIRED_CONFIRMATIONS = 1;

// ── Types ──────────────────────────────────────────────────────────────────

export interface PollOptions {
  /** Chain key used for RPC calls (e.g. 'ethereum', 'polygon') */
  chainKey: string;
  /** Transaction hash returned by broadcast */
  txHash: string;
  /** Sender address (current wallet) */
  fromAddress: string;
  /** Recipient address */
  toAddress: string;
  /** Amount in ETH (human-readable string) */
  amountEth: string;
  /** Token symbol, e.g. 'ETH' */
  tokenSymbol: string;
  /** Network name for the record, e.g. 'Ethereum' */
  networkName?: string;
  /** Privacy level if applicable */
  privacyLevel?: 'standard' | 'max';
  /** Gas fee in ETH if known */
  feeEth?: string;
  /** AbortSignal to cancel polling (e.g. on component unmount) */
  signal?: AbortSignal;
  /** Callback when the tx status changes */
  onStatusChange?: (status: TransactionStatus, record: TransactionRecord) => void;
}

export interface PollResult {
  /** Final status of the transaction */
  status: TransactionStatus;
  /** The transaction record as stored in the wallet */
  record: TransactionRecord;
  /** Whether polling timed out before getting a receipt */
  timedOut: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function buildPendingRecord(opts: PollOptions): TransactionRecord {
  return {
    id: opts.txHash,
    type: 'sent',
    amount: opts.amountEth,
    token: opts.tokenSymbol,
    tokenSymbol: opts.tokenSymbol,
    from: opts.fromAddress,
    to: opts.toAddress,
    timestamp: Date.now(),
    status: 'pending',
    hash: opts.txHash,
    privacyLevel: opts.privacyLevel,
    fee: opts.feeEth,
    network: opts.networkName || opts.chainKey,
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);

    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      if (signal.aborted) {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

// ── Main poller ────────────────────────────────────────────────────────────

/**
 * Starts polling for a transaction receipt after broadcast.
 *
 * 1. Immediately adds a "pending" record to the wallet store.
 * 2. Polls `waitForTransaction` with exponential backoff.
 * 3. Updates the store record when the receipt arrives.
 * 4. Returns the final result.
 *
 * Callers should pass an AbortSignal tied to component lifecycle
 * to avoid leaking timers after unmount.
 */
export async function pollTransactionStatus(opts: PollOptions): Promise<PollResult> {
  const { signal } = opts;

  // 1. Add pending record to store immediately
  const pendingRecord = buildPendingRecord(opts);
  useTransactionStore.getState().addTransaction(pendingRecord);

  const startTime = Date.now();
  let interval = INITIAL_POLL_INTERVAL_MS;

  // 2. Poll loop
  while (Date.now() - startTime < MAX_POLL_DURATION_MS) {
    // Check abort before each iteration
    if (signal?.aborted) {
      return { status: 'pending', record: pendingRecord, timedOut: true };
    }

    try {
      await sleep(interval, signal);
    } catch (err) {
      // Aborted during sleep
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { status: 'pending', record: pendingRecord, timedOut: true };
      }
      throw err;
    }

    // Check abort after sleep
    if (signal?.aborted) {
      return { status: 'pending', record: pendingRecord, timedOut: true };
    }

    try {
      const result = await waitForTransaction(opts.txHash, opts.chainKey, REQUIRED_CONFIRMATIONS);

      if (result.status === 'confirmed' || result.status === 'failed') {
        const finalStatus: TransactionStatus = result.status === 'confirmed' ? 'completed' : 'failed';
        const finalRecord: TransactionRecord = {
          ...pendingRecord,
          status: finalStatus,
          fee: result.gasUsed ?? pendingRecord.fee,
        };

        // Update the store: add the confirmed/failed version (dedup by id=txHash)
        useTransactionStore.getState().addTransaction(finalRecord);

        opts.onStatusChange?.(finalStatus, finalRecord);

        return { status: finalStatus, record: finalRecord, timedOut: false };
      }
    } catch (err) {
      // Transient RPC error — log and continue polling
      captureMessage(
        `[tx-poller] RPC error polling ${opts.txHash.slice(0, 10)}… on ${opts.chainKey}: ${err instanceof Error ? err.message : String(err)}`,
        'warning'
      );
    }

    // Exponential backoff
    interval = Math.min(interval * BACKOFF_MULTIPLIER, MAX_POLL_INTERVAL_MS);
  }

  // 3. Timeout — keep as "pending" (not "failed") since the tx may still confirm
  captureMessage(
    `[tx-poller] Timeout polling ${opts.txHash.slice(0, 10)}… on ${opts.chainKey} after ${MAX_POLL_DURATION_MS / 1000}s`,
    'warning'
  );

  return { status: 'pending', record: pendingRecord, timedOut: true };
}

/**
 * Convenience: creates an AbortController for use with pollTransactionStatus.
 * The caller is responsible for calling controller.abort() on unmount.
 */
export function createPollAbortController(): AbortController {
  return new AbortController();
}
