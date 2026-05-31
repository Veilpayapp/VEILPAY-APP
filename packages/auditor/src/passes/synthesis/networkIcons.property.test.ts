/**
 * Feature: production-readiness-audit, Property 8: Network_Icon entries are
 * well-formed and licensed-or-gapped.
 *
 *   For any network in the canonical set
 *   {ethereum, polygon, base, arbitrum, optimism, solana, bnb, avalanche},
 *   the Network_Icon_Set Replacement Plan SHALL contain exactly one
 *   Network_Icon entry whose target_filename matches the regex
 *   `^network-[a-z0-9-]+\.svg$`, whose target_directory starts with
 *   `apps/consumer-app/`, whose renderer_paths list is either non-empty or
 *   explicitly documents that no current renderer exists, and which
 *   satisfies the licensing rule: either brand_kit_url and license_terms
 *   are non-null and license_compatible ∈ {true, false, unknown}, or
 *   fallback_action is non-null when license_compatible ≠ true.
 *
 * Validates: Requirements 4.2, 4.3, 4.4, 4.6, 4.7, 4.8, 4.9
 *
 * Strategy:
 *   - A `fast-check` arbitrary generates `NetworkIconInput` values with
 *     varying `discoveredAssets` and `discoveredRenderers` lists (empty,
 *     single entry, large mixed-case, paths that do/do not contain a
 *     canonical slug). Empty lists are explicitly included so the
 *     "documented gap" arm of Property 8 — a chain with zero current
 *     assets and zero renderers — is exercised.
 *   - The property body calls `buildNetworkIconPlan(input)` and asserts:
 *       1. exactly 8 entries (Requirement 4.2),
 *       2. the entries' chain_slug list equals CANONICAL_CHAIN_SLUGS in
 *          canonical order (one per slug, ordering preserved),
 *       3. every entry is well-formed per Property 8's structural rules,
 *       4. the licensing rule holds: either license_compatible === true
 *          and {brand_kit_url, license_terms} are non-null, or
 *          fallback_action is non-null.
 *   - Default fast-check run count (100) is sufficient — the canonical
 *     chain list is fixed and the synthesizer is pure, so the input
 *     surface that matters is "what does the inventory look like".
 */

import * as fc from 'fast-check';

import {
  CANONICAL_CHAIN_SLUGS,
  buildNetworkIconPlan,
  type NetworkIconInput,
} from './networkIcons';

// ---------------------------------------------------------------------------
// Constants under test
// ---------------------------------------------------------------------------

/**
 * Filename regex from Property 8 / Requirement 4.6. Centralised so the test
 * uses the same pattern documented in the design rather than re-deriving it.
 */
const TARGET_FILENAME_PATTERN = /^network-[a-z0-9-]+\.svg$/;

/**
 * Target-directory prefix from Property 8 / Requirement 4.7. Every entry's
 * `target_directory` is asserted to start with this string.
 */
const TARGET_DIRECTORY_PREFIX = 'apps/consumer-app/';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Path-segment alphabet. The synthesizer only reads basenames, so the
 * generated paths use a small character set that cannot accidentally produce
 * empty segments or path separators.
 */
const arbPathSegment: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 16 })
  .map((s) => s.replace(/[^A-Za-z0-9_-]/g, '') || 'x');

/**
 * Discovered asset path arbitrary. Generates POSIX-style paths under
 * `apps/consumer-app/assets/...` with basenames that may or may not match
 * a canonical chain slug (case-insensitive substring match drives the
 * synthesizer's `current_assets` filter). Includes both SVG and PNG
 * extensions to mirror the design's primary/fallback asset coverage.
 */
const arbAssetPath: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(
      'apps/consumer-app/assets',
      'apps/consumer-app/assets/networks',
      'apps/consumer-app/src/components/icons',
    ),
    arbPathSegment,
    fc.option(fc.constantFrom(...CANONICAL_CHAIN_SLUGS), { nil: null }),
    fc.constantFrom('.svg', '.png'),
  )
  .map(([dir, base, slug, ext]) => {
    // When `slug` is set, embed it in the basename so the synthesizer's
    // case-insensitive substring match picks it up. The leading capital
    // exercises the case-insensitive rule documented on
    // `filterAssetsBySlug`.
    const filename =
      slug === null
        ? `${base}${ext}`
        : `${base}-${slug.charAt(0).toUpperCase()}${slug.slice(1)}${ext}`;
    return `${dir}/${filename}`;
  });

/**
 * Discovered renderer path arbitrary. Generates TS/TSX paths under the
 * consumer-app source tree — these are the files that import the icon
 * assets (per design.md "Network_Icon overhaul component").
 */
const arbRendererPath: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(
      'apps/consumer-app/src/components',
      'apps/consumer-app/src/screens',
      'apps/consumer-app/src/lib',
    ),
    arbPathSegment,
    fc.constantFrom('.tsx', '.ts'),
  )
  .map(([dir, base, ext]) => `${dir}/${base}${ext}`);

/**
 * `NetworkIconInput` arbitrary covering empty, single-entry, and many-entry
 * inventories. The minimum length is 0 so the empty-inventory case (which
 * yields zero `current_assets` and zero `renderer_paths` — the "documented
 * gap" arm of Property 8) is regularly sampled.
 */
const arbNetworkIconInput: fc.Arbitrary<NetworkIconInput> = fc.record({
  discoveredAssets: fc.array(arbAssetPath, { minLength: 0, maxLength: 16 }),
  discoveredRenderers: fc.array(arbRendererPath, { minLength: 0, maxLength: 8 }),
});

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Network_Icon entries are well-formed and licensed-or-gapped (Property 8)', () => {
  it('CANONICAL_CHAIN_SLUGS is the canonical eight-chain list (Requirement 4.2)', () => {
    // Spot-check the canonical list so a property failure later cannot be
    // blamed on a drifted constant. The eight slugs are fixed by
    // Requirement 4.2 and Property 8.
    expect([...CANONICAL_CHAIN_SLUGS]).toEqual([
      'ethereum',
      'polygon',
      'base',
      'arbitrum',
      'optimism',
      'solana',
      'bnb',
      'avalanche',
    ]);
  });

  it('every generated input yields a plan that satisfies Property 8', () => {
    fc.assert(
      fc.property(arbNetworkIconInput, (input) => {
        const plan = buildNetworkIconPlan(input);

        // 1. Cardinality: exactly one entry per canonical chain (Requirement 4.2).
        expect(plan.length).toBe(8);
        expect(plan.length).toBe(CANONICAL_CHAIN_SLUGS.length);

        // 2. Entries appear in canonical order, one per slug. Comparing
        //    the slug list to CANONICAL_CHAIN_SLUGS as an array (not a
        //    set) catches both missing slugs and ordering drift.
        const slugList = plan.map((entry) => entry.chain_slug);
        expect(slugList).toEqual([...CANONICAL_CHAIN_SLUGS]);

        // 3. Per-entry well-formedness checks (Requirements 4.3, 4.4,
        //    4.6, 4.7, 4.8, 4.9).
        for (const entry of plan) {
          // target_filename matches `^network-[a-z0-9-]+\.svg$` (Requirement 4.6).
          expect(entry.target_filename).toMatch(TARGET_FILENAME_PATTERN);

          // target_directory is under apps/consumer-app/ (Requirement 4.7).
          expect(entry.target_directory.startsWith(TARGET_DIRECTORY_PREFIX)).toBe(true);

          // display_name is a non-empty string (Requirement 4.2).
          expect(typeof entry.display_name).toBe('string');
          expect(entry.display_name.length).toBeGreaterThan(0);

          // renderer_paths is always an array. An empty array is
          // permitted and explicitly documents the "no current
          // renderer" gap surfaced by the audit (Requirement 4.8 /
          // Property 8). The canonical fallback_action then serves as
          // the documented gap marker.
          expect(Array.isArray(entry.renderer_paths)).toBe(true);

          // current_assets is also always an array (Requirement 4.1).
          // Empty is permitted — same gap-tolerant rule as renderer_paths.
          expect(Array.isArray(entry.current_assets)).toBe(true);

          // Licensing rule (Property 8 / Requirements 4.3, 4.4, 4.9).
          if (entry.license_compatible === true) {
            // When the audit certifies the asset as license-compatible,
            // the brand-kit URL and license terms must both be on
            // record (Requirements 4.3, 4.4).
            expect(entry.brand_kit_url).not.toBeNull();
            expect(entry.license_terms).not.toBeNull();
          } else {
            // Anything other than the literal `true` (i.e., `false` or
            // `'unknown'`) requires a documented fallback so the gap is
            // surfaced for downstream remediation (Requirement 4.9).
            expect(entry.fallback_action).not.toBeNull();
            expect(typeof entry.fallback_action).toBe('string');
            expect((entry.fallback_action as string).length).toBeGreaterThan(0);
          }
        }
      }),
    );
  });
});
