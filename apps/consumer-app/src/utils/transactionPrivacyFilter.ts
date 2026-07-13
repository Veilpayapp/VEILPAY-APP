/**
 * Home / history privacy-mode list filtering.
 *
 * Private mode: **only** reconstructed clean SPP activity
 * (`createSppActivityRecord` — shield / transfer / unshield summaries).
 * Never raw Horizon contract spam.
 *
 * Public mode: Freighter-style chain history (including SPP pool/verifier
 * contract invokes from Horizon). Hide private reconstructed pool rows so
 * they don't double-label the same shield/unshield.
 */
import type { TransactionRecord } from '../types/transactions';
import { isSppActivityRecord } from './stellarSpp/sppActivity';

export function filterTransactionsForPrivacyMode(
  transactions: TransactionRecord[],
  opts: {
    privacyMode: boolean;
    /** When set, only include private rows for this chain (e.g. stellar-testnet). */
    privacyChainKey?: string | null;
    /** Public mode: optionally restrict to active chain. */
    publicChainKey?: string | null;
  }
): TransactionRecord[] {
  const { privacyMode, privacyChainKey, publicChainKey } = opts;

  if (privacyMode) {
    return transactions.filter((tx) => {
      // Clean reconstructed activity only — no freighter/raw contract rows.
      if (!isSppActivityRecord(tx)) return false;
      if (!privacyChainKey) return true;
      // Match chain when recorded; allow missing network on older local rows.
      if (!tx.network) return true;
      return tx.network === privacyChainKey;
    });
  }

  // Public: Freighter-style chain rows; exclude private reconstructed summaries.
  return transactions.filter((tx) => {
    if (isSppActivityRecord(tx)) {
      return false;
    }
    if (publicChainKey && tx.network && tx.network !== publicChainKey) {
      return false;
    }
    return true;
  });
}
