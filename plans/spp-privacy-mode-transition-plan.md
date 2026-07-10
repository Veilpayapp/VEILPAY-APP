# Privacy mode switch animation

> **Status (2026-07-10):** Implemented on Home (Moti keyed crossfade + Reanimated
> FadeIn/ZoomIn on balance badge and quick actions). Pure UI — does not wait for
> poolOps. Tune timings after first real shield on device if needed.

## Goal

When the user selects **pXLM** (or another privacy asset) from Home / Token Selector, the Home surface should **visually transition** into private mode — not a hard cut between public balance chrome and shielded chrome.

## Design principles

- Match existing Home motion: **Moti spring** + **Reanimated** (see `HomeDashboardScreen` stagger delays).
- Keep it **subtle-sick**, not gimmicky: short duration, interruptible, no blocking network.
- One accent language: gold shield/lock, “PRIVATE” chip, not a full theme flip.
- Works offline (pure UI); setup/signing stays invisible background work.

## Proposed sequence (~450–600 ms)

| Step | What | Motion |
|------|------|--------|
| 0 | User taps pXLM in **[ PRIVACY ]** | Haptic light |
| 1 | Chain selector card | Crossfade label `XLM` → `pXLM · PRIVATE`; optional 1px accent border pulse |
| 2 | Balance card | Layout morph: public balance → shielded; **SHIELDED** badge scale-in; feature chips fade-in staggered |
| 3 | Quick actions | Crossfade **SEND/RECEIVE** → **SHIELD/TRANSFER/UNSHIELD** with icon swap (shared element feel via Moti) |
| 4 | Assets list | Privacy row highlight; public XLM row dim slightly |

Reverse when **PUBLIC** / deselect privacy asset.

## Implementation sketch (later)

1. `privacyMode` already drives Home — wrap balance + actions in `AnimatePresence` / keyed MotiView with `key={privacyMode ? 'private' : 'public'}`.
2. Optional shared transition: `react-native-reanimated` `FadeIn` / `FadeOut` / `LinearTransition` on cards.
3. Micro: accent **hazard/tape** flash (1 frame) matching Receive privacy notice language — optional, easy to kill.
4. Do **not** animate the Token Selector list itself; animate only **Home** after selection returns.

## Out of scope for this polish

- Splash or full-screen “entering privacy”
- Sound
- Blocking UI until onboard RPC finishes

## When to build

After: native leaf + insert + at least one real shield on testnet. Then this is pure delight on a working path.
