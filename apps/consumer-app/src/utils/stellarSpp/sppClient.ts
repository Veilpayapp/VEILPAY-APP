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
  sppNativeTransfer,
  sppNativeVersion,
  sppNativeWithdraw,
  type SppNativeOpResult,
} from './sppNativeBridge';
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
  if (!amount || Number(amount) <= 0) {
    throw new SppClientError('Amount must be positive', 'SPP_INVALID_AMOUNT');
  }
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
  try {
    requireContext(chainKey, ownerAddress);
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
  } else if (!aspInserted) {
    blockers.push(
      'ASP membership not on-chain yet — open Private status → Register ASP (testnet, permissionless)'
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

  return {
    chainEnabled,
    nativePing,
    poolOps,
    keysSigned,
    hasAspLeaf,
    aspInserted,
    asp,
    readyForProve:
      chainEnabled &&
      poolOps &&
      keysSigned &&
      hasAspLeaf &&
      (aspInserted || asp.status === 'ready'),
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

/**
 * Pick unspent notes covering `amount` (greedy newest-first).
 * Whole notes are marked spent; residual (change) is re-saved as a new note.
 */
async function spendNotesForAmount(
  chainKey: string,
  ownerAddress: string,
  poolId: string,
  amount: string,
  txHash: string
): Promise<void> {
  const need = Number(amount);
  if (!(need > 0)) return;
  const notes = await listSppNotes({
    ownerAddress,
    poolId,
    unspentOnly: true,
  });
  const mine = notes.filter((n) => n.chainKey === chainKey);
  let remaining = need;
  for (const n of mine) {
    if (remaining <= 0) break;
    const a = Number(n.amount);
    if (!(a > 0)) continue;
    await markSppNoteSpent(n.id, txHash);
    if (a > remaining + 1e-12) {
      const change = (a - remaining).toFixed(7).replace(/\.?0+$/, '') || '0';
      if (Number(change) > 0) {
        await saveSppNote({
          id: `chg-${txHash}-${n.id}`,
          chainKey,
          poolId,
          ownerAddress,
          amount: change,
          createdAt: Date.now(),
          spent: false,
          lastTxHash: txHash,
        });
      }
      remaining = 0;
    } else {
      remaining -= a;
    }
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

  const caps = sppNativeCapabilities();
  if (!caps.poolOps) {
    throwFromNative(await sppNativeTransfer(amount, recipientWire), 'transfer');
  }

  const result = await sppNativeTransfer(amount, recipientWire);
  if (!result.ok || !result.txHash) {
    throwFromNative(result, 'transfer');
  }
  await spendNotesForAmount(
    chainKey,
    ownerAddress,
    ctx.config.poolId,
    amount,
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

  const caps = sppNativeCapabilities();
  if (!caps.poolOps) {
    throwFromNative(await sppNativeWithdraw(amount, recipient), 'withdraw');
  }

  const result = await sppNativeWithdraw(amount, recipient);
  if (!result.ok || !result.txHash) {
    throwFromNative(result, 'withdraw');
  }
  await spendNotesForAmount(
    chainKey,
    ownerAddress,
    ctx.config.poolId,
    amount,
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
    'Phase 0 dogfood (testnet, permissionless insert):',
    '1. spp onboard --account <alias> --accept --no-bootnode --no-register',
    '2. Compute leaf = poseidon2_hash2(note_pk, membership_blinding, domain=1)',
    `3. stellar contract invoke --id ${config.aspMembershipId} --network testnet --source <alias> -- insert_leaf --leaf <decimal>`,
    '4. Then deposit / transfer / withdraw against pool ' + config.poolId,
  ].join('\n');
}

/** Helper for UI: attach explorer URL once a hash exists. */
export function withExplorer(config: SppDeploymentConfig, txHash: string): SppTxResult {
  return { txHash, explorerUrl: sppTxExplorerUrl(config, txHash) };
}
