/**
 * Pass 3 — Synthesis: Frontend_Polish_Plan builder.
 *
 * Pure (no I/O) factory that emits the `Frontend_Polish_Plan` section of the
 * `Audit_Report`. The plan documents the typography, spacing, motion, state,
 * accessibility, dark-mode, and haptic conventions the Consumer_App and
 * Frontend_App surfaces must converge on before production sign-off.
 *
 * Authoring reference:
 *   `.agents/anthropics-skills/skills/frontend-design/SKILL.md` — Anthropic's
 *   frontend-design skill, cited per Requirement 5.2. The skill argues for a
 *   distinctive display font paired with a refined body font, intentional
 *   color/motion choices, and high-impact moments over scattered micro-
 *   interactions; that guidance shapes the typography pairing, motion table,
 *   and state pattern recommendations encoded below.
 *
 * Mirrors design.md "Frontend_Polish_Plan component":
 *   - Typography scale with named tokens + px size + line-height + weight.
 *   - Base-4 spacing scale `space-0..space-12`.
 *   - Motion table covering screen transitions, button presses, modal entry/
 *     exit, list enter/exit, and success/failure haptic-paired animations.
 *   - State patterns (empty / loading / error) for wallet, invoice,
 *     transaction history, and merchant dashboard surfaces.
 *   - WCAG 2.1 Level AA accessibility target (>= 4.5:1 normal text, >= 3:1
 *     large text, >= 44pt touch target) plus verified / unverified screen
 *     lists.
 *   - Dark-mode parity definition plus an explicit non-parity gap list.
 *   - Haptic patterns for payment confirmation, payment failure, copy-to-
 *     clipboard, and pull-to-refresh.
 *
 * Validates Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9.
 * Property 9 (token + surface coverage) is exercised by the companion test
 * in task 4.12.
 */

import type {
  AccessibilityTarget,
  DarkModeParity,
  FrontendPolishPlan,
  HapticEntry,
  MotionEntry,
  SpacingToken,
  StatePatternEntry,
  TypographyToken,
} from '../../models';

// ---------------------------------------------------------------------------
// Authoring reference — Anthropic frontend-design skill (Requirement 5.2).
// ---------------------------------------------------------------------------

/**
 * Path to the Anthropic frontend-design skill that authored the conventions
 * encoded below. Cited verbatim by the Audit_Report renderer.
 */
const AUTHORING_REFERENCE =
  '.agents/anthropics-skills/skills/frontend-design/SKILL.md' as const;

/**
 * One-line summary of the cited skill, surfaced as the section's authoring
 * note (Requirement 5.2).
 */
const AUTHORING_SUMMARY =
  'Distinctive display + refined body typography pairing with motion-rich, accessible state patterns.' as const;

// ---------------------------------------------------------------------------
// Typography scale — 7 tokens (Requirement 5.3).
//
// Pairs a distinctive `display` family (display-xl, display-lg) with a
// refined `body` family (heading-md, body-md, body-sm, caption, mono),
// matching the frontend-design skill's "distinctive display + refined body"
// guidance. Sizes follow a 4-px-aligned modular scale; line heights are
// chosen for comfortable mobile reading.
// ---------------------------------------------------------------------------

const TYPOGRAPHY_SCALE: readonly TypographyToken[] = Object.freeze([
  Object.freeze({
    name: 'display-xl',
    font_size_px: 48,
    line_height_px: 56,
    weight: 700,
    family: 'display',
  }) as TypographyToken,
  Object.freeze({
    name: 'display-lg',
    font_size_px: 36,
    line_height_px: 44,
    weight: 700,
    family: 'display',
  }) as TypographyToken,
  Object.freeze({
    name: 'heading-md',
    font_size_px: 24,
    line_height_px: 32,
    weight: 600,
    family: 'body',
  }) as TypographyToken,
  Object.freeze({
    name: 'body-md',
    font_size_px: 16,
    line_height_px: 24,
    weight: 400,
    family: 'body',
  }) as TypographyToken,
  Object.freeze({
    name: 'body-sm',
    font_size_px: 14,
    line_height_px: 20,
    weight: 400,
    family: 'body',
  }) as TypographyToken,
  Object.freeze({
    name: 'caption',
    font_size_px: 12,
    line_height_px: 16,
    weight: 500,
    family: 'body',
  }) as TypographyToken,
  Object.freeze({
    name: 'mono',
    font_size_px: 14,
    line_height_px: 20,
    weight: 500,
    family: 'body',
  }) as TypographyToken,
]) as readonly TypographyToken[];

// ---------------------------------------------------------------------------
// Spacing system — `space-0..space-12` on a base-4 scale (Requirement 5.4).
// Values: 0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96.
// ---------------------------------------------------------------------------

/**
 * The 13 spacing values in pixel units, declared once so the token names and
 * values are colocated and auditable. Property 9 enforces non-negative integer
 * values; this array is `as const` so the literal types flow through.
 */
const SPACING_VALUES_PX = [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96] as const;

const SPACING_SYSTEM: readonly SpacingToken[] = Object.freeze(
  SPACING_VALUES_PX.map(
    (value, index): SpacingToken =>
      Object.freeze({
        name: `space-${index}`,
        value_px: value,
      }) as SpacingToken,
  ),
) as readonly SpacingToken[];

// ---------------------------------------------------------------------------
// Motion table — 8 entries (Requirement 5.5).
//
// Covers: screen transitions, button presses, modal entry/exit, list item
// enter/exit, success/failure haptic-paired animations. Durations and easing
// follow Material Design / iOS HIG conventions adapted for the frontend-design
// skill's emphasis on high-impact moments.
// ---------------------------------------------------------------------------

const MOTION_TABLE: readonly MotionEntry[] = Object.freeze([
  Object.freeze({
    interaction: 'screen-transition',
    duration_ms: 300,
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
  }) as MotionEntry,
  Object.freeze({
    interaction: 'button-press',
    duration_ms: 120,
    easing: 'ease-out',
  }) as MotionEntry,
  Object.freeze({
    interaction: 'modal-entry',
    duration_ms: 250,
    easing: 'ease-out',
  }) as MotionEntry,
  Object.freeze({
    interaction: 'modal-exit',
    duration_ms: 200,
    easing: 'ease-in',
  }) as MotionEntry,
  Object.freeze({
    interaction: 'list-item-enter',
    duration_ms: 220,
    easing: 'ease-out',
  }) as MotionEntry,
  Object.freeze({
    interaction: 'list-item-exit',
    duration_ms: 180,
    easing: 'ease-in',
  }) as MotionEntry,
  Object.freeze({
    interaction: 'success-haptic-paired',
    duration_ms: 320,
    easing: 'ease-out',
  }) as MotionEntry,
  Object.freeze({
    interaction: 'failure-haptic-paired',
    duration_ms: 260,
    easing: 'ease-out',
  }) as MotionEntry,
]) as readonly MotionEntry[];

// ---------------------------------------------------------------------------
// State patterns — 4 surfaces (Requirement 5.6).
// Wallet, Invoice, Transaction History, Merchant Dashboard.
// ---------------------------------------------------------------------------

const STATE_PATTERNS: readonly StatePatternEntry[] = Object.freeze([
  Object.freeze({
    surface: 'wallet',
    empty:
      'Illustrated zero-balance card with a primary CTA to fund the wallet and a secondary link to receive funds.',
    loading:
      'Skeleton balance row plus three skeleton token rows; preserve layout dimensions to avoid jank when data resolves.',
    error:
      'Inline error banner with retry affordance; preserve last-known balance dimmed to 60% opacity until retry succeeds.',
  }) as StatePatternEntry,
  Object.freeze({
    surface: 'invoice',
    empty:
      'Centered prompt encouraging the merchant to create their first invoice with a primary CTA opening the creation form.',
    loading:
      'Skeleton header with amount placeholder and skeleton metadata rows; spinner reserved for confirmation steps only.',
    error:
      'Full-width error state with the failed action, a retry button, and a contextual link to invoice troubleshooting docs.',
  }) as StatePatternEntry,
  Object.freeze({
    surface: 'transaction_history',
    empty:
      'Friendly illustration plus copy explaining transactions appear here once funds move; secondary CTA to fund the wallet.',
    loading:
      'Five skeleton list rows with avatar, title, and trailing-amount placeholders; respects list-item-enter motion when rows resolve.',
    error:
      'Inline list error with retry; preserve any cached rows above the error banner so users keep historical context.',
  }) as StatePatternEntry,
  Object.freeze({
    surface: 'merchant_dashboard',
    empty:
      'Onboarding checklist tile guiding new merchants through API key creation, first invoice, and webhook configuration.',
    loading:
      'Skeleton metric tiles for revenue, settled invoices, and pending invoices; charts replaced by shimmer placeholders.',
    error:
      'Per-tile error state isolates failures so unrelated metrics keep rendering; global retry surfaces only when every tile fails.',
  }) as StatePatternEntry,
]) as readonly StatePatternEntry[];

// ---------------------------------------------------------------------------
// Accessibility target — WCAG 2.1 AA (Requirement 5.7).
// Contrast 4.5:1 normal / 3:1 large; touch target >= 44pt.
// ---------------------------------------------------------------------------

/**
 * Build the AccessibilityTarget. `verified_screens` and `unverified_screens`
 * are caller-supplied so the Pass 3 orchestrator can plug in audit-time
 * inventories; defaults are empty arrays (no screens verified yet).
 */
const buildAccessibilityTarget = (
  verifiedScreens: readonly string[],
  unverifiedScreens: readonly string[],
): AccessibilityTarget =>
  Object.freeze({
    contrast_normal_min: 4.5,
    contrast_large_min: 3,
    touch_target_pt_min: 44,
    verified_screens: Object.freeze([...verifiedScreens]) as readonly string[],
    unverified_screens: Object.freeze([...unverifiedScreens]) as readonly string[],
  });

// ---------------------------------------------------------------------------
// Dark mode parity (Requirement 5.8).
// ---------------------------------------------------------------------------

const DARK_MODE_DEFINITION =
  'Every screen present in light mode is reachable, legible, and visually equivalent in dark mode, including illustrations, charts, and brand imagery.' as const;

/**
 * Build the DarkModeParity entry. Caller passes the audit-time gap list;
 * default is an empty list (parity assumed complete absent contrary evidence).
 */
const buildDarkModeParity = (gaps: readonly string[]): DarkModeParity =>
  Object.freeze({
    definition: DARK_MODE_DEFINITION,
    gaps: Object.freeze([...gaps]) as readonly string[],
  });

// ---------------------------------------------------------------------------
// Haptics — 4 entries (Requirement 5.9).
// Payment confirmation, payment failure, copy-to-clipboard, pull-to-refresh.
// Pattern names follow Expo Haptics / iOS UIFeedbackGenerator conventions.
// ---------------------------------------------------------------------------

const HAPTICS: readonly HapticEntry[] = Object.freeze([
  Object.freeze({
    interaction: 'payment-confirmation',
    pattern: 'notificationSuccess',
  }) as HapticEntry,
  Object.freeze({
    interaction: 'payment-failure',
    pattern: 'notificationError',
  }) as HapticEntry,
  Object.freeze({
    interaction: 'copy-to-clipboard',
    pattern: 'impactLight',
  }) as HapticEntry,
  Object.freeze({
    interaction: 'pull-to-refresh',
    pattern: 'selection',
  }) as HapticEntry,
]) as readonly HapticEntry[];

// ---------------------------------------------------------------------------
// Public factory.
// ---------------------------------------------------------------------------

/**
 * Optional input overrides for the Frontend_Polish_Plan factory. The Pass 3
 * orchestrator passes audit-time inventories captured during Pass 1/2; tests
 * and standalone callers can omit the input to receive a plan with empty
 * inventories.
 */
export interface FrontendPolishPlanInput {
  /** Screens currently verified against the WCAG 2.1 AA target. */
  readonly verifiedScreens?: readonly string[];
  /** Screens not yet verified against the WCAG 2.1 AA target. */
  readonly unverifiedScreens?: readonly string[];
  /** Screens lacking dark-mode parity at audit time. */
  readonly darkModeGaps?: readonly string[];
}

/**
 * Return the canonical Frontend_Polish_Plan section for the Audit_Report.
 *
 * Pure: no I/O, no clock, no randomness. Token tables, motion table, state
 * patterns, and haptics are deeply frozen module-level constants; the only
 * caller-supplied data is the verified/unverified screen lists and the dark-
 * mode gap list, which are defensively copied before being frozen.
 *
 * Validates Requirements 5.1 (section presence), 5.2 (authoring reference),
 * 5.3 (typography scale), 5.4 (spacing system), 5.5 (motion table), 5.6
 * (state patterns for the four required surfaces), 5.7 (WCAG 2.1 AA target
 * + verified-screens list), 5.8 (dark-mode parity definition + gaps), and
 * 5.9 (haptic entries for the four required interactions).
 */
export const buildFrontendPolishPlan = (
  input?: FrontendPolishPlanInput,
): FrontendPolishPlan => {
  const verifiedScreens = input?.verifiedScreens ?? [];
  const unverifiedScreens = input?.unverifiedScreens ?? [];
  const darkModeGaps = input?.darkModeGaps ?? [];

  return Object.freeze({
    authoring_reference: AUTHORING_REFERENCE,
    authoring_summary: AUTHORING_SUMMARY,
    typography_scale: TYPOGRAPHY_SCALE,
    spacing_system: SPACING_SYSTEM,
    motion: MOTION_TABLE,
    state_patterns: STATE_PATTERNS,
    accessibility: buildAccessibilityTarget(verifiedScreens, unverifiedScreens),
    dark_mode_parity: buildDarkModeParity(darkModeGaps),
    haptics: HAPTICS,
  });
};
