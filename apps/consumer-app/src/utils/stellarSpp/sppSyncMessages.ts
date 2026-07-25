/**
 * User-facing copy for SPP pool sync failures / partial recovery.
 * Keeps Home free of raw indexer jargon where possible.
 */

/** True when the message is (or wraps) a wallet-RPC retention gap. */
export function isSppRpcSyncGapMessage(message: string | null | undefined): boolean {
  if (!message) return false;
  return /RPC sync gap|RPC history gap|SPP_RPC_SYNC_GAP|oldest ledger/i.test(message);
}

/**
 * Map native/JS recovery strings to short Home / toast copy.
 * Preserves actionable detail without dumping full XDR paths.
 */
export function formatSppSyncUserMessage(
  message: string | null | undefined,
  opts?: { aspReady?: boolean }
): string {
  const raw = (message || '').trim();
  if (!raw) {
    return opts?.aspReady
      ? 'Private account ready — restoring balance…'
      : 'Setting up private account…';
  }

  if (/partial sync from ledger/i.test(raw)) {
    // Primary dogfood path — keep calm, actionable, short for the balance card.
    const m = raw.match(/ledger\s+(\d+)/i);
    const ledger = m?.[1];
    return ledger
      ? `Synced from recent history (ledger ${ledger}+). Older notes unavailable.`
      : 'Synced recent private history. Older notes unavailable without an archive.';
  }

  if (/synced via bootnode/i.test(raw)) {
    return 'Private history restored from archive';
  }

  if (isSppRpcSyncGapMessage(raw)) {
    if (/bootnode/i.test(raw) || /EXPO_PUBLIC_SPP_BOOTNODE/i.test(raw)) {
      return 'Private history unavailable — archive RPC needed (or redeploy fresher contracts)';
    }
    return 'Private history temporarily unavailable (RPC retention gap)';
  }

  // ASP path — keep concise
  if (/Bad union switch/i.test(raw)) {
    return 'Private account register failed — update the app and try again';
  }
  if (/ASP leaf ready|on-chain insert pending/i.test(raw)) {
    return raw.length > 140 ? 'Private account almost ready — finish ASP registration' : raw;
  }

  // Native pool sync network errors (reqwest / Soroban RPC unreachable)
  if (/error sending request|reqwest|network error.*url/i.test(raw)) {
    return 'Private account sync failed — check your internet connection or Soroban RPC endpoint';
  }

  // Account not funded on-chain
  if (/Could not load account/i.test(raw)) {
    if (/mainnet|public network/i.test(raw)) {
      return 'Stellar account not funded — send at least 2 XLM to activate private payments';
    }
    return 'Stellar account not funded — use the testnet faucet to activate';
  }

  return raw.length > 160 ? `${raw.slice(0, 157)}…` : raw;
}
