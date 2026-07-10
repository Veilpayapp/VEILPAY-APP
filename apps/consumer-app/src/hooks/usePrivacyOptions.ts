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
import { isPrivacyStackConfigured, SEPOLIA_CHAIN_ID } from '../constants/contracts';
import { isSppEnabledForChain } from '../constants/spp';
import type { PrivacyLevel } from '../stores/settingsStore';
import { useActiveChain } from '../stores/walletStore';

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

/**
 * Build selectable privacy rows for the active wallet chain.
 */
export function getPrivacyOptionsForChain(
  chainKey: string | null | undefined,
  chainId: number | string | null | undefined
): PrivacyOptionDef[] {
  const isSepolia = chainId === SEPOLIA_CHAIN_ID;
  const evmPrivacyOk = isSepolia && isPrivacyStackConfigured();
  const sppOk = isSppEnabledForChain(chainKey);
  const isStellar = chainKey === 'stellar' || chainKey === 'stellar-testnet';

  if (isStellar) {
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
        subtitle: 'Shielded SPP transfer',
        iconName: 'private-lock',
        features: [
          'Stellar privacy pool (BN254 Groth16)',
          'Private amount and counterparty',
          'Self-custody notes on this device',
          'Prove time ~10s on desktop (device varies)',
        ],
        recommended: sppOk,
        enabled: sppOk,
        disabledReason: sppOk
          ? undefined
          : 'Private XLM is not available on mainnet until audit and ceremony',
        description:
          'Uses Stellar Private Payments (SPP). Recipient is a G… address registered in the public key book, or note keys out of band.',
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
      recommended: evmPrivacyOk,
      enabled: evmPrivacyOk,
      disabledReason: evmPrivacyOk
        ? undefined
        : isSepolia
          ? 'Privacy pool not yet configured for this build'
          : 'Privacy pool not available on this network',
    },
  ];
}

export function isPrivacyLevelEnabled(
  level: PrivacyLevel,
  chainKey: string | null | undefined,
  chainId: number | string | null | undefined
): boolean {
  const opt = getPrivacyOptionsForChain(chainKey, chainId).find((o) => o.id === level);
  return opt?.enabled ?? level === 'standard';
}

/**
 * Clamp a preferred level to one that is enabled on this chain.
 */
export function clampPrivacyLevel(
  preferred: PrivacyLevel,
  chainKey: string | null | undefined,
  chainId: number | string | null | undefined
): PrivacyLevel {
  if (isPrivacyLevelEnabled(preferred, chainKey, chainId)) {
    return preferred;
  }
  // Prefer recommended private on SPP testnet when default was max/stealth.
  if (isSppEnabledForChain(chainKey) && (preferred === 'max' || preferred === 'stealth')) {
    return 'private';
  }
  return 'standard';
}

export function usePrivacyOptions(): {
  options: PrivacyOptionDef[];
  chainKey: string | null;
  clamp: (level: PrivacyLevel) => PrivacyLevel;
  isEnabled: (level: PrivacyLevel) => boolean;
} {
  const activeChain = useActiveChain();
  const chainKey = activeChain?.key ?? null;
  const chainId = activeChain?.id ?? null;

  return useMemo(() => {
    const options = getPrivacyOptionsForChain(chainKey, chainId);
    return {
      options,
      chainKey,
      clamp: (level: PrivacyLevel) => clampPrivacyLevel(level, chainKey, chainId),
      isEnabled: (level: PrivacyLevel) => isPrivacyLevelEnabled(level, chainKey, chainId),
    };
  }, [chainKey, chainId]);
}
