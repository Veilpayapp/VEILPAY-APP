# VeilPay UI Audit & UI Match Plan

After auditing the full app against the Stitch projects, I have identified a critical inconsistency: **The current codebase is a "Frankenstein" mix.** The developer set up the `design-tokens.ts` based on **"The Sovereign Minimalist"** (the design system for the vast majority of the app), but actually implemented the entire UI using **NeoPopCard** and **NeoPopButton** components. 

The Stitch designs mandate two distinct visual languages:
1. **The Sovereign Minimalist (Core App):** Total lack of borders, extreme scale (Manrope), use of negative space, and tonal layering (no shadows).
2. **Tactical Privacy & NeoPop Precision (Transak Screens):** Brutalist, heavy 2px black borders with 4px/6px offsets, pill-shaped buttons, monospace numbers.

To match the Stitch UI *exactly*, we must decouple these systems. Here is the phased plan:

---

## Phase 1: Foundation & Component Architecture
Before touching the screens, we must build the correct primitives.
- **Refine Design Tokens**: Ensure `Manrope` (Headers) and `Inter` (Body) are correctly wired for the Sovereign Minimalist, and `Space Grotesk / JetBrainsMono` is reserved for data and the Transak NeoPop screens.
- **NeoPop Overhaul**: Fix `NeoPopCard` and `NeoPopButton` to match the exact NeoPop spec (1rem rugged borders for cards, 9999px pill-shape for primary buttons, exact `#000000` 2px borders, proper 4px/6px translations).
- **Create Sovereign Components**: Build `SovereignCard` and `SovereignButton` to replace NeoPop usage in all non-Transak screens. These will enforce the "No Borders" rule and use pure tonal layering (`#201F1F` on `#131313`).

## Phase 2: Transak Screens Integration (Tactical NeoPop)
Apply the fixed NeoPop components strictly to the fiat on/off ramps.
- **Target Screens**: `DepositCryptoScreen.tsx`, `WithdrawFiatScreen.tsx`.
- **Modifications**: 
  - Fix the main card backgrounds to `#131313`.
  - Implement the "Well" input effect (`backgroundColor: '#0e0e0e'` with 2px inner border).
  - Use extreme `56px` display text for the amount inputs and apply strict uppercase tracking for labels.
  - Remove all 1px dividers on quick amount pills, using correct offset buttons instead.

## Phase 3: Core App Migration (The Sovereign Minimalist)
Transition all existing core screens away from NeoPop toward the intended design.
- **Target Screens**: `HomeDashboardScreen.tsx`, `CreateWalletScreen.tsx`, `ImportWalletScreen.tsx`, `SendPaymentScreen.tsx`, etc.
- **Modifications**:
  - Replace all `NeoPopCard` wrappers with `SovereignCard` (solid blocks of `#201f1f` with no shadows/borders).
  - Replace all `NeoPopButton` usage with `SovereignButton`.
  - Strip away NeoPop offset styles from internal structures (like the chain selector, action rows, and transaction cards).
  - Enforce the "No-Line Rule": Rely completely on spacing and background color shifts to separate content.
  - Update typography bounds to match the minimal editorial look.

## Phase 4: Polish & Review
- Verify all accessibility targets.
- Ensure screen transitions and interaction states match their parent design language (Linear stiff easing for Sovereign; Physical depression for NeoPop).
