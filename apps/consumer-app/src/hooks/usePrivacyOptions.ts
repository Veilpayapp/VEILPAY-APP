/**
 * Chain-aware privacy options for PrivacyLevelScreen.
 *
 * - EVM (Sepolia + configured stack): Standard / Stealth / Max
 * - Stellar testnet (SPP): Standard / Private
 * - Stellar mainnet: Standard only; Private disabled (fail-closed)
 * - Everything else: Standard only
 */

import { useMemo } from 'react';
import type { IconName } from '../components/Icon';
import {
  EVM_MAX_PRIVACY_WITHDRAW_READY,
  isPrivacyStackConfigured,
  SEPOLIA_CHAIN_ID,
} from '../constants/contracts';
import { isSppEnabledForChain } from '../constants/spp';
import type { PrivacyLevel } from '../stores/settingsStore';
import { useActiveChain } from '../stores/walletStore';
import { sppNativeCapabilities } from '../utils/stellarSpp/sppNativeBridge';

export function isMaxPrivacyWithdrawReady(): boolean {
  return EVM_MAX_PRIVACY_WITHDRAW_READY;
}

/**
 * SPP-001 / Phase 2: private shield/transfer/unshield require native poolOps.
 * Chain enablement alone is not enough (derive/ASP-only APKs must hard-disable).
 */
export function isSppPoolOpsReady(): boolean {
  try {
    return sppNativeCapabilities().poolOps === true;
  } catch {
    return false;
  }
}

export interface PrivacyOptionDef {
  id: PrivacyLevel;
  title: string;
  subtitle: string;
  iconName: IconName;
  features: string[];
  recommended?: boolean;
  /** When false, row is grayed with `disabledReason`. */
  enabled: boolean;
  disabledReason?: string;
  /** Extra body copy under the subtitle (e.g. stealth description). */
  description?: string;
}

const STEALTH_DESCRIPTION =
  'One-time stealth address. The recipient discovers the payment via an announcement event; on-chain it looks like a transfer to a fresh address.';

export type PrivacyOptionsContext = {
  /**
   * When set, overrides the live native capability probe (tests / SSR).
   * Default: read `sppNativeCapabilities().poolOps`.
   */
  poolOpsReady?: boolean;
};

/**
 * Build selectable privacy rows for the active wallet chain.
 */
export function getPrivacyOptionsForChain(
  chainKey: string | null | undefined,
  chainId: number | string | null | undefined,
  ctx: PrivacyOptionsContext = {}
): PrivacyOptionDef[] {
  const isSepolia = chainId === SEPOLIA_CHAIN_ID;
  const evmPrivacyOk = isSepolia && isPrivacyStackConfigured();
  // DATA-002: the max-privacy deposit path is gated on the withdraw being
  // wired end-to-end. Until `EVM_MAX_PRIVACY_WITHDRAW_READY` is true, the
  // max option is disabled even when the rest of the privacy stack is
  // configured, so users cannot lock funds they can never recover from the app.
  const maxEnabled = evmPrivacyOk && EVM_MAX_PRIVACY_WITHDRAW_READY;
  const sppChainOk = isSppEnabledForChain(chainKey);
  const poolOpsReady =
    ctx.poolOpsReady !== undefined ? ctx.poolOpsReady : isSppPoolOpsReady();
  // SPP-001: chain allowlist AND native poolOps — derive-only builds cannot shield.
  const sppOk = sppChainOk && poolOpsReady;
  const isStellar = chainKey === 'stellar' || chainKey === 'stellar-testnet';

  if (isStellar) {
    let privateDisabledReason: string | undefined;
    if (!sppChainOk) {
      privateDisabledReason = 'Private XLM is not available on mainnet yet';
    } else if (!poolOpsReady) {
      privateDisabledReason =
        'Private XLM needs a pool-ops build. Public XLM still works — use Standard, or install the full preview APK.';
    }

    return [
      {
        id: 'standard',
        title: 'STANDARD',
        subtitle: 'Public XLM transfer',
        iconName: 'shield',
        features: [
          'Direct Stellar payment',
          'Visible sender and recipient',
          'Fast confirmation (~5s)',
          'No zero-knowledge proof',
        ],
        enabled: true,
      },
      {
        id: 'private',
        title: 'PRIVATE',
        subtitle: 'Private transfer',
        iconName: 'private-lock',
        features: [
          'Hide amount and counterparty',
          'Self-custody on this device',
          'Takes a few seconds to prepare',
        ],
        recommended: sppOk,
        enabled: sppOk,
        disabledReason: privateDisabledReason,
        description:
          'Send privately. Recipient uses a standard Stellar address.',
      },
    ];
  }

  // Default: EVM-shaped options (and non-Stellar chains).
  return [
    {
      id: 'standard',
      title: 'STANDARD',
      subtitle: 'Direct Transfer',
      iconName: 'shield',
      features: [
        'Direct on-chain transfer',
        'Visible sender and recipient',
        'Fast confirmation',
        'Lowest gas fees',
      ],
      enabled: true,
    },
    {
      id: 'stealth',
      title: 'STEALTH',
      subtitle: 'One-Time Stealth Address',
      iconName: 'shield',
      features: [
        'One-time stealth address',
        'Recipient discovers via announcement event',
        'On-chain looks like a transfer to a fresh address',
        'Breaks recipient linkability',
      ],
      enabled: evmPrivacyOk,
      disabledReason: evmPrivacyOk
        ? undefined
        : isSepolia
          ? 'Privacy pool not yet configured for this build'
          : 'Privacy pool not available on this network',
      description: STEALTH_DESCRIPTION,
    },
    {
      id: 'max',
      title: 'MAXIMUM',
      subtitle: 'ZK Proof Privacy Pool',
      iconName: 'private-lock',
      features: [
        'Zero-knowledge proofs',
        'Complete transaction privacy',
        'Untraceable deposits',
        'Mathematical guarantees',
      ],
      recommended: maxEnabled,
      enabled: maxEnabled,
      disabledReason: !evmPrivacyOk
        ? isSepolia
          ? 'Privacy pool not yet configured for this build'
          : 'Privacy pool not available on this network'
        : // Privacy stack is configured but the withdraw path is not wired yet.
          'Max-privacy withdraw is not available in this build. Deposits would be locked until a future update adds Merkle path + nullifierHash + relayer withdraw.',
    },
  ];
}

export function isPrivacyLevelEnabled(
  level: PrivacyLevel,
  chainKey: string | null | undefined,
  chainId: number | string | null | undefined,
  ctx: PrivacyOptionsContext = {}
): boolean {
  const opt = getPrivacyOptionsForChain(chainKey, chainId, ctx).find((o) => o.id === level);
  return opt?.enabled ?? level === 'standard';
}

/**
 * Clamp a preferred level to one that is enabled on this chain.
 */
export function clampPrivacyLevel(
  preferred: PrivacyLevel,
  chainKey: string | null | undefined,
  chainId: number | string | null | undefined,
  ctx: PrivacyOptionsContext = {}
): PrivacyLevel {
  if (isPrivacyLevelEnabled(preferred, chainKey, chainId, ctx)) {
    return preferred;
  }
  // Prefer private on SPP testnet when poolOps is ready (max/stealth defaults).
  if (
    (preferred === 'max' || preferred === 'stealth') &&
    isPrivacyLevelEnabled('private', chainKey, chainId, ctx)
  ) {
    return 'private';
  }
  // Saved `private` without poolOps (or mainnet) → public Standard.
  if (preferred === 'private') {
    return 'standard';
  }
  // DATA-002: a `max` default that is no longer enabled (withdraw not wired)
  // falls back to `stealth` if the stealth stack is configured, otherwise
  // `standard`. This prevents a saved `max` default from blocking a send.
  if (preferred === 'max') {
    const isSepolia = chainId === SEPOLIA_CHAIN_ID;
    if (isSepolia && isPrivacyStackConfigured()) {
      return 'stealth';
    }
  }
  return 'standard';
}

export function usePrivacyOptions(): {
  options: PrivacyOptionDef[];
  chainKey: string | null;
  clamp: (level: PrivacyLevel) => PrivacyLevel;
  isEnabled: (level: PrivacyLevel) => boolean;
  poolOpsReady: boolean;
} {
  const activeChain = useActiveChain();
  const chainKey = activeChain?.key ?? null;
  const chainId = activeChain?.id ?? null;
  // Re-read on each render so a late-loaded native module can flip private on.
  const poolOpsReady = isSppPoolOpsReady();

  return useMemo(() => {
    const ctx: PrivacyOptionsContext = { poolOpsReady };
    const options = getPrivacyOptionsForChain(chainKey, chainId, ctx);
    return {
      options,
      chainKey,
      poolOpsReady,
      clamp: (level: PrivacyLevel) => clampPrivacyLevel(level, chainKey, chainId, ctx),
      isEnabled: (level: PrivacyLevel) => isPrivacyLevelEnabled(level, chainKey, chainId, ctx),
    };
  }, [chainKey, chainId, poolOpsReady]);
}
