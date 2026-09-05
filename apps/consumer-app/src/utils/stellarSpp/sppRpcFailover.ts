/**
 * Soroban RPC failover for pool_sync.
 *
 * CORE PROBLEM: The native pool_sync uses a separate Rust HTTP/DNS stack from
 * JS. When that stack cannot resolve the RPC, JS preflight can still pass and
 * the native indexer can retry the same failure for minutes.
 *
 * FIX: Preflight the RPC(s) with a simple getLatestLedger call BEFORE opening
 * the pool session or running the native sync. This detects a dead/slow RPC in
 * ~5 seconds (not 8-9 minutes). Only open the pool session on a known-working
 * RPC.
 *
 * The native SDK now owns a total sync deadline (30s testnet / 90s mainnet),
 * and the bridge keeps a ceiling for older .so files. This avoids abandoning a
 * live Rust call from JS while still preventing an unbounded mobile spinner.
 *
 * The resolver/deadline changes live in the shipped native SDK; OTA alone is
 * not enough for an already-installed APK. No contract redeployment is needed.
 */

import {
  assertSppEnabled,
  getSppFallbackRpcUrl,
  type SppDeploymentConfig,
} from '../../constants/spp';
import { recordSppDiagnostic } from './sppDiagnostics';
import {
  sppNativePoolClose,
  sppNativePoolSync,
  type SppNativeOpResult,
} from './sppNativeBridge';
import { ensurePoolSession } from './sppPoolSession';
import { formatSppSyncUserMessage } from './sppSyncMessages';

// ---------------------------------------------------------------------------
// Timeouts
// ---------------------------------------------------------------------------

/** Max time to wait for a simple RPC health check (getLatestLedger). */
const RPC_PREFLIGHT_TIMEOUT_MS = 8_000;

/** Max time to wait for the native pool_open to complete. */
const SESSION_OPEN_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SppRpcFailoverResult = {
  ok: boolean;
  message?: string;
  /** True when the fallback RPC was used and the retry succeeded. */
  usedFallback?: boolean;
  /** The original primary-RPC error, preserved when fallback was attempted. */
  primaryError?: string;
  /** Error from the fallback RPC attempt, if it also failed. */
  fallbackError?: string;
  /** Raw error from the primary sync attempt. */
  rawError?: string;
  /** Result from the underlying pool_sync (for diagnostics). */
  syncResult?: SppNativeOpResult;
  /** The RPC URL that was actually used (useful for diagnostics). */
  selectedRpcUrl?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class TimeoutError extends Error {
  constructor(operation: string, ms: number) {
    super(`${operation} timed out after ${ms / 1000}s`);
    this.name = 'TimeoutError';
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  operation: string,
  ms: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new TimeoutError(operation, ms)), ms);
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
  return result;
}

/**
 * True when the message is a network/connection error (DNS failure, connection
 * refused, timeout, etc.). Must NOT match RPC retention gaps, contract errors,
 * or other non-network failures.
 */
export function isSppNetworkConnectionError(
  message: string | null | undefined,
): boolean {
  if (!message) return false;
  // The native indexer's own bounded catch-up deadline (for example:
  // `pool sync timed out (phase=catch_up, limit=90s, elapsed=90s)`) means a
  // large-but-legitimate sync simply exceeded the native time limit — NOT an
  // RPC network failure. Treating it as retryable would trigger a wasteful
  // full fallback re-sync for a healthy RPC that was just catching up. Exclude
  // those deadline messages before matching network signatures below.
  if (/(phase=|catch_up)/i.test(message)) return false;
  // The native indexer wraps slow/unreachable RPC failures in network-level
  // errors (DNS/connect/etc.). Those are retryable, so a healthy fallback RPC
  // is still attempted.
  return /dns error|failed to lookup address|client error \(Connect\)|error sending request|connect timed out|connection refused|network error|\btimed?\s*out\b|\btimeout\b/i.test(
    message,
  );
}

// ---------------------------------------------------------------------------
// RPC preflight
// ---------------------------------------------------------------------------

/**
 * Check if a Soroban RPC endpoint is alive by sending a getLatestLedger
 * request. Returns true if the RPC responds within the timeout.
 *
 * This is a simple HTTP POST to the JSON-RPC endpoint. It costs ~1-5 seconds
 * and avoids the 30s×3 retry stack in the native pool_open/pool_sync.
 */
async function preflightRpc(rpcUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RPC_PREFLIGHT_TIMEOUT_MS);

    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getLatestLedger',
        params: {},
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) return false;

    const body = await response.text();
    const parsed = JSON.parse(body);
    // A valid response has a "result" field with at least "id" (the ledger seq)
    return parsed?.result?.id !== undefined;
  } catch {
    return false;
  }
}

/**
 * Select the best RPC URL by preflighting the primary and (if available)
 * fallback. Returns the URL of the first responsive RPC, or null if none
 * respond.
 *
 * On testnet, only the primary RPC is preflighted (no fallback configured).
 * On mainnet, the primary is preflighted first; if it doesn't respond, the
 * fallback is preflighted.
 */
async function selectBestRpcUrl(
  config: SppDeploymentConfig,
): Promise<{ url: string; usedFallback: boolean } | null> {
  const primaryUrl = config.sorobanRpcUrl;

  // Preflight the primary RPC
  const primaryAlive = await preflightRpc(primaryUrl);

  if (primaryAlive) {
    void recordSppDiagnostic({
      status: 'info',
      step: 'rpc_preflight',
      operation: 'rpc_preflight',
      message: `Primary RPC responsive: ${primaryUrl}`,
    });
    return { url: primaryUrl, usedFallback: false };
  }

  // Primary is dead — try the fallback (mainnet only)
  if (config.network === 'mainnet') {
    const fallbackUrl = getSppFallbackRpcUrl(config);
    if (fallbackUrl && fallbackUrl !== primaryUrl) {
      void recordSppDiagnostic({
        status: 'info',
        step: 'rpc_preflight',
        operation: 'rpc_preflight',
        message: `Primary RPC unreachable; preflighting fallback: ${fallbackUrl}`,
      });

      const fallbackAlive = await preflightRpc(fallbackUrl);
      if (fallbackAlive) {
        void recordSppDiagnostic({
          status: 'info',
          step: 'rpc_preflight_fallback',
          operation: 'rpc_preflight',
          message: `Fallback RPC responsive: ${fallbackUrl}`,
        });
        return { url: fallbackUrl, usedFallback: true };
      }

      // Both are dead
      void recordSppDiagnostic({
        status: 'error',
        step: 'rpc_preflight',
        operation: 'rpc_preflight',
        message: `Both primary and fallback RPC unreachable. Primary: ${primaryUrl}, Fallback: ${fallbackUrl}`,
      });
      return null;
    }
  }

  // No fallback configured or testnet — primary is dead
  void recordSppDiagnostic({
    status: 'error',
    step: 'rpc_preflight',
    operation: 'rpc_preflight',
    message: `Primary RPC unreachable and no fallback available: ${primaryUrl}`,
  });
  return null;
}

// ---------------------------------------------------------------------------
// Main sync function
// ---------------------------------------------------------------------------

/**
 * Pool sync with RPC preflight and automatic failover.
 *
 * Flow:
 * 1. Preflight the primary RPC (simple getLatestLedger, 8s timeout).
 * 2. If primary is dead and mainnet + fallback configured, preflight the
 *    fallback. Use the first responsive RPC.
 * 3. If no RPC responds, return { ok: false } with a clear error immediately
 *    (no 8-9 minute wait).
 * 4. Open the pool session on the selected RPC.
 * 5. Call sppNativePoolSync — normally a few seconds on a responsive RPC, with
 *    a bounded native deadline for slow/dead endpoints.
 * 6. If sync fails with a network error on mainnet, fall through to the
 *    existing failover (close + reopen on fallback + retry).
 */
export async function syncPoolWithRpcFailover(
  chainKey: string,
  ownerAddress: string,
): Promise<SppRpcFailoverResult> {
  const config = assertSppEnabled(chainKey);

  // ---- Step 1: Preflight RPC(s) ----
  // This is the critical fix. Instead of letting the native pool_open/sync
  // retry for 8-9 minutes on a dead RPC, we detect it in ~5 seconds.
  const selected = await selectBestRpcUrl(config);
  if (!selected) {
    const msg =
      config.network === 'mainnet'
        ? 'Private network unavailable — could not reach any Soroban RPC endpoint. Check your connection and try again.'
        : 'Private network unavailable — Soroban testnet RPC is not responding. Check your connection and try again.';
    return {
      ok: false,
      message: msg,
      rawError: 'All RPC endpoints unreachable (preflight failed)',
    };
  }

  // ---- Step 2: Open pool session on the selected RPC ----
  let opened: SppNativeOpResult;
  const openOptions = selected.usedFallback
    ? { rpcUrl: selected.url }
    : undefined;

  try {
    opened = await withTimeout(
      openOptions
        ? ensurePoolSession(chainKey, ownerAddress, openOptions)
        : ensurePoolSession(chainKey, ownerAddress),
      'pool_open',
      SESSION_OPEN_TIMEOUT_MS,
    );
  } catch (e) {
    const msg = e instanceof TimeoutError ? e.message : 'Pool session open failed';
    return {
      ok: false,
      message: formatSppSyncUserMessage(msg),
      rawError: msg,
      usedFallback: selected.usedFallback,
      selectedRpcUrl: selected.url,
    };
  }
  if (!opened.ok) {
    return {
      ok: false,
      message: formatSppSyncUserMessage(
        opened.message || 'Pool session open failed',
      ),
      rawError: opened.message,
      usedFallback: selected.usedFallback,
      selectedRpcUrl: selected.url,
    };
  }

  // ---- Step 3: Sync (bounded in native SDK) ----
  // The SDK owns the total timeout so cancellation happens inside the Rust
  // future rather than abandoning a blocking call from JS.
  let sync: SppNativeOpResult;
  try {
    sync = await sppNativePoolSync();
  } catch (e) {
    return {
      ok: false,
      message: formatSppSyncUserMessage(
        e instanceof Error ? e.message : 'Pool sync failed',
      ),
      rawError: e instanceof Error ? e.message : String(e),
      usedFallback: selected.usedFallback,
      selectedRpcUrl: selected.url,
    };
  }
  if (sync.ok) {
    return { ok: true, usedFallback: selected.usedFallback, syncResult: sync, selectedRpcUrl: selected.url };
  }

  // ---- Step 4: Non-network error → no fallback ----
  if (!isSppNetworkConnectionError(sync.message)) {
    return {
      ok: false,
      message: formatSppSyncUserMessage(sync.message || 'Pool sync failed'),
      rawError: sync.message,
      syncResult: sync,
      usedFallback: selected.usedFallback,
      selectedRpcUrl: selected.url,
    };
  }

  // ---- Step 5: Network error on testnet → no fallback ----
  if (config.network !== 'mainnet') {
    return {
      ok: false,
      message: formatSppSyncUserMessage(
        sync.message ||
          'Pool sync failed (network error, no fallback for testnet)',
      ),
      rawError: sync.message,
      syncResult: sync,
      usedFallback: selected.usedFallback,
      selectedRpcUrl: selected.url,
    };
  }

  // ---- Step 6: Network error on mainnet → attempt RPC failover ----
  // (This is the fallback-after-sync-failed path, NOT the preflight above.
  //  The preflight already checked the RPC was alive, but the sync might
  //  still fail midway due to a transient network issue.)
  const fallbackUrl = getSppFallbackRpcUrl(config);
  if (
    selected.usedFallback ||
    !fallbackUrl ||
    fallbackUrl === config.sorobanRpcUrl
  ) {
    // Already on the fallback, or no fallback configured — give up.
    return {
      ok: false,
      message: formatSppSyncUserMessage(
        sync.message || 'Pool sync failed',
      ),
      rawError: sync.message,
      syncResult: sync,
      selectedRpcUrl: selected.url,
      usedFallback: selected.usedFallback,
    };
  }

  // Record the failover attempt in diagnostics.
  void recordSppDiagnostic({
    status: 'info',
    step: 'pool_sync_failover',
    operation: 'pool_sync_failover',
    chainKey,
    contractId: config.poolId,
    message: `Sync failed on preflighted primary; attempting failover: ${fallbackUrl}. Error: ${sync.message || '(none)'}`,
  });

  // 6a. Close the primary session.
  await sppNativePoolClose().catch(() => {});

  // 6b. Reopen with the fallback RPC.
  let fallbackOpened: SppNativeOpResult;
  try {
    fallbackOpened = await withTimeout(
      ensurePoolSession(chainKey, ownerAddress, { rpcUrl: fallbackUrl }),
      'pool_open_fallback',
      SESSION_OPEN_TIMEOUT_MS,
    );
  } catch (e) {
    return {
      ok: false,
      message: formatSppSyncUserMessage(
        sync.message || 'Pool sync failed (fallback open timed out)',
      ),
      primaryError: sync.message,
      fallbackError: e instanceof TimeoutError ? e.message : 'Fallback pool open failed',
      rawError: sync.message,
      usedFallback: true,
      syncResult: sync,
    };
  }
  if (!fallbackOpened.ok) {
    return {
      ok: false,
      message: formatSppSyncUserMessage(
        sync.message || 'Pool sync failed (fallback open also failed)',
      ),
      primaryError: sync.message,
      fallbackError: fallbackOpened.message || 'Fallback pool open failed',
      rawError: sync.message,
      usedFallback: true,
      syncResult: sync,
    };
  }

  // 6c. Retry sync on the fallback RPC; the native SDK still owns the total
  //     deadline for this attempt.
  let fallbackSync: SppNativeOpResult;
  try {
    fallbackSync = await sppNativePoolSync();
  } catch (e) {
    return {
      ok: false,
      message: formatSppSyncUserMessage(
        sync.message || 'Pool sync failed (fallback sync threw)',
      ),
      primaryError: sync.message,
      fallbackError: e instanceof Error ? e.message : 'Fallback sync failed',
      rawError: sync.message,
      usedFallback: true,
      syncResult: sync,
    };
  }
  if (fallbackSync.ok) {
    return {
      ok: true,
      usedFallback: true,
      syncResult: fallbackSync,
      selectedRpcUrl: fallbackUrl,
    };
  }

  // 6d. Fallback also failed — report the original primary error.
  return {
    ok: false,
    message: formatSppSyncUserMessage(
      sync.message || 'Pool sync failed (primary + fallback)',
    ),
    primaryError: sync.message,
    fallbackError: fallbackSync.message || 'Fallback sync failed',
    rawError: sync.message,
    usedFallback: true,
    syncResult: fallbackSync,
  };
}
