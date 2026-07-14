# Accessibility (A11Y-002)

## Target

**VeilPay consumer app targets [WCAG 2.2 Level AA](https://www.w3.org/TR/WCAG22/).**

That is the bar for money-flow screens (onboarding, home, send, receive, confirm,
settings) and for any control that moves funds, reveals secrets, or changes
security settings.

## What “AA” means for this app

| Area | Expectation |
|------|-------------|
| Perceivable | Text contrast ≥ 4.5:1 (normal) / 3:1 (large); non-text UI ≥ 3:1 |
| Operable | Touch targets ≥ 44×44 pt where practical; no keyboard-trap analogues; biometric/PIN never as the *only* unlabeled control |
| Understandable | Labels, errors, and status (live regions) describe outcomes in plain language |
| Robust | Prefer `accessibilityRole`, `accessibilityLabel`, `accessibilityHint`, and stable `testID`s so assistive tech and Maestro share the same anchors |

## Current enforcement

1. **Static CI smoke** (A11Y-001) — heuristic gate in `.github/workflows/ci.yml` that fails if too many core payment screens ship pressables with zero `accessibilityLabel`s.
2. **Screen-level labels** — money-flow screens (e.g. `SendPaymentScreen`) carry explicit labels on amount, recipient, continue, and quick actions; unit tests lock key labels in place.
3. **Design tokens** — `apps/consumer-app/src/styles/design-tokens.ts` documents WCAG contrast helpers; primary muted text was tuned to meet AA on the dark surface.

## Out of scope / residual

- Full automated WCAG audits (axe / Accessibility Scanner) are not yet in CI.
- iOS screenshot protection for seed/export is tracked separately (SEC-006).
- A complete third-party a11y audit is not a substitute for the WCAG AA *target* declared here; it remains a release process option.

## Changing the target

Any change to this target (e.g. raising to AAA, or accepting AA only for a subset of screens) must update this file and the audit remediation handoff in the same PR.
