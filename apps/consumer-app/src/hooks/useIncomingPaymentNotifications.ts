// useIncomingPaymentNotifications — Tier 1 on-device received-payment alerts.
// =========================================================================
// This hook is the always-mounted, foreground detector for STANDARD
// (non-private) incoming transfers. It watches the device's own
// `transactionStore`, and whenever a newly-seen `type: 'received'`
// record appears it fires a local notification via the injected
// `sendLocalNotification` (from `usePushNotifications`, which already
// no-ops in Expo Go).
//
// Why local + on-device (Tier 1):
//   Stealth / max-privacy receives can only ever be detected on-device —
//   the viewing key never leaves the phone — so a backend fundamentally
//   cannot know a private payment arrived without breaking the privacy
//   model. Local detection + local notification is therefore the correct
//   mechanism for the common case (app open / foregrounded). True
//   background push for app-fully-closed standard receives and merchant
//   invoices is a separate "Tier 2" and is intentionally NOT built here.
//
// Deferred: stealth-receive notifications.
//   `useStealthScanner` is the recipient half of the stealth path and can
//   surface private receives through its `onMatch` callback. It is NOT
//   wired here yet, for two concrete reasons:
//     1. There is no persisted device stealth identity — nothing calls
//        `generateStealthKeyPair()` and no viewing/spending keypair is
//        stored, so the scanner would have no `viewingPriv`/`spendingPub`
//        to scan under.
//     2. `StealthAnnouncer` is the zero address in
//        `deployments/sepolia.json` (`isPrivacyStackConfigured() === false`),
//        so there is nothing on-chain to scan until a real deployment lands.
//   When both are resolved, mount `useStealthScanner` (gated on
//   `notificationsEnabled` + a connected wallet + `isPrivacyStackConfigured()`)
//   and route its `onMatch` to the same `sendLocalNotification` used here.
//
// Detection model (mirrors useStealthScanner's lifecycle rules):
//   * A poll tick calls `transactionStore.refreshTransactions()` so we
//     pick up receives regardless of which screen is open (Home already
//     auto-refreshes, but the user may be elsewhere). The store change
//     then flows into `evaluate()` via the store subscription.
//   * Polling pauses while the app is backgrounded/inactive and runs one
//     immediate catch-up tick on resume — we don't wait a full interval.
//   * De-dupe is persisted per-address in SecureStore so the same tx never
//     notifies twice, and existing history never notifies on first run
//     (baseline seeding).

import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { useTransactionStore } from '../stores/transactionStore';
import type { TransactionRecord } from '../types/transactions';
import { createTransactionLink } from '../utils/deepLinking';

/** Poll cadence — matches `useBalance`'s 30s background refresh. */
const DEFAULT_INTERVAL_MS = 30_000;

/**
 * Cap on the number of seen tx hashes we persist per address. Received
 * history is naturally bounded (the store persists ~50 records), so 200
 * comfortably covers the window while keeping the SecureStore blob small.
 */
const MAX_SEEN_HASHES = 200;

/** SecureStore key for the per-address seen-hash set. */
function seenStorageKey(address: string): string {
  return `veilpay.notifications.seenReceivedTx.${address.toLowerCase()}`;
}

/**
 * The subset of `usePushNotifications`' surface this hook needs. Kept
 * structural (rather than importing the hook's return type) so the
 * dependency is one-directional and trivially mockable in tests.
 */
export type SendLocalNotification = (
  title: string,
  body: string,
  data?: Record<string, unknown>,
) => void | Promise<void>;

export interface UseIncomingPaymentNotificationsArgs {
  /** Active wallet address; the watcher is inert without one. */
  address: string | null | undefined;
  /** Whether a wallet is connected. */
  isConnected: boolean;
  /** The `notificationsEnabled` settings toggle (defaults false). */
  notificationsEnabled: boolean;
  /** Injected local-notification sender (no-ops in Expo Go). */
  notify: SendLocalNotification;
  /** Poll interval in ms. Defaults to {@link DEFAULT_INTERVAL_MS}. */
  intervalMs?: number;
}

/** A received, settled transfer is the only thing we notify on. */
function isNotifiableReceive(tx: TransactionRecord): boolean {
  return tx.type === 'received' && tx.status === 'completed';
}

/** Stable identity for a record — hash first, falling back to id. */
function txKey(tx: TransactionRecord): string {
  return (tx.hash || tx.id || '').toLowerCase();
}

/** Human-facing notification body, e.g. "You received 0.5 ETH". */
function formatBody(tx: TransactionRecord): string {
  const amount = (tx.amount ?? '').toString().trim();
  const symbol = (tx.tokenSymbol || tx.token || '').toString().trim();
  if (amount && symbol) {
    return `You received ${amount} ${symbol}`;
  }
  if (amount) {
    return `You received ${amount}`;
  }
  return 'You received a payment';
}

/**
 * Watches `transactionStore` for standard incoming transfers and fires a
 * local notification for each newly-seen received tx. Root-mount once
 * (e.g. in `App.tsx`). Safe to mount unconditionally: it fully disarms
 * when `notificationsEnabled` is false or no wallet is connected.
 */
export function useIncomingPaymentNotifications(
  args: UseIncomingPaymentNotificationsArgs,
): void {
  const {
    address,
    isConnected,
    notificationsEnabled,
    notify,
    intervalMs = DEFAULT_INTERVAL_MS,
  } = args;

  // `notify` is held in a ref so a fresh closure each render doesn't tear
  // down the polling effect (identical rationale to useStealthScanner's
  // onMatch ref).
  const notifyRef = useRef<SendLocalNotification>(notify);
  useEffect(() => {
    notifyRef.current = notify;
  }, [notify]);

  const active = Boolean(notificationsEnabled && isConnected && address);

  useEffect(() => {
    if (!active || !address) {
      return;
    }

    let cancelled = false;
    let timerId: ReturnType<typeof setInterval> | null = null;
    let appState: AppStateStatus = AppState.currentState;

    // In-memory mirror of the persisted seen-set. `null` until the initial
    // SecureStore read completes; `evaluate()` no-ops until then so we never
    // notify against an un-baselined set (which would spam existing history).
    let seen: Set<string> | null = null;
    const storageKey = seenStorageKey(address);

    async function persistSeen(): Promise<void> {
      if (!seen) return;
      // Keep only the most-recent MAX_SEEN_HASHES to bound the blob.
      const trimmed = Array.from(seen).slice(-MAX_SEEN_HASHES);
      seen = new Set(trimmed);
      try {
        await SecureStore.setItemAsync(storageKey, JSON.stringify(trimmed));
      } catch (err) {
        // Non-fatal: worst case we re-notify a tx after a cold start. We
        // never want a keychain hiccup to crash the watcher.
        console.warn('[useIncomingPaymentNotifications] failed to persist seen set', err);
      }
    }

    /**
     * Compare the current store snapshot against the seen-set and notify
     * for each new notifiable receive. Notifications fire in chain order
     * (oldest first) so a burst reads naturally in the tray.
     */
    async function evaluate(records: TransactionRecord[]): Promise<void> {
      if (cancelled || !seen) return;

      const fresh: TransactionRecord[] = [];
      for (const tx of records) {
        if (!isNotifiableReceive(tx)) continue;
        const key = txKey(tx);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        fresh.push(tx);
      }

      if (fresh.length === 0) return;

      // transactionStore keeps records newest-first; reverse so the tray
      // shows them oldest-first.
      for (const tx of fresh.reverse()) {
        if (cancelled) return;
        const hash = tx.hash || tx.id;
        try {
          await notifyRef.current('Payment received', formatBody(tx), {
            transactionHash: hash,
            deepLink: hash ? createTransactionLink(hash) : undefined,
          });
        } catch (err) {
          console.warn('[useIncomingPaymentNotifications] notify failed', err);
        }
      }

      await persistSeen();
    }

    /** One poll tick: refresh history, then let the subscription re-evaluate. */
    async function tick(): Promise<void> {
      if (cancelled) return;
      try {
        await useTransactionStore.getState().refreshTransactions();
      } catch (err) {
        // refreshTransactions already swallows its own errors into store
        // state, but guard defensively so the interval never dies.
        console.warn('[useIncomingPaymentNotifications] refresh failed', err);
      }
    }

    function startTimer(): void {
      if (timerId !== null) return;
      timerId = setInterval(() => {
        void tick();
      }, intervalMs);
    }

    function stopTimer(): void {
      if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }
    }

    function handleAppStateChange(next: AppStateStatus): void {
      const wasInactive = appState !== 'active';
      appState = next;
      if (next === 'active') {
        if (wasInactive) {
          void tick();
        }
        startTimer();
      } else {
        stopTimer();
      }
    }

    // Re-evaluate whenever the store changes (from our ticks, Home's
    // auto-refresh, or the app-foreground refresh in App.tsx).
    const unsubscribe = useTransactionStore.subscribe((state) => {
      void evaluate(state.transactions);
    });

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    // Baseline: seed the seen-set from persisted storage AND from all
    // currently-known received txs, so pre-existing history never fires a
    // notification. Only receives that appear *after* this point notify.
    void (async (): Promise<void> => {
      let initial: Set<string>;
      try {
        const stored = await SecureStore.getItemAsync(storageKey);
        if (cancelled) return;
        const parsed = stored ? (JSON.parse(stored) as unknown) : [];
        initial = new Set(
          Array.isArray(parsed) ? parsed.filter((h): h is string => typeof h === 'string') : [],
        );
      } catch (err) {
        console.warn('[useIncomingPaymentNotifications] failed to read seen set', err);
        if (cancelled) return;
        initial = new Set<string>();
      }

      // Fold in the current snapshot so existing history is baselined.
      for (const tx of useTransactionStore.getState().transactions) {
        if (isNotifiableReceive(tx)) {
          const key = txKey(tx);
          if (key) initial.add(key);
        }
      }

      if (cancelled) return;
      seen = initial;
      await persistSeen();

      // Arm polling if foregrounded; otherwise the AppState listener will
      // start it on resume.
      if (appState === 'active') {
        void tick();
        startTimer();
      }
    })();

    return (): void => {
      cancelled = true;
      stopTimer();
      subscription.remove();
      unsubscribe();
    };
  }, [active, address, intervalMs]);
}
