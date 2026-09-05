/**
 * User-facing copy for SPP pool sync failures / partial recovery.
 * Keeps Home free of raw indexer jargon where possible.
 */

/** True when the message is (or wraps) a wallet-RPC retention gap. */
export function isSppRpcSyncGapMessage(
  message: string | null | undefined,
): boolean {
  if (!message) return false;
  return /RPC sync gap|RPC history gap|SPP_RPC_SYNC_GAP|oldest ledger/i.test(
    message,
  );
}

/**
 * Map native/JS recovery strings to short Home / toast copy.
 * Preserves actionable detail without dumping full XDR paths.
 */
export function formatSppSyncUserMessage(
  message: string | null | undefined,
  opts?: { aspReady?: boolean; network?: string },
): string {
  const raw = (message || "").trim();
  const net = opts?.network ? ` (${opts.network})` : "";
  if (!raw) {
    return opts?.aspReady
      ? "Private account ready — restoring balance…"
      : `Setting up private account…${net}`;
  }

  // Setup-progress copy is passed as a non-empty raw string by callers; qualify
  // it with the active network so testnet/mainnet setup is never ambiguous.
  if (
    /syncing private account|setting up private account|finish private account setup/i.test(
      raw,
    )
  ) {
    return `Setting up private account…${net}`;
  }

  if (/partial sync from ledger/i.test(raw)) {
    // Primary dogfood path — keep calm, actionable, short for the balance card.
    const m = raw.match(/ledger\s+(\d+)/i);
    const ledger = m?.[1];
    return ledger
      ? `Synced from recent history (ledger ${ledger}+). Older notes unavailable.`
      : "Synced recent private history. Older notes unavailable without an archive.";
  }

  if (/synced via bootnode/i.test(raw)) {
    return "Private history restored from archive";
  }

  if (isSppRpcSyncGapMessage(raw)) {
    if (/bootnode/i.test(raw) || /EXPO_PUBLIC_SPP_BOOTNODE/i.test(raw)) {
      return "Private history unavailable — archive RPC needed (or redeploy fresher contracts)";
    }
    return "Private history temporarily unavailable (RPC retention gap)";
  }

  // ASP path — keep concise
  if (/Bad union switch/i.test(raw)) {
    return "Private account register failed — update the app and try again";
  }
  if (/ASP leaf ready|on-chain insert pending/i.test(raw)) {
    return raw.length > 140
      ? "Private account almost ready — finish ASP registration"
      : raw;
  }

  // Native pool sync network errors (reqwest / Soroban RPC unreachable).
  // Order matters: specific DNS/connect patterns before the generic catch-all.
  if (
    /dns error|failed to lookup address|No address associated with hostname/i.test(
      raw,
    )
  ) {
    return "Network temporarily unavailable. Check your connection and try again.";
  }
  if (/client error \(Connect\)|connection refused/i.test(raw)) {
    return "Could not reach the private payment network. Try again in a moment.";
  }
  if (/error sending request|connect timed out|timed out/i.test(raw)) {
    return "Connection timed out. Please check your connection and try again.";
  }
  if (/reqwest|network error.*url/i.test(raw)) {
    return "Private account sync failed — check your internet connection or Soroban RPC endpoint";
  }

  // Soroban RPC ledger retention / history gap
  if (/startLedger must be within|history gap/i.test(raw)) {
    return "Private history gap detected. A fresh start is needed (reinstall or restore from backup).";
  }

  // Account not funded on-chain
  if (/Could not load account/i.test(raw)) {
    if (/mainnet|public network/i.test(raw)) {
      return "Stellar account not funded — send at least 2 XLM to activate private payments";
    }
    return "Stellar account not funded — use the testnet faucet to activate";
  }

  return raw.length > 160 ? `${raw.slice(0, 157)}…` : raw;
}
