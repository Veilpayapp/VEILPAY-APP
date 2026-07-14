/**
 * PRIV-002: local DSAR / account-wipe.
 *
 * Erases device-local account data so a user can exercise a right-to-erasure
 * request against *this install*. It does NOT contact Mixpanel/Sentry servers —
 * operators must still process cloud DSAR tickets (see docs/consumer-app/dsar.md).
 *
 * Order matters: secrets first, then session state, then telemetry identity.
 * Failures on secret clear are fatal (we refuse a partial wipe that leaves a
 * mnemonic on disk while the UI thinks the wallet is gone).
 */

import { clearStoredMnemonic } from './transactions';
import { deleteAnalyticsData } from './analytics';
import { useWalletStore } from '../stores/walletStore';
import { useTransactionStore } from '../stores/transactionStore';
import { useAddressBookStore } from '../stores/addressBookStore';

export interface AccountWipeResult {
  ok: true;
  steps: string[];
}

export interface AccountWipeFailure {
  ok: false;
  failedStep: string;
  error: unknown;
  completedSteps: string[];
}

export type AccountWipeOutcome = AccountWipeResult | AccountWipeFailure;

/**
 * Wipe local wallet secrets + session + analytics identity.
 * Call only after explicit user confirmation (and preferably biometric auth).
 */
export async function wipeLocalAccountData(): Promise<AccountWipeOutcome> {
  const completed: string[] = [];

  try {
    await clearStoredMnemonic();
    completed.push('mnemonic');
  } catch (error) {
    return { ok: false, failedStep: 'mnemonic', error, completedSteps: completed };
  }

  try {
    useWalletStore.getState().clearWallet();
    useWalletStore.getState().disconnect();
    completed.push('wallet_session');
  } catch (error) {
    return { ok: false, failedStep: 'wallet_session', error, completedSteps: completed };
  }

  try {
    useTransactionStore.getState().clearTransactions();
    completed.push('transactions');
  } catch (error) {
    return { ok: false, failedStep: 'transactions', error, completedSteps: completed };
  }

  try {
    useAddressBookStore.getState().clearAddresses();
    completed.push('address_book');
  } catch (error) {
    return { ok: false, failedStep: 'address_book', error, completedSteps: completed };
  }

  try {
    deleteAnalyticsData();
    completed.push('analytics');
  } catch (error) {
    return { ok: false, failedStep: 'analytics', error, completedSteps: completed };
  }

  return { ok: true, steps: completed };
}
