/**
 * High-level SPP orchestration for the consumer app.
 *
 * Pipeline (same as CLI): config → onboard keys → ASP leaf → prove → submit.
 * Phase 1a: native ops return structured not-ready; never silent public fallback.
 * Never log secrets.
 */

import {
  assertSppEnabled,
  getSppConfigForChain,
  sppTxExplorerUrl,
  type SppDeploymentConfig,
} from '../../constants/spp';
import {
  listSppNotes,
  markSppNoteSpent,
  saveSppNote,
  sumSppNoteAmounts,
  type SppNoteRecord,
} from '../../stores/sppNoteStore';
import { getSppAccount } from '../../stores/sppAccountStore';
import {
  sppNativeCapabilities,
  sppNativeDeposit,
  sppNativeEnsureAsp,
  sppNativePing,
  sppNativePoolBalance,
  sppNativePoolSync,
  sppNativeTransfer,
  sppNativeVersion,
  sppNativeWithdraw,
  type SppNativeOpResult,
} from './sppNativeBridge';
import { getCircuitsReadiness } from './sppCircuits';
import { formatStroops, parsePositiveStroops, tryParseStroops } from './sppAmount';
import { probeAspMembershipRoot } from './sppOnboard';
import {
  SppClientError,
  type SppClientContext,
  type SppNativeCapabilities,
  type SppTransferRecipient,
  type SppTxResult,
} from './types';

export type AspMembershipStatus = {
  status: 'ready' | 'needs_leaf' | 'not_ready';
  message: string;
  /** CLI / contract hints for dogfood until native ASP is linked. */
  cliHint?: string;
};

export type SppPrepChecklist = {
  chainEnabled: boolean;
  nativePing: boolean;
  poolOps: boolean;
  /** Device has signed the SPP key-derivation message. */
  keysSigned: boolean;
  /** ASP leaf decimal present (native derive). */
  hasAspLeaf: boolean;
  /** insert_leaf confirmed on-chain for this account. */
  aspInserted: boolean;
  asp: AspMembershipStatus;
  circuitsReady: boolean;
  circuitsDir: string;
  circuitsMissing: string[];
  readyForProve: boolean;
  blockers: string[];
};

function requireContext(chainKey: string, ownerAddress: string): SppClientContext {
  const config = assertSppEnabled(chainKey);
  if (!ownerAddress || !/^G[A-Z2-7]{55}$/.test(ownerAddress)) {
    throw new SppClientError('Valid Stellar address required for SPP', 'SPP_NO_ACCOUNT');
  }
  return { chainKey, ownerAddress, config };
}

function throwFromNative(result: SppNativeOpResult, fallbackOp: string): never {
  throw new SppClientError(
    result.message || `SPP ${result.op || fallbackOp} failed`,
    result.code || 'SPP_OPS_NOT_READY'
  );
}

function requirePositiveAmount(amount: string): void {
  parsePositiveStroops(amount);
}

function throwSppBlockers(blockers: string[]): never {
  const useful = blockers.filter(Boolean);
  throw new SppClientError(
    useful.length
      ? `Private payment is not prove-ready yet: ${useful.join('; ')}`
      : 'Private payment is not prove-ready yet',
    'SPP_PROVE_NOT_READY'
  );
}

/** Diagnostic surface for Settings / Private XLM / Home. */
export function getSppStatus(chainKey: string | null | undefined): {
  enabled: boolean;
  config: SppDeploymentConfig | null;
  native: SppNativeCapabilities;
  version: string;
  ping: string;
} {
  const config = getSppConfigForChain(chainKey);
  const native = sppNativeCapabilities();
  return {
    enabled: config !== null,
    config,
    native,
    version: sppNativeVersion(),
    ping: sppNativePing('veilpay'),
  };
}

/**
 * Pre-flight checklist before deposit/transfer/withdraw.
 * UI can show blockers without attempting a prove.
 */
export async function prepareSppOp(
  chainKey: string,
  ownerAddress: string
): Promise<SppPrepChecklist> {
  const blockers: string[] = [];
  let chainEnabled = false;
  let config: SppDeploymentConfig | null = null;
  try {
    config = requireContext(chainKey, ownerAddress).config;
    chainEnabled = true;
  } catch (e) {
    blockers.push(e instanceof Error ? e.message : 'Chain not enabled for SPP');
  }

  const native = sppNativeCapabilities();
  const nativePing = native.ping;
  if (!nativePing) blockers.push('Native bridge ping unavailable');

  const poolOps = native.poolOps;
  if (!poolOps) {
    blockers.push('Native poolOps not linked (sdk/pool via Nitro/UniFFI)');
  }

  const account = chainEnabled
    ? await getSppAccount(chainKey, ownerAddress).catch(() => null)
    : null;
  const keysSigned = Boolean(account?.derivationSigHashHex);
  const hasAspLeaf = Boolean(account?.aspLeafDecimal);
  const aspInserted = Boolean(account?.aspInserted);

  if (!keysSigned) {
    blockers.push('Select pXLM under Privacy (Token Selector / Home) to finish privacy setup');
  } else if (!hasAspLeaf) {
    blockers.push('ASP leaf not derived yet — re-select pXLM or open Private status → Register ASP');
  } else if (!aspInserted && config) {
    blockers.push(
      `ASP membership not on-chain yet — open Private status → Register ASP (${config.network}, permissionless)`
    );
  }

  const asp = await ensureAspMembership(chainKey, ownerAddress).catch(
    (): AspMembershipStatus => ({
      status: 'not_ready',
      message: 'ASP status unavailable',
    })
  );
  if (asp.status !== 'ready' && (poolOps || hasAspLeaf)) {
    // Surface ASP status even before poolOps so the hub checklist is honest.
    if (!blockers.some((b) => /ASP/i.test(b)) && asp.message) {
      blockers.push(asp.message);
    }
  }

  // RPC probe (informational; does not block until poolOps is live).
  if (chainEnabled) {
    const probe = await probeAspMembershipRoot(chainKey);
    if (!probe.ok) {
      blockers.push(probe.error || 'Soroban RPC unreachable');
    }
  }

  const circuits = await getCircuitsReadiness().catch(() => ({
    dir: '',
    ready: false,
    missing: [
      'policy_tx_2_2_proving_key.bin',
      'policy_tx_2_2.wasm',
      'policy_tx_2_2.r1cs',
    ],
    message: 'Circuit readiness unavailable',
  }));
  if (!circuits.ready) {
    blockers.push(circuits.message);
  }

  return {
    chainEnabled,
    nativePing,
    poolOps,
    keysSigned,
    hasAspLeaf,
    aspInserted,
    asp,
    circuitsReady: circuits.ready,
    circuitsDir: circuits.dir,
    circuitsMissing: circuits.missing,
    readyForProve:
      chainEnabled &&
      poolOps &&
      keysSigned &&
      hasAspLeaf &&
      (aspInserted || asp.status === 'ready') &&
      circuits.ready,
    blockers,
  };
}

/**
 * Local unspent private balance from SecureStore notes (not chain sync).
 */
export async function getLocalPrivateBalance(
  chainKey: string,
  ownerAddress: string
): Promise<{ amount: string; notes: SppNoteRecord[] }> {
  const config = getSppConfigForChain(chainKey);
  if (!config) {
    return { amount: '0', notes: [] };
  }
  const notes = await listSppNotes({
    ownerAddress,
    poolId: config.poolId,
    unspentOnly: true,
  });
  return { amount: sumSppNoteAmounts(notes), notes };
}

export type SppNoteRecoveryResult = {
  /** Whether native pool sync + balance succeeded */
  recovered: boolean;
  /** Local note balance after reconciliation */
  amount: string;
  notes: SppNoteRecord[];
  /** Native private balance (stroops → XLM) when available */
  nativeAmount?: string;
  message: string;
};

/**
 * DATA-001: attempt chain-backed recovery of private balance after reinstall /
 * SecureStore loss.
 *
 * Flow: seed circuits → ASP soft-ready → open pool session → native
 * `pool_sync` → `pool_balance` → reconcile SecureStore note cache to native
 * total so the home UI can show pXLM again.
 *
 * Spend uses the native SDK sqlite (rehydrated by pool_sync from the seed),
 * not the SecureStore summary. The summary is for display / spend planning.
 */
export async function recoverSppNotesFromChain(
  chainKey: string,
  ownerAddress: string
): Promise<SppNoteRecoveryResult> {
  const config = getSppConfigForChain(chainKey);
  if (!config) {
    return {
      recovered: false,
      amount: '0',
      notes: [],
      message: 'SPP not enabled for this chain',
    };
  }

  const localBefore = await getLocalPrivateBalance(chainKey, ownerAddress);
  const caps = sppNativeCapabilities();
  if (!caps.poolOps) {
    return {
      recovered: false,
      amount: localBefore.amount,
      notes: localBefore.notes,
      message:
        'Native poolOps required for chain note recovery. Install a pool-ops build.',
    };
  }

  try {
    // Seed bundled circuits before session open (fresh install has empty app data).
    try {
      const { sppNativeEnsureCircuitAssets } = await import('./sppNativeBridge');
      await sppNativeEnsureCircuitAssets();
    } catch {
      /* non-fatal; getCircuitsReadinessForDir also seeds */
    }

    await ensureSppAccountReadySoft(chainKey, ownerAddress);
    const { ensurePoolSession } = await import('./sppPoolSession');
    let opened = await ensurePoolSession(chainKey, ownerAddress);
    // One retry: first open after reinstall often races mnemonic / FS seed.
    if (!opened.ok) {
      await new Promise((r) => setTimeout(r, 750));
      opened = await ensurePoolSession(chainKey, ownerAddress);
    }
    if (!opened.ok) {
      return {
        recovered: false,
        amount: localBefore.amount,
        notes: localBefore.notes,
        message: opened.message || 'Could not open pool session for recovery',
      };
    }

    const sync = await sppNativePoolSync();
    if (!sync.ok) {
      return {
        recovered: false,
        amount: localBefore.amount,
        notes: localBefore.notes,
        message: sync.message || 'Native pool sync failed',
      };
    }

    // Second sync pass — first scan after empty sqlite can miss late pages.
    await sppNativePoolSync().catch(() => ({ ok: false }));

    const bal = await sppNativePoolBalance();
    if (!bal.ok || bal.balanceStroops == null) {
      return {
        recovered: false,
        amount: localBefore.amount,
        notes: localBefore.notes,
        message: bal.message || 'Native balance unavailable after sync',
      };
    }

    let nativeStroops: bigint;
    try {
      nativeStroops = BigInt(bal.balanceStroops);
    } catch {
      return {
        recovered: false,
        amount: localBefore.amount,
        notes: localBefore.notes,
        message: 'Invalid native balance stroops',
      };
    }

    const nativeAmount = formatStroops(nativeStroops);
    const localStroops = tryParseStroops(localBefore.amount) ?? 0n;
    const recoverNoteId = `recover-${chainKey}-${ownerAddress}`;
    const hasRealNotes = localBefore.notes.some((n) => !n.id.startsWith('recover-'));

    // Reconcile SecureStore summary with native total without double-counting.
    // - Fresh install (no real notes): one recover-* row = full native total.
    // - Existing real notes under native: add/update recover-* for the gap only.
    if (nativeStroops > 0n) {
      if (!hasRealNotes) {
        await saveSppNote({
          id: recoverNoteId,
          chainKey,
          poolId: config.poolId,
          ownerAddress,
          amount: nativeAmount,
          createdAt: Date.now(),
          spent: false,
        });
      } else if (nativeStroops > localStroops) {
        await saveSppNote({
          id: recoverNoteId,
          chainKey,
          poolId: config.poolId,
          ownerAddress,
          amount: formatStroops(nativeStroops - localStroops),
          createdAt: Date.now(),
          spent: false,
        });
      }
    }

    const localAfter = await getLocalPrivateBalance(chainKey, ownerAddress);
    const afterStroops = tryParseStroops(localAfter.amount) ?? 0n;
    // Never under-report native: if SecureStore lag/fails, still surface native.
    const displayAmount =
      nativeStroops > afterStroops ? nativeAmount : localAfter.amount;

    return {
      recovered: true,
      amount: displayAmount,
      notes: localAfter.notes,
      nativeAmount,
      message:
        nativeStroops > 0n
          ? `Recovered private balance ${nativeAmount} XLM from chain`
          : 'Sync complete — no private balance on-chain for this account',
    };
  } catch (e) {
    return {
      recovered: false,
      amount: localBefore.amount,
      notes: localBefore.notes,
      message: e instanceof Error ? e.message : 'Recovery failed',
    };
  }
}

async function ensureSppAccountReadySoft(
  chainKey: string,
  ownerAddress: string
): Promise<void> {
  try {
    const { ensureSppAccountReady } = await import('./sppOnboard');
    await ensureSppAccountReady(chainKey, ownerAddress);
  } catch {
    /* non-fatal for recovery path */
  }
}

/**
 * Shield public XLM into the pool.
 * @throws SppClientError
 */
export async function deposit(
  chainKey: string,
  ownerAddress: string,
  amount: string
): Promise<SppTxResult> {
  const ctx = requireContext(chainKey, ownerAddress);
  requirePositiveAmount(amount);

  // Auto-setup when user shields without having selected pXLM first (no detour).
  const { ensureSppAccountReady } = await import('./sppOnboard');
  try {
    await ensureSppAccountReady(chainKey, ownerAddress);
  } catch {
    // Continue; native ops still fail closed if needed.
  }

  const caps = sppNativeCapabilities();
  if (!caps.poolOps) {
    throwFromNative(await sppNativeDeposit(amount), 'deposit');
  }

  const prep = await prepareSppOp(chainKey, ownerAddress);
  if (!prep.readyForProve) {
    throwSppBlockers(prep.blockers);
  }

  const { ensurePoolSession } = await import('./sppPoolSession');
  const opened = await ensurePoolSession(chainKey, ownerAddress);
  if (!opened.ok) {
    throwFromNative(opened, 'pool_open');
  }

  const result = await sppNativeDeposit(amount);
  if (!result.ok || !result.txHash) {
    throwFromNative(result, 'deposit');
  }

  await saveSppNote({
    id: `dep-${result.txHash}`,
    chainKey,
    poolId: ctx.config.poolId,
    ownerAddress,
    amount,
    createdAt: Date.now(),
    spent: false,
    lastTxHash: result.txHash,
  });

  return withExplorer(ctx.config, result.txHash);
}

type SpendPlanItem = { note: SppNoteRecord; amount: bigint };

/**
 * Pick unspent notes covering `amount` (greedy newest-first), without mutating
 * SecureStore. This lets transfer/withdraw fail before native submission when
 * the app-visible note cache is known to be insufficient.
 */
async function planNotesForAmount(
  chainKey: string,
  ownerAddress: string,
  poolId: string,
  amount: string
): Promise<{ amount: bigint; items: SpendPlanItem[] }> {
  let remaining = parsePositiveStroops(amount);
  const notes = await listSppNotes({
    ownerAddress,
    poolId,
    unspentOnly: true,
  });
  const mine = notes.filter((n) => n.chainKey === chainKey);

  const selected: SpendPlanItem[] = [];
  for (const n of mine) {
    if (remaining <= 0n) break;
    const a = tryParseStroops(n.amount);
    if (!a || a <= 0n) continue;
    selected.push({ note: n, amount: a });
    remaining -= a;
  }

  if (remaining > 0n) {
    throw new SppClientError(
      'Local private note cache does not cover this amount; refresh/recover notes before spending again.',
      'SPP_LOCAL_NOTES_INSUFFICIENT'
    );
  }

  return { amount: parsePositiveStroops(amount), items: selected };
}

/**
 * Commit a successful native spend into the local note cache.
 */
async function commitSpendPlan(
  chainKey: string,
  ownerAddress: string,
  poolId: string,
  plan: { amount: bigint; items: SpendPlanItem[] },
  txHash: string
): Promise<void> {
  let toSpend = plan.amount;
  for (const { note, amount: noteAmount } of plan.items) {
    await markSppNoteSpent(note.id, txHash);
    if (noteAmount > toSpend) {
      const change = formatStroops(noteAmount - toSpend);
      await saveSppNote({
        id: `chg-${txHash}-${note.id}`,
        chainKey,
        poolId,
        ownerAddress,
        amount: change,
        createdAt: Date.now(),
        spent: false,
        lastTxHash: txHash,
      });
      toSpend = 0n;
      break;
    }
    toSpend -= noteAmount;
  }
}

/**
 * Private transfer to registry address or raw note/enc keys.
 * @throws SppClientError
 */
export async function transfer(
  chainKey: string,
  ownerAddress: string,
  amount: string,
  recipient: SppTransferRecipient
): Promise<SppTxResult> {
  const ctx = requireContext(chainKey, ownerAddress);
  requirePositiveAmount(amount);

  let recipientWire: string;
  if (recipient.kind === 'address') {
    if (!/^G[A-Z2-7]{55}$/.test(recipient.stellarAddress)) {
      throw new SppClientError('Invalid recipient Stellar address', 'SPP_INVALID_RECIPIENT');
    }
    recipientWire = recipient.stellarAddress;
  } else {
    if (!recipient.notePublicKey || !recipient.encryptionPublicKey) {
      throw new SppClientError(
        'Recipient note and encryption keys required',
        'SPP_INVALID_RECIPIENT'
      );
    }
    recipientWire = `keys:${recipient.notePublicKey}:${recipient.encryptionPublicKey}`;
  }

  const spendPlan = await planNotesForAmount(
    chainKey,
    ownerAddress,
    ctx.config.poolId,
    amount
  );

  const caps = sppNativeCapabilities();
  if (!caps.poolOps) {
    throwFromNative(await sppNativeTransfer(amount, recipientWire), 'transfer');
  }

  const prep = await prepareSppOp(chainKey, ownerAddress);
  if (!prep.readyForProve) {
    throwSppBlockers(prep.blockers);
  }

  const { ensurePoolSession } = await import('./sppPoolSession');
  const opened = await ensurePoolSession(chainKey, ownerAddress);
  if (!opened.ok) {
    throwFromNative(opened, 'pool_open');
  }

  const result = await sppNativeTransfer(amount, recipientWire);
  if (!result.ok || !result.txHash) {
    throwFromNative(result, 'transfer');
  }
  await commitSpendPlan(
    chainKey,
    ownerAddress,
    ctx.config.poolId,
    spendPlan,
    result.txHash
  );
  return withExplorer(ctx.config, result.txHash);
}

/**
 * Unshield to a public Stellar address (defaults to owner).
 * @throws SppClientError
 */
export async function withdraw(
  chainKey: string,
  ownerAddress: string,
  amount: string,
  to?: string
): Promise<SppTxResult> {
  const ctx = requireContext(chainKey, ownerAddress);
  requirePositiveAmount(amount);
  const recipient = to ?? ownerAddress;
  if (!/^G[A-Z2-7]{55}$/.test(recipient)) {
    throw new SppClientError('Invalid withdraw destination', 'SPP_INVALID_RECIPIENT');
  }

  const spendPlan = await planNotesForAmount(
    chainKey,
    ownerAddress,
    ctx.config.poolId,
    amount
  );

  const caps = sppNativeCapabilities();
  if (!caps.poolOps) {
    throwFromNative(await sppNativeWithdraw(amount, recipient), 'withdraw');
  }

  const prep = await prepareSppOp(chainKey, ownerAddress);
  if (!prep.readyForProve) {
    throwSppBlockers(prep.blockers);
  }

  const { ensurePoolSession } = await import('./sppPoolSession');
  const opened = await ensurePoolSession(chainKey, ownerAddress);
  if (!opened.ok) {
    throwFromNative(opened, 'pool_open');
  }

  const result = await sppNativeWithdraw(amount, recipient);
  if (!result.ok || !result.txHash) {
    throwFromNative(result, 'withdraw');
  }
  await commitSpendPlan(
    chainKey,
    ownerAddress,
    ctx.config.poolId,
    spendPlan,
    result.txHash
  );
  return withExplorer(ctx.config, result.txHash);
}

/**
 * Ensure ASP membership leaf is on-chain (required before any prove).
 *
 * Phase 1a: native returns not_ready; we surface CLI dogfood steps that
 * worked in Phase 0 (permissionless insert_leaf on live testnet).
 */
export async function ensureAspMembership(
  chainKey: string,
  ownerAddress: string
): Promise<AspMembershipStatus> {
  const ctx = requireContext(chainKey, ownerAddress);
  const account = await getSppAccount(chainKey, ownerAddress).catch(() => null);

  if (account?.aspInserted) {
    return {
      status: 'ready',
      message: account.aspInsertTxHash
        ? `ASP membership on-chain (${account.aspInsertTxHash.slice(0, 8)}…)`
        : 'ASP membership on-chain',
    };
  }

  if (account?.aspLeafDecimal) {
    return {
      status: 'needs_leaf',
      message: 'ASP leaf derived on-device — register membership on-chain (one-time)',
      cliHint: aspCliHint(ctx.config),
    };
  }

  const caps = sppNativeCapabilities();
  if (caps.aspLeaf) {
    return {
      status: 'needs_leaf',
      message: 'Select pXLM to derive ASP leaf, then register membership',
      cliHint: aspCliHint(ctx.config),
    };
  }

  return {
    status: 'not_ready',
    message:
      'ASP leaf needs native libspp_native.so. Install the preview/dev-client build with NDK.',
    cliHint: aspCliHint(ctx.config),
  };
}

function aspCliHint(config: SppDeploymentConfig): string {
  return [
    `SPP recovery (${config.network}, permissionless insert):`,
    '1. spp onboard --account <alias> --accept --no-bootnode --no-register',
    '2. Compute leaf = poseidon2_hash2(note_pk, membership_blinding, domain=1)',
    `3. stellar contract invoke --id ${config.aspMembershipId} --network ${config.network} --source <alias> -- insert_leaf --leaf <decimal>`,
    '4. Then deposit / transfer / withdraw against pool ' + config.poolId,
  ].join('\n');
}

/** Helper for UI: attach explorer URL once a hash exists. */
export function withExplorer(config: SppDeploymentConfig, txHash: string): SppTxResult {
  return { txHash, explorerUrl: sppTxExplorerUrl(config, txHash) };
}
