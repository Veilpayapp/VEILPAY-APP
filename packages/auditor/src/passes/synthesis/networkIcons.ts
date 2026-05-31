/**
 * Pass 3 — Synthesis: Network_Icon replacement plan builder.
 *
 * Pure (no I/O) factory that turns the Pass 1 inventory of consumer-app
 * icon assets and renderers into the canonical eight-row Network_Icon
 * Replacement Plan consumed by Pass 4. The Auditor is planning-only — this
 * synthesizer never reads or writes asset files; it consumes the
 * already-discovered `apps/consumer-app/` paths and emits the structured
 * plan that the Markdown renderer formats verbatim.
 *
 * Mirrors:
 *   - design.md "Network_Icon entry" YAML schema (chain_slug, display_name,
 *     current_assets, renderer_paths, brand_kit_url, license_terms,
 *     license_compatible, target_filename, target_directory, fallback_action).
 *   - design.md "Required entries (Requirement 4.2)" — exactly the eight
 *     canonical chains: ethereum, polygon, base, arbitrum, optimism,
 *     solana, bnb, avalanche.
 *   - design.md "Brand-kit URL or license sourcing failure" failure mode —
 *     emit the entry with `license_compatible: 'unknown'` and a non-null
 *     `fallback_action`, per Requirement 4.9 / Property 8.
 *
 * Validates Requirements:
 *   - 4.1 (every entry carries `current_assets` and `renderer_paths`)
 *   - 4.2 (one entry per canonical chain, in canonical order)
 *   - 4.3 (brand kit URL recorded for each network)
 *   - 4.4 (license terms recorded for each network)
 *   - 4.5 (target_filename specifies SVG primary asset format)
 *   - 4.6 (target_filename uses `network-<chain-slug>.svg` convention)
 *   - 4.7 (target_directory inside `apps/consumer-app/`)
 *   - 4.8 (renderer_paths captures the import surface to preserve)
 *   - 4.9 (fallback_action populated when license_compatible !== true or
 *           an asset is missing)
 *
 * Property 8 (well-formedness + licensed-or-gapped) is exercised by the
 * companion test in task 4.10.
 *
 * The Auditor cannot make definitive licensing calls without legal review,
 * so every entry ships with `license_compatible: 'unknown'` and a documented
 * fallback_action. This is the explicit "documented gap" that Threshold #6
 * (Network_Icon_Set 100% replaced excluding documented gaps) credits.
 */

import * as path from 'node:path';

import type {
  CanonicalChainSlug,
  LicenseCompatibility,
  Network_Icon,
} from '../../models';

// ---------------------------------------------------------------------------
// Input shape
// ---------------------------------------------------------------------------

/**
 * Pass 1 inventory consumed by `buildNetworkIconPlan`.
 *
 * Both lists are workspace-relative POSIX-style paths produced by
 * `runDiscovery` (`DiscoveryOutput.networkIconAssets`,
 * `DiscoveryOutput.networkIconRenderers`).
 */
export interface NetworkIconInput {
  /** Workspace-relative POSIX paths of icon assets shipped today. */
  readonly discoveredAssets: readonly string[];
  /** Workspace-relative POSIX paths of TS/TSX files that render the assets. */
  readonly discoveredRenderers: readonly string[];
}

// ---------------------------------------------------------------------------
// Canonical chain configuration
// ---------------------------------------------------------------------------

/**
 * Per-chain static configuration. Captures the four columns that don't
 * depend on the workspace inventory: canonical slug, human-readable
 * display name, official brand-kit URL, and the substring matcher used to
 * filter assets by basename.
 *
 * `displayName` strings come from the brand kits themselves (per
 * Requirement 4.2). `brandKitUrl` values are the canonical landing pages
 * the audit recommends following up on; the legal-review step is captured
 * via `license_compatible: 'unknown'` and a documented fallback_action.
 */
interface ChainConfig {
  readonly slug: CanonicalChainSlug;
  readonly displayName: string;
  readonly brandKitUrl: string;
}

/**
 * The eight canonical chains, in the order required by Requirement 4.2.
 *
 * Ordering matters: Property 8 walks this list to assert exactly one entry
 * per slug, and the renderer emits the replacement plan rows in this same
 * order so consumer-app implementers see the same surface every run.
 *
 * Brand-kit URLs cite the official brand-asset landing pages:
 *   - ethereum.org publishes ETH brand assets directly.
 *   - polygon.technology, base.org, optimism.io, solana.com, and
 *     bnbchain.org each host a `/brand` or `/branding` page.
 *   - The Arbitrum Foundation (`arbitrum.foundation`) is the canonical
 *     landing page; the brand-kit link rotates so the audit recommends
 *     verifying the current asset path during follow-up.
 *   - avax.network publishes Avalanche brand assets at `/brand`.
 */
const CANONICAL_CHAINS: readonly ChainConfig[] = Object.freeze([
  Object.freeze({
    slug: 'ethereum',
    displayName: 'Ethereum',
    brandKitUrl: 'https://ethereum.org/en/assets/',
  }),
  Object.freeze({
    slug: 'polygon',
    displayName: 'Polygon',
    brandKitUrl: 'https://polygon.technology/brand-kit',
  }),
  Object.freeze({
    slug: 'base',
    displayName: 'Base',
    brandKitUrl: 'https://base.org/brand',
  }),
  Object.freeze({
    slug: 'arbitrum',
    displayName: 'Arbitrum',
    brandKitUrl: 'https://arbitrum.foundation/',
  }),
  Object.freeze({
    slug: 'optimism',
    displayName: 'Optimism',
    brandKitUrl: 'https://www.optimism.io/brand',
  }),
  Object.freeze({
    slug: 'solana',
    displayName: 'Solana',
    brandKitUrl: 'https://solana.com/branding',
  }),
  Object.freeze({
    slug: 'bnb',
    displayName: 'BNB Chain',
    brandKitUrl: 'https://www.bnbchain.org/en/brand-resources',
  }),
  Object.freeze({
    slug: 'avalanche',
    displayName: 'Avalanche',
    brandKitUrl: 'https://www.avax.network/brand',
  }),
]) as readonly ChainConfig[];

/**
 * Target directory under `apps/consumer-app/` for the replacement assets
 * (Requirement 4.7). Property 8 asserts every entry's `target_directory`
 * starts with `apps/consumer-app/`.
 */
const TARGET_DIRECTORY = 'apps/consumer-app/assets/networks/' as const;

/**
 * Placeholder license-terms text. The audit cannot make definitive license
 * calls without legal review (Requirement 10.6 — read-only against external
 * sources). Pairing this placeholder with `license_compatible: 'unknown'`
 * and a documented `fallback_action` satisfies Requirement 4.9 and
 * Property 8 ("licensed-or-gapped").
 */
const LICENSE_TERMS_PLACEHOLDER =
  'See linked brand-kit page for current usage terms; verify before commit.' as const;

/**
 * Default license-compatibility verdict for every entry. The audit is
 * planning-only and cannot legally certify brand-asset usage, so every
 * entry ships with `'unknown'` and pairs that with a non-null
 * `fallback_action`. Threshold #6 credits this combination as a
 * "documented gap" (design.md "Brand-kit URL or license sourcing failure"
 * failure mode).
 */
const LICENSE_COMPATIBILITY_DEFAULT: LicenseCompatibility = 'unknown';

/**
 * Fallback-action text emitted when `license_compatible !== true` (which is
 * the default for every audit run). A `null` here would violate Property 8
 * ("licensed-or-gapped") since the licensing rule requires a fallback when
 * compatibility is anything other than the literal `true`.
 *
 * Wording cites the recommended monogram approach from the audit's
 * "documented gap" follow-up (design.md "Brand-kit URL or license sourcing
 * failure"): if the legal-review step concludes the asset cannot ship,
 * fall back to a chain-monogram tile.
 */
const FALLBACK_ACTION_TEXT =
  'If license check fails, ship a monogram fallback labelled with the chain abbreviation.' as const;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Return the POSIX-style basename of a workspace-relative path.
 *
 * Discovery emits POSIX paths so the basename split on `/` is sufficient,
 * but using `path.posix.basename` makes the intent explicit and avoids any
 * surprise on Windows runtimes where the default `path` module uses `\`.
 */
function posixBasename(p: string): string {
  return path.posix.basename(p);
}

/**
 * Filter the discovered asset list to entries whose basename contains the
 * given chain slug, case-insensitively (per the task notes).
 *
 * Case-insensitive matching is necessary because real consumer-app assets
 * may carry capitalized basenames (e.g., `BNB.svg`, `Polygon-Logo.png`).
 * Substring matching on the basename — rather than the whole path — keeps
 * the result tight to actual icon files and ignores incidental directory
 * names elsewhere in the repository.
 *
 * The output preserves input order so renderers see the assets in
 * discovery order, which is the order Pass 1 sorts paths before returning.
 */
function filterAssetsBySlug(
  assets: readonly string[],
  slug: CanonicalChainSlug,
): readonly string[] {
  const lowerSlug = slug.toLowerCase();
  const matches: string[] = [];
  for (const asset of assets) {
    const basename = posixBasename(asset).toLowerCase();
    if (basename.includes(lowerSlug)) {
      matches.push(asset);
    }
  }
  return Object.freeze(matches);
}

/**
 * Build a single `Network_Icon` entry for one canonical chain.
 *
 * Pure: no I/O, no clock, no randomness. The returned object is deeply
 * frozen so the eight-entry plan is immutable end-to-end.
 *
 * `current_assets` filter rule: any discovered asset whose basename
 * contains the slug (case-insensitive). When no assets match, the list is
 * empty — Property 8 still passes because the entry carries a non-null
 * `fallback_action`.
 *
 * `renderer_paths`: the consumer-app renders all chain icons through a
 * shared `Network_Icon_Component` surface (per design.md "Network_Icon
 * overhaul component"), so every entry references the same renderer set.
 * The replacement plan therefore copies the discovered renderer list into
 * each entry — implementers preserving the import surface need to know
 * the full set of files to update for any chain.
 */
function buildEntry(
  config: ChainConfig,
  input: NetworkIconInput,
): Network_Icon {
  const currentAssets = filterAssetsBySlug(input.discoveredAssets, config.slug);
  const rendererPaths = Object.freeze([...input.discoveredRenderers]);

  // license_compatible defaults to 'unknown' for the audit run, so the
  // licensing rule below always picks the fallback text. The conditional
  // is written against the public contract (`license_compatible !== true`
  // ⇒ fallback required) so the code reads the same as Requirement 4.9
  // and Property 8 — when license_compatible is the literal `true`, no
  // fallback is required.
  const licenseCompatible: LicenseCompatibility = LICENSE_COMPATIBILITY_DEFAULT;
  const fallbackAction: string | null =
    licenseCompatible === true ? null : FALLBACK_ACTION_TEXT;

  return Object.freeze({
    chain_slug: config.slug,
    display_name: config.displayName,
    current_assets: currentAssets,
    renderer_paths: rendererPaths,
    brand_kit_url: config.brandKitUrl,
    license_terms: LICENSE_TERMS_PLACEHOLDER,
    license_compatible: LICENSE_COMPATIBILITY_DEFAULT,
    target_filename: `network-${config.slug}.svg`,
    target_directory: TARGET_DIRECTORY,
    fallback_action: fallbackAction,
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the eight-entry Network_Icon Replacement Plan.
 *
 * Pure: no I/O, no clock, no randomness — every input is supplied via the
 * typed `NetworkIconInput`. The return value is a frozen array of frozen
 * entries so callers can treat it as an immutable singleton for the run.
 *
 * Entry ordering is fixed at ethereum → polygon → base → arbitrum →
 * optimism → solana → bnb → avalanche to match design.md "Required
 * entries (Requirement 4.2)" and Property 8 (one entry per canonical
 * slug).
 *
 * Validates Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9.
 */
export const buildNetworkIconPlan = (
  input: NetworkIconInput,
): readonly Network_Icon[] =>
  Object.freeze(CANONICAL_CHAINS.map((config) => buildEntry(config, input)));

/**
 * The eight canonical chain slugs in canonical order. Exported so the
 * Property 8 test and downstream synthesizers can iterate the same
 * ordering without re-declaring it.
 */
export const CANONICAL_CHAIN_SLUGS: readonly CanonicalChainSlug[] = Object.freeze(
  CANONICAL_CHAINS.map((c) => c.slug),
);
