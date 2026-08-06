/**
 * Privacy-pool assets shown in Token Selector + Home assets.
 *
 * These are not ERC-20-style tokens: selecting one switches the home surface
 * into a shielded balance mode (SPP Private XLM, future pools, etc.).
 *
 * Mainnet SPP remains fail-closed: its row becomes selectable only when
 * `SPP_MAINNET` was built from a valid deployment manifest + Soroban RPC.
 */

import {
  isSppEnabledForChain,
  SPP_MAINNET,
  SPP_TESTNET,
  type SppDeploymentConfig,
} from './spp';
import type { PaymentToken } from '../types/tokens';

/** Discriminator for non-public balances on Home / Token Selector. */
export type PrivacyProtocol = 'spp' | 'veil-pool';

export interface PrivacyAsset {
  /** Stable id used for selection state, e.g. `spp-xlm-testnet`. */
  id: string;
  protocol: PrivacyProtocol;
  /** Display name. */
  name: string;
  /** Ticker shown on home (e.g. pXLM). */
  symbol: string;
  /** Underlying public asset symbol for price quotes (XLM, ETH…). */
  quoteSymbol: string;
  /** Chain the pool lives on. */
  chainKey: string;
  /** Short UX blurb. */
  subtitle: string;
  icon: string;
  /** Feature chips for the privacy home surface. */
  features: string[];
  /** Optional SPP deployment (when protocol === 'spp'). */
  spp?: SppDeploymentConfig;
  /** When false, row is visible but not selectable (e.g. mainnet placeholder). */
  enabled: boolean;
  disabledReason?: string;
}

/**
 * Catalog of privacy assets. Only **enabled** rows are selectable.
 * Add future chains/pools here without changing Home layout.
 */
export const PRIVACY_ASSETS: PrivacyAsset[] = [
  {
    id: 'spp-xlm-testnet',
    protocol: 'spp',
    name: 'Private XLM',
    symbol: 'pXLM',
    quoteSymbol: 'XLM',
    chainKey: 'stellar-testnet',
    // User-facing subtitle only — no protocol jargon (SPP, pool, notes).
    subtitle: 'Private XLM · Testnet',
    icon: '◈',
    // Kept empty: home balance card no longer renders feature bullets.
    // Actions (Shield / Transfer / Unshield) carry the product meaning.
    features: [],
    spp: SPP_TESTNET,
    enabled: true,
  },
  {
    id: 'spp-xlm-mainnet',
    protocol: 'spp',
    name: 'Private XLM',
    symbol: 'pXLM',
    quoteSymbol: 'XLM',
    chainKey: 'stellar',
    subtitle: 'Private XLM · Mainnet',
    icon: '◈',
    features: [],
    spp: SPP_MAINNET ?? undefined,
    enabled: SPP_MAINNET !== null,
    disabledReason: SPP_MAINNET
      ? undefined
      : 'Private XLM is not configured for this Mainnet build.',
  },
];

export function getPrivacyAssetById(id: string | null | undefined): PrivacyAsset | undefined {
  if (!id) return undefined;
  return PRIVACY_ASSETS.find((a) => a.id === id);
}

/** Privacy assets relevant to a chain key (plus discoverable disabled mainnet rows). */
export function getPrivacyAssetsForChain(chainKey: string | null | undefined): PrivacyAsset[] {
  if (!chainKey) return [];
  return PRIVACY_ASSETS.filter((a) => a.chainKey === chainKey);
}

/**
 * Assets to list in Token Selector "Privacy" section for the active chain.
 * Includes disabled mainnet placeholders so users see why Private is unavailable.
 */
export function listPrivacyAssetsForSelector(chainKey: string | null | undefined): PrivacyAsset[] {
  if (!chainKey) return [];
  // On stellar-testnet: show enabled testnet SPP.
  // On stellar mainnet: show disabled mainnet row.
  // On other chains: empty (no privacy section).
  return getPrivacyAssetsForChain(chainKey);
}

/** Whether this chain has any privacy section content. */
export function chainHasPrivacySection(chainKey: string | null | undefined): boolean {
  return listPrivacyAssetsForSelector(chainKey).length > 0;
}

/**
 * Map a privacy asset to PaymentToken shape for selector list rows.
 * Balance is filled by the caller (local notes / future sync).
 */
export function privacyAssetToPaymentToken(
  asset: PrivacyAsset,
  balance = '0',
  usdPrice = 0
): PaymentToken {
  const chainType =
    asset.chainKey.startsWith('stellar') ? 'xlm' : asset.chainKey.includes('solana') ? 'svm' : 'evm';

  return {
    id: asset.id,
    name: asset.name,
    symbol: asset.symbol,
    balance,
    usdPrice,
    chainTypes: [chainType],
    icon: asset.icon,
    isPrivacyAsset: true,
    privacyProtocol: asset.protocol,
    privacyAssetId: asset.id,
    privacyChainKey: asset.chainKey,
    privacyEnabled: asset.enabled,
    privacyDisabledReason: asset.disabledReason,
    privacySubtitle: asset.subtitle,
  };
}

/** Runtime check: can this asset be activated right now? */
export function canActivatePrivacyAsset(asset: PrivacyAsset): boolean {
  if (!asset.enabled) return false;
  if (asset.protocol === 'spp') {
    return isSppEnabledForChain(asset.chainKey);
  }
  return asset.enabled;
}
