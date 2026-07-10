/**
 * Shield → transfer → unshield orchestration (product E2E path).
 *
 * Used by tests with an injected native backend (`poolOps: true`) and by UI
 * once CAP_POOL_OPS is live. Never logs secrets.
 */

import { deposit, transfer, withdraw, getLocalPrivateBalance } from './sppClient';
import type { SppTransferRecipient, SppTxResult } from './types';
import { SppClientError } from './types';

export type SppLifecycleStep = 'shield' | 'transfer' | 'unshield';

export type SppLifecycleResult = {
  shield: SppTxResult;
  transfer: SppTxResult;
  unshield: SppTxResult;
  /** Local private balance after unshield (should be ~0 if full cycle). */
  finalPrivateBalance: string;
};

export type SppLifecycleParams = {
  chainKey: string;
  ownerAddress: string;
  /** Amount to shield, then transfer half (or full if transferAmount set). */
  shieldAmount: string;
  /** Optional private transfer amount (default: same as shieldAmount). */
  transferAmount?: string;
  /** Transfer recipient (required when transferAmount > 0 path runs). */
  recipient: SppTransferRecipient;
  /**
   * Withdraw destination. Defaults to owner (self-unshield).
   * After a full transfer of all shielded funds, unshield amount is 0 and
   * we skip unshield unless `unshieldAmount` is set from residual notes.
   */
  unshieldTo?: string;
  /** Explicit unshield amount; default = remaining local private balance after transfer. */
  unshieldAmount?: string;
};

/**
 * Run shield → private transfer → unshield against the live client.
 * Each step fail-closes via {@link SppClientError}.
 *
 * Preferred dogfood shape: shield S, transfer T &lt; S, unshield residual (S−T)
 * via {@link planLifecycleAmounts}.
 */
export async function runShieldTransferUnshield(
  params: SppLifecycleParams
): Promise<SppLifecycleResult> {
  const {
    chainKey,
    ownerAddress,
    shieldAmount,
    transferAmount = shieldAmount,
    recipient,
    unshieldTo,
  } = params;

  const planned =
    params.unshieldAmount !== undefined
      ? {
          shield: shieldAmount,
          transfer: transferAmount,
          unshield: params.unshieldAmount,
        }
      : planLifecycleAmounts(shieldAmount, transferAmount);

  if (Number(planned.unshield) <= 0) {
    throw new SppClientError(
      'Lifecycle needs residual after transfer (transfer must be < shield).',
      'SPP_NO_RESIDUAL_FOR_UNSHIELD'
    );
  }

  const shield = await deposit(chainKey, ownerAddress, planned.shield);
  const xfer = await transfer(chainKey, ownerAddress, planned.transfer, recipient);
  const unshield = await withdraw(
    chainKey,
    ownerAddress,
    planned.unshield,
    unshieldTo
  );

  const { amount: finalPrivateBalance } = await getLocalPrivateBalance(
    chainKey,
    ownerAddress
  );

  return {
    shield,
    transfer: xfer,
    unshield,
    finalPrivateBalance,
  };
}

/**
 * Split amounts for a balanced dogfood cycle:
 * shield S → transfer T → unshield (S − T).
 */
export function planLifecycleAmounts(shieldAmount: string, transferAmount: string): {
  shield: string;
  transfer: string;
  unshield: string;
} {
  const s = Number(shieldAmount);
  const t = Number(transferAmount);
  if (!(s > 0) || !(t > 0) || t > s) {
    throw new SppClientError(
      'Need shield > 0, transfer > 0, and transfer ≤ shield',
      'SPP_INVALID_AMOUNT'
    );
  }
  // Keep 7-decimal display-ish string
  const residual = (s - t).toFixed(7).replace(/\.?0+$/, '') || '0';
  return {
    shield: shieldAmount,
    transfer: transferAmount,
    unshield: residual,
  };
}
