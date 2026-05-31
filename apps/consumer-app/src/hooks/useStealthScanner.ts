// Public inputs: [merkleRoot, nullifierHash, recipient, amount] — see design.md §Public input ordering contract
//
// useStealthScanner — Layer 4 stealth-receive polling loop.
// =========================================================
// This hook subscribes to `StealthAnnouncer.Announcement` events on the
// active EVM RPC and asks the local `stealthEngine` whether each event
// targets the device's keypair (`viewingPriv` for the ECDH step,
// `spendingPub` for stealth-address re-derivation). It is the recipient
// half of the stealth-send path that `usePaymentTransaction` triggers
// for the sender (privacy level `'stealth'`).
//
// Although this hook never builds the ZK public-signal array directly,
// it lives in the same canonical-ordering family — the privacy stack
// is one system — so we keep the canonical header on every file in
// the stack for grep-ability.
//
// Correctness invariants (Requirements 11.1–11.7):
//
//   * Cursor `lastScannedBlock` only advances on a successful poll.
//     A poll that throws (RPC error, timeout, malformed log) leaves
//     the cursor untouched, so the next successful poll re-queries
//     the same gap. This is the load-bearing rule that makes the
//     completeness property (Property 18) hold: every match is
//     observed within at most two successful polling intervals.
//   * Polling pauses on `AppState === 'background'` / `'inactive'`
//     to keep RN from burning RPC quota when the user is away, and
//     ALWAYS runs one immediate tick on resume — we don't wait for
//     the next `intervalMs` window.
//   * Mount: read the persisted cursor from SecureStore. If the
//     read returns nothing or fails, fall back to
//     `deploymentStartBlock`. SecureStore is the right place for the
//     cursor (not AsyncStorage) because the cursor is correlated
//     with this device's viewing identity; co-locating it with the
//     viewing key avoids a class of cross-device replay confusion.
//
// Integration note: Requirement 11.3 asks that matches be appended
// to "transaction history with status `'incoming_stealth'`". The
// current `TransactionRecord` / `TransactionStatus` types in
// `stores/transactionStore.ts` do not expose that variant. Per
// tasks.md §10.1 we leave the `onMatch` callback as the only escape
// hatch and document the TODO inline so the integration step in a
// later task can wire the store without touching this file again.
//
// @see ../utils/stealthEngine
// @see ../../../../packages/contracts-evm/src/StealthAnnouncer.sol
// @see Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7

import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { ethers } from 'ethers';
import type { Address, Hex } from 'viem';

import { checkStealthAddressMatch } from '../utils/stealthEngine';

/**
 * SecureStore key for the persisted polling cursor (Requirement 11.4).
 * One slot per device — multi-account scanning would key this per
 * `(activeAccountId, chainKey)` tuple, but that is out of scope for
 * the initial integration.
 */
const STORAGE_KEY = 'veilpay.stealth.lastScannedBlock';

/** Default polling interval (Requirement 11.1). */
const DEFAULT_INTERVAL_MS = 60_000;

/**
 * Minimal ABI fragment for the ERC-5564 `Announcement` event emitted
 * by `StealthAnnouncer.sol`. Matches the on-chain signature exactly:
 *
 *   event Announcement(
 *       uint256 indexed schemeId,
 *       address indexed stealthAddress,
 *       address indexed caller,
 *       bytes ephemeralPubKey,
 *       bytes metadata
 *   )
 *
 * We only need this fragment because the hook never sends transactions
 * — `queryFilter` against an event interface is sufficient.
 */
const ANNOUNCER_ABI = [
  'event Announcement(uint256 indexed schemeId, address indexed stealthAddress, address indexed caller, bytes ephemeralPubKey, bytes metadata)',
] as const;

/**
 * Payload delivered to the consumer's `onMatch` callback when an
 * `Announcement` resolves under our viewing key. All fields are taken
 * verbatim from the on-chain event so the consumer can decide how to
 * surface or persist the match.
 */
export interface StealthMatch {
  /** Block number containing the matching `Announcement` event. */
  blockNumber: number;
  /** Transaction hash that emitted the event. */
  txHash: string;
  /** EVM address derived for this stealth payment (the on-chain recipient). */
  stealthAddress: Address;
  /** Sender's compressed (33-byte) ephemeral public key, hex-encoded. */
  ephemeralPubKey: Hex;
  /** Arbitrary metadata bytes attached by the sender. */
  metadata: Hex;
}

/**
 * Configuration for {@link useStealthScanner}. The four required
 * fields (`rpcUrl`, `announcerAddress`, `viewingPriv`, `spendingPub`)
 * are the bare minimum needed to (a) talk to the EVM RPC and (b)
 * verify each event with `checkStealthAddressMatch`.
 */
export interface UseStealthScannerArgs {
  /** HTTPS JSON-RPC endpoint for the active EVM chain (Sepolia). */
  rpcUrl: string;
  /** 0x-prefixed deployed `StealthAnnouncer` contract address. */
  announcerAddress: string;
  /** Recipient's viewing-key private scalar; never leaves the device. */
  viewingPriv: Hex;
  /** Recipient's spending-key compressed public key (33-byte SEC1 hex). */
  spendingPub: Hex;
  /** Polling interval in ms. Defaults to {@link DEFAULT_INTERVAL_MS}. */
  intervalMs?: number;
  /**
   * Block height the announcer was deployed at. Used as the cursor
   * fallback when SecureStore has no persisted value yet, so we don't
   * needlessly scan from genesis on first mount. Defaults to `0`.
   */
  deploymentStartBlock?: number;
  /**
   * Invoked once per matching `Announcement` event in the order they
   * appear in the chain (block-then-logIndex). Synchronous to keep
   * the tick body uncomplicated; consumers that want to do async
   * work should schedule it themselves.
   *
   * TODO(integration): when `transactionStore` exposes an
   * `'incoming_stealth'` append API (Requirement 11.3), the scanner
   * should also push there in addition to invoking this callback.
   * Tracked in tasks.md §10.1 integration note.
   */
  onMatch?: (match: StealthMatch) => void;
}

/**
 * Reactive surface of the hook. Both fields update synchronously
 * after each successful tick; `running` reflects whether the polling
 * timer is currently armed (true while foregrounded, false in
 * background / before the initial cursor load completes).
 */
export interface UseStealthScannerResult {
  /** Cursor head; `null` until the first successful read of SecureStore. */
  lastScannedBlock: number | null;
  /** Whether the polling timer is currently armed. */
  running: boolean;
}

/**
 * React hook that polls `StealthAnnouncer.Announcement` events and
 * invokes `onMatch` for every event that targets the device's
 * stealth keypair.
 *
 * Lifecycle:
 *
 *   1. On mount, read `lastScannedBlock` from SecureStore. Fall back
 *      to `deploymentStartBlock` (default `0`) on miss / read error.
 *   2. Subscribe to `AppState`. While the app is `'active'`, the
 *      polling timer fires every `intervalMs`; while in
 *      `'background'` / `'inactive'` the timer is paused.
 *   3. On resume to `'active'`, fire one immediate tick before the
 *      next `intervalMs` window, so the user does not wait up to a
 *      full minute to see catch-up matches.
 *   4. Each tick: query Announcement logs in
 *      `[lastScannedBlock + 1, head]`, check each one with
 *      `checkStealthAddressMatch`, invoke `onMatch` for hits, then
 *      persist `lastScannedBlock = head`. On any thrown error inside
 *      the tick, log via `console.warn` and leave the cursor alone.
 */
export function useStealthScanner(args: UseStealthScannerArgs): UseStealthScannerResult {
  const {
    rpcUrl,
    announcerAddress,
    viewingPriv,
    spendingPub,
    intervalMs = DEFAULT_INTERVAL_MS,
    deploymentStartBlock = 0,
    onMatch,
  } = args;

  // The `onMatch` callback is held in a ref so callers can pass an
  // inline closure each render without tearing down the scanner.
  // The other args are stable identity-wise (URLs, addresses, hex
  // strings) and changing them is correctly modelled as "rebind to
  // a fresh scanner", so they go on the effect dep list directly.
  const onMatchRef = useRef<UseStealthScannerArgs['onMatch']>(onMatch);
  useEffect(() => {
    onMatchRef.current = onMatch;
  }, [onMatch]);

  const [lastScannedBlock, setLastScannedBlock] = useState<number | null>(null);
  const [running, setRunning] = useState(false);

  // Mutable cursor used by the tick body — `useState` value would be
  // stale across the closure, and we need read-after-write semantics
  // within a single effect lifetime.
  const cursorRef = useRef<number | null>(null);
  // Re-entrancy guard: a tick that runs longer than `intervalMs`
  // must not be overlapped by the next interval firing.
  const tickInFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timerId: ReturnType<typeof setInterval> | null = null;
    let appState: AppStateStatus = AppState.currentState;

    /**
     * One polling tick. Respects re-entrancy and the cancellation flag,
     * advances the cursor only on a fully successful poll, and never
     * crashes on RPC failure (Requirement 11.6).
     */
    async function tick(): Promise<void> {
      if (cancelled) return;
      if (tickInFlightRef.current) return;
      // Wait until the cursor has been initialised from SecureStore;
      // otherwise we'd race a phantom `null + 1 = NaN` query window.
      if (cursorRef.current === null) return;

      tickInFlightRef.current = true;
      try {
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const contract = new ethers.Contract(announcerAddress, ANNOUNCER_ABI, provider);

        const head = await provider.getBlockNumber();
        const fromBlock = (cursorRef.current ?? deploymentStartBlock) + 1;
        if (fromBlock > head) {
          // Nothing to do — the chain head has not advanced past
          // our cursor since the last poll. Don't `setItemAsync` a
          // value that hasn't changed; just succeed quietly.
          return;
        }

        const filter = contract.filters.Announcement();
        const logs = await contract.queryFilter(filter, fromBlock, head);

        for (const log of logs) {
          if (cancelled) return;
          // ethers v6 returns `EventLog` instances with parsed `args`
          // for matching ABI fragments and bare `Log` instances
          // otherwise. Skip the bare ones — they cannot have come
          // from our ABI fragment in normal operation, but defensive.
          if (!('args' in log) || log.args == null) continue;
          const evt = log as ethers.EventLog;

          // Named access on the `Result` is safer than positional
          // when the underlying ABI ever grows additional fields.
          const stealthAddress = String(evt.args.stealthAddress) as Address;
          const ephemeralPubKey = String(evt.args.ephemeralPubKey) as Hex;
          const metadata = String(evt.args.metadata) as Hex;

          let isMatch = false;
          try {
            isMatch = checkStealthAddressMatch(
              stealthAddress,
              ephemeralPubKey,
              viewingPriv,
              spendingPub,
            );
          } catch {
            // `checkStealthAddressMatch` already returns `false` on
            // its own internal failures, but we belt-and-suspender
            // here so a single corrupt event can't poison the loop.
            isMatch = false;
          }

          if (isMatch) {
            // TODO(integration, tasks.md §10.1): when
            // `transactionStore` gains an `'incoming_stealth'`
            // append API (Requirement 11.3), append here in
            // addition to firing the callback. Until then the
            // callback is the canonical surface.
            onMatchRef.current?.({
              blockNumber: evt.blockNumber,
              txHash: evt.transactionHash,
              stealthAddress,
              ephemeralPubKey,
              metadata,
            });
          }
        }

        // Persist *and* advance the cursor — both, in this order,
        // and only after the queryFilter and all per-log work
        // succeeded without throwing. If `setItemAsync` itself
        // rejects, we land in the `catch` below and the cursor
        // remains at its previous value, so the next tick re-fetches
        // and re-notifies the same window. That is acceptable
        // (Requirement 11.7 wants completeness, not exactly-once).
        await SecureStore.setItemAsync(STORAGE_KEY, String(head));
        if (cancelled) return;
        cursorRef.current = head;
        setLastScannedBlock(head);
      } catch (err) {
        // Requirement 11.6: log via `console.warn` and DO NOT
        // advance the cursor. The next tick will retry the same gap.
        console.warn('[useStealthScanner] poll failed', err);
      } finally {
        tickInFlightRef.current = false;
      }
    }

    function startTimer(): void {
      if (timerId !== null) return;
      timerId = setInterval(() => {
        void tick();
      }, intervalMs);
      setRunning(true);
    }

    function stopTimer(): void {
      if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }
      setRunning(false);
    }

    function handleAppStateChange(next: AppStateStatus): void {
      const wasInactive = appState !== 'active';
      appState = next;
      if (next === 'active') {
        // Resume from background / inactive. Fire one immediate
        // tick so the user sees catch-up matches without waiting a
        // full `intervalMs`, then arm the recurring timer.
        if (wasInactive) {
          void tick();
        }
        startTimer();
      } else {
        // 'background' or 'inactive' — stop the timer; an in-flight
        // tick is allowed to complete (we cannot cleanly abort
        // ethers' fetch in v6) and will simply persist its result.
        stopTimer();
      }
    }

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    void (async () => {
      let initial: number;
      try {
        const stored = await SecureStore.getItemAsync(STORAGE_KEY);
        if (cancelled) return;
        const parsed = stored == null ? Number.NaN : Number.parseInt(stored, 10);
        initial = Number.isFinite(parsed) && parsed >= 0 ? parsed : deploymentStartBlock;
      } catch (err) {
        // SecureStore read failure — fall back to the deployment
        // start block. Don't let the scanner stay forever inert
        // because the keychain hiccupped on app launch.
        console.warn('[useStealthScanner] failed to read lastScannedBlock', err);
        if (cancelled) return;
        initial = deploymentStartBlock;
      }

      if (cancelled) return;
      cursorRef.current = initial;
      setLastScannedBlock(initial);

      // Run one immediate tick if the app is foregrounded, then
      // arm the recurring timer. If we mounted while in background,
      // the AppState change listener will start the timer on resume.
      if (appState === 'active') {
        void tick();
        startTimer();
      }
    })();

    return () => {
      cancelled = true;
      stopTimer();
      subscription.remove();
      // Note: any in-flight `queryFilter` cannot be aborted cleanly
      // in ethers v6; the `cancelled` flag means its results are
      // silently discarded after this unmount, which is the best we
      // can do without a higher-level fetch wrapper.
    };
    // We intentionally re-run the effect when any of these inputs
    // changes, since the scanner identity (which RPC, which
    // announcer, which keypair) is meaningfully different.
    // `onMatch` is held in a ref above so that prop-identity churn
    // doesn't tear down the timer.
  }, [
    rpcUrl,
    announcerAddress,
    viewingPriv,
    spendingPub,
    intervalMs,
    deploymentStartBlock,
  ]);

  return { lastScannedBlock, running };
}
