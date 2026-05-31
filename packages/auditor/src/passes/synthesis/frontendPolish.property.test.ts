/**
 * Property-based test for `Frontend_Polish_Plan` token + surface coverage.
 *
 * Feature: production-readiness-audit, Property 9:
 *   For any successful audit run, the `Frontend_Polish_Plan` SHALL contain a
 *   typography scale where every entry has a name and a positive integer
 *   pixel size; a spacing system where every entry has a name and a non-
 *   negative integer pixel value; a motion table containing entries for at
 *   least screen transitions, button presses, modal entry, and modal exit,
 *   each with a duration in milliseconds and an easing curve; pattern
 *   entries (empty, loading, error) for each of the wallet, invoice,
 *   transaction history, and merchant dashboard surfaces; a WCAG 2.1 Level
 *   AA target with verified-screens list; a dark mode parity definition
 *   with non-parity gap list; and haptic entries for payment confirmation,
 *   payment failure, copy-to-clipboard, and pull-to-refresh.
 *
 * Validates: Requirements 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9
 *
 * Strategy:
 *   - A `fast-check` arbitrary builds `FrontendPolishPlanInput` values
 *     drawing the three caller-supplied arrays (verifiedScreens,
 *     unverifiedScreens, darkModeGaps) from a small alphabet of
 *     screen-shaped strings. The generator covers empty arrays, single
 *     entries, and overlapping screens so the property exercises the
 *     defensive-copy + pass-through behavior the synthesizer documents.
 *   - For every generated input, `buildFrontendPolishPlan` is invoked and
 *     its result is asserted against the structural invariants Property 9
 *     enumerates: typography names + positive integer px sizes; spacing
 *     names + non-negative integer px values; motion coverage of the four
 *     required interactions plus list / haptic-paired animations, each
 *     with a positive integer duration_ms and a non-empty easing curve;
 *     state pattern coverage of exactly the four required surfaces; AA
 *     contrast + touch-target thresholds with verified/unverified screen
 *     pass-through; dark-mode parity definition non-empty plus gap pass-
 *     through; and haptic entries for the four required interactions.
 *   - Default fast-check run count (100) is sufficient — the synthesizer
 *     is pure and the inventory inputs are small.
 */

import * as fc from 'fast-check';

import { buildFrontendPolishPlan, type FrontendPolishPlanInput } from './frontendPolish';

// ---------------------------------------------------------------------------
// Required coverage sets — Requirements 5.5, 5.6, 5.9.
// ---------------------------------------------------------------------------

/**
 * Motion interactions Property 9 requires the table to cover at minimum
 * (Requirement 5.5). The synthesizer ships eight entries; the property only
 * asserts these four are present plus the list-enter/exit and success/
 * failure haptic-paired animations enumerated in design.md.
 */
const REQUIRED_MOTION_INTERACTIONS = [
  'screen-transition',
  'button-press',
  'modal-entry',
  'modal-exit',
  'list-item-enter',
  'list-item-exit',
  'success-haptic-paired',
  'failure-haptic-paired',
] as const;

/**
 * Surfaces Property 9 requires `state_patterns` to cover exactly
 * (Requirement 5.6).
 */
const REQUIRED_STATE_SURFACES = [
  'wallet',
  'invoice',
  'transaction_history',
  'merchant_dashboard',
] as const;

/**
 * Haptic interactions Property 9 requires entries for (Requirement 5.9).
 */
const REQUIRED_HAPTIC_INTERACTIONS = [
  'payment-confirmation',
  'payment-failure',
  'copy-to-clipboard',
  'pull-to-refresh',
] as const;

/** Authoring reference fixed by Requirement 5.2. */
const AUTHORING_REFERENCE_PATH =
  '.agents/anthropics-skills/skills/frontend-design/SKILL.md';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Screen-name arbitrary: a small alphabet of plausible Consumer_App and
 * Frontend_App screen identifiers. The synthesizer treats these strings
 * opaquely (they pass through into the rendered Markdown), so the
 * generator stays small to keep counter-examples readable.
 */
const arbScreenName: fc.Arbitrary<string> = fc.constantFrom(
  'wallet/home',
  'wallet/send',
  'wallet/receive',
  'invoice/create',
  'invoice/detail',
  'transaction/history',
  'transaction/detail',
  'merchant/dashboard',
  'merchant/api-keys',
  'auth/sign-in',
  'auth/sign-up',
  'settings/security',
  'settings/preferences',
);

/**
 * Arbitrary array of screen names with bounded length. `minLength: 0`
 * exercises the empty-array arm (no screens verified yet); the upper
 * bound stays small so failing counter-examples are easy to read.
 */
const arbScreenList: fc.Arbitrary<readonly string[]> = fc.array(arbScreenName, {
  minLength: 0,
  maxLength: 6,
});

/**
 * Full input arbitrary. All three fields are optional in the production
 * type; the generator always supplies arrays so the pass-through
 * assertions can compare exact contents. The default-empty-array branch
 * is exercised separately by a unit test below.
 */
const arbInput: fc.Arbitrary<FrontendPolishPlanInput> = fc.record({
  verifiedScreens: arbScreenList,
  unverifiedScreens: arbScreenList,
  darkModeGaps: arbScreenList,
});

/**
 * Helper: assert `value` is a positive integer (strictly greater than 0).
 * Encoded as a function so the failure message is uniform across the
 * typography and motion arms.
 */
const expectPositiveInteger = (value: number, label: string): void => {
  expect(Number.isInteger(value)).toBe(true);
  expect(value).toBeGreaterThan(0);
  // The above two checks imply the third, but keeping it explicit makes
  // the counter-example output unambiguous.
  expect(value).toBeGreaterThanOrEqual(1);
  if (!(Number.isInteger(value) && value > 0)) {
    throw new Error(`${label} must be a positive integer, received ${value}`);
  }
};

/**
 * Helper: assert `value` is a non-negative integer (>= 0). Used by the
 * spacing-system arm where the smallest token is `space-0` with value 0.
 */
const expectNonNegativeInteger = (value: number, label: string): void => {
  expect(Number.isInteger(value)).toBe(true);
  expect(value).toBeGreaterThanOrEqual(0);
  if (!(Number.isInteger(value) && value >= 0)) {
    throw new Error(`${label} must be a non-negative integer, received ${value}`);
  }
};

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Frontend_Polish_Plan token and surface coverage (Property 9)', () => {
  it('every generated input yields a plan satisfying Property 9', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const plan = buildFrontendPolishPlan(input);

        // -----------------------------------------------------------------
        // Authoring reference — Requirement 5.2.
        //
        // The plan must cite the Anthropic frontend-design skill verbatim
        // so the renderer can link back to the source.
        // -----------------------------------------------------------------
        expect(plan.authoring_reference).toBe(AUTHORING_REFERENCE_PATH);
        expect(plan.authoring_summary.length).toBeGreaterThan(0);

        // -----------------------------------------------------------------
        // Typography scale — Requirement 5.3.
        //
        // Property 9 only requires "name + positive integer px size", but
        // the design.md schema documents `line_height_px`, `weight`, and
        // `family` as well. We assert the full schema so the property
        // would catch a regression that strips any of those fields.
        // -----------------------------------------------------------------
        expect(plan.typography_scale.length).toBeGreaterThanOrEqual(6);
        const typographyNames = new Set<string>();
        for (const token of plan.typography_scale) {
          expect(typeof token.name).toBe('string');
          expect(token.name.length).toBeGreaterThan(0);
          // Names are unique so the renderer can address tokens by name
          // without ambiguity.
          expect(typographyNames.has(token.name)).toBe(false);
          typographyNames.add(token.name);

          expectPositiveInteger(token.font_size_px, `${token.name}.font_size_px`);
          expectPositiveInteger(token.line_height_px, `${token.name}.line_height_px`);
          expectPositiveInteger(token.weight, `${token.name}.weight`);
          expect(['display', 'body']).toContain(token.family);
        }

        // -----------------------------------------------------------------
        // Spacing system — Requirement 5.4.
        //
        // Base-4 scale `space-0..space-12` ⇒ exactly 13 tokens. Values are
        // non-negative integers (the smallest is `space-0` = 0).
        // -----------------------------------------------------------------
        expect(plan.spacing_system.length).toBe(13);
        const spacingNames = new Set<string>();
        for (const token of plan.spacing_system) {
          expect(typeof token.name).toBe('string');
          expect(token.name.length).toBeGreaterThan(0);
          expect(spacingNames.has(token.name)).toBe(false);
          spacingNames.add(token.name);

          expectNonNegativeInteger(token.value_px, `${token.name}.value_px`);
        }
        // Spot-check the canonical naming so a renamed token (e.g.,
        // `spacing-0` vs `space-0`) trips the property.
        for (let i = 0; i < 13; i += 1) {
          expect(spacingNames.has(`space-${i}`)).toBe(true);
        }

        // -----------------------------------------------------------------
        // Motion table — Requirement 5.5.
        //
        // Property 9 requires the four core interactions plus the list /
        // haptic-paired animations enumerated in design.md. Every entry
        // must have a positive integer duration_ms and a non-empty
        // easing curve.
        // -----------------------------------------------------------------
        const motionInteractions = new Set(plan.motion.map((m) => m.interaction));
        for (const required of REQUIRED_MOTION_INTERACTIONS) {
          expect(motionInteractions.has(required)).toBe(true);
        }
        for (const entry of plan.motion) {
          expect(typeof entry.interaction).toBe('string');
          expect(entry.interaction.length).toBeGreaterThan(0);
          expectPositiveInteger(entry.duration_ms, `${entry.interaction}.duration_ms`);
          expect(typeof entry.easing).toBe('string');
          expect(entry.easing.length).toBeGreaterThan(0);
        }

        // -----------------------------------------------------------------
        // State patterns — Requirement 5.6.
        //
        // Exactly the four required surfaces, each with non-empty empty /
        // loading / error copy.
        // -----------------------------------------------------------------
        expect(plan.state_patterns.length).toBe(REQUIRED_STATE_SURFACES.length);
        const stateSurfaces = plan.state_patterns.map((p) => p.surface).sort();
        expect(stateSurfaces).toEqual([...REQUIRED_STATE_SURFACES].sort());
        for (const pattern of plan.state_patterns) {
          expect(pattern.empty.length).toBeGreaterThan(0);
          expect(pattern.loading.length).toBeGreaterThan(0);
          expect(pattern.error.length).toBeGreaterThan(0);
        }

        // -----------------------------------------------------------------
        // Accessibility target — Requirement 5.7.
        //
        // WCAG 2.1 AA thresholds are fixed; verified / unverified screen
        // lists pass through from the input.
        // -----------------------------------------------------------------
        expect(plan.accessibility.contrast_normal_min).toBe(4.5);
        expect(plan.accessibility.contrast_large_min).toBe(3);
        expect(plan.accessibility.touch_target_pt_min).toBe(44);
        expect([...plan.accessibility.verified_screens]).toEqual([
          ...(input.verifiedScreens ?? []),
        ]);
        expect([...plan.accessibility.unverified_screens]).toEqual([
          ...(input.unverifiedScreens ?? []),
        ]);

        // -----------------------------------------------------------------
        // Dark-mode parity — Requirement 5.8.
        //
        // Definition is a non-empty plain-language statement; gaps pass
        // through from the input.
        // -----------------------------------------------------------------
        expect(plan.dark_mode_parity.definition.length).toBeGreaterThan(0);
        expect([...plan.dark_mode_parity.gaps]).toEqual([
          ...(input.darkModeGaps ?? []),
        ]);

        // -----------------------------------------------------------------
        // Haptics — Requirement 5.9.
        //
        // Exactly the four required interactions, each with a non-empty
        // pattern name.
        // -----------------------------------------------------------------
        const hapticInteractions = new Set(plan.haptics.map((h) => h.interaction));
        for (const required of REQUIRED_HAPTIC_INTERACTIONS) {
          expect(hapticInteractions.has(required)).toBe(true);
        }
        for (const entry of plan.haptics) {
          expect(typeof entry.pattern).toBe('string');
          expect(entry.pattern.length).toBeGreaterThan(0);
        }
      }),
    );
  });

  it('omitting input fields defaults the screen and gap lists to empty arrays', () => {
    // Exercises the default-empty-array branch the production-input
    // type documents. Kept as a non-property test because the input
    // arbitrary above always supplies arrays.
    const plan = buildFrontendPolishPlan();
    expect(plan.accessibility.verified_screens).toEqual([]);
    expect(plan.accessibility.unverified_screens).toEqual([]);
    expect(plan.dark_mode_parity.gaps).toEqual([]);
  });
});
