/**
 * Home / history privacy-mode list filtering.
 *
 * Private mode: only local SPP pool activity (shield / transfer / unshield).
 * Public mode: hide private-pool rows so normal chain history stays clean.
 * (Horizon also omits SPP infrastructure invokes — see publicIndexers.)
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
      if (!isSppActivityRecord(tx) && tx.privacyLevel !== 'private') {
        return false;
      }
      // Prefer isPrivatePoolTx / sppOp; also accept privacyLevel private.
      const isPrivate =
        isSppActivityRecord(tx) ||
        tx.privacyLevel === 'private' ||
        tx.tokenSymbol === 'pXLM';
      if (!isPrivate) return false;
      if (!privacyChainKey) return true;
      // Match chain when recorded; allow missing network on older local rows.
      if (!tx.network) return true;
      return tx.network === privacyChainKey;
    });
  }

  // Public: exclude private pool rows.
  return transactions.filter((tx) => {
    if (isSppActivityRecord(tx) || tx.privacyLevel === 'private') {
      return false;
    }
    if (publicChainKey && tx.network && tx.network !== publicChainKey) {
      return false;
    }
    return true;
  });
}
