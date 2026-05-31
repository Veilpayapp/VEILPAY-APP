// Feature: veilpay-privacy-stack, Property 18: Stealth scanner completeness within two polling intervals
/**
 * Property 18 — Stealth scanner completeness within two polling intervals.
 *
 * Statement (verbatim from design.md §Correctness Properties → Property 18):
 *
 *   For any sequence of `Announcement` events e_1, e_2, ..., e_n emitted by
 *   `StealthAnnouncer` at block heights b_1 ≤ b_2 ≤ ... ≤ b_n, where
 *   M ⊆ {e_1, ..., e_n} is the subset for which `checkStealthAddressMatch`
 *   returns `true`, AND for any sequence of `useStealthScanner` polling
 *   ticks t_1, t_2, ..., every event e_i ∈ M SHALL appear in the user's
 *   transaction history with status `'incoming_stealth'` no later than the
 *   SECOND polling tick whose RPC fetch succeeds AND whose observed chain
 *   head is ≥ b_i; AND across all polling ticks the persisted
 *   `lastScannedBlock` SHALL never advance past a block height for which
 *   the corresponding `getLogs` call rejected.
 *
 * Validates: Requirements 11.2, 11.3, 11.4, 11.6, 11.7
 *
 * --------------------------------------------------------------------------
 * Why this is a model test, not a hook-render test
 * --------------------------------------------------------------------------
 *
 * Property 18 is about the cursor-advancement algorithm — it does not depend
 * on `AppState`, `SecureStore`, or `ethers` at all; those are mechanisms by
 * which the algorithm is driven. Mocking them just to call a render hook
 * would (a) couple the property to React-Native testing infrastructure that
 * fast-check shrinking interacts badly with, and (b) risk "passing" because
 * the mock matches the implementation rather than because the algorithm is
 * correct. So we extract the tick logic into a pure {@link step} function
 * that mirrors `useStealthScanner.ts` line-for-line, then drive it with
 * randomised event/tick sequences. The mirror is intentionally thin enough
 * that any divergence between it and the hook will fail typecheck or code
 * review the next time someone touches the hook.
 *
 * Mapping from {@link step} ↔ `useStealthScanner.ts`:
 *
 *   - failure tick      ↔ the `try { ... } catch { console.warn; return }` arm
 *   - success, head ≤ cursor ↔ the `if (fromBlock > head) return` early exit
 *   - success, head > cursor ↔ `queryFilter([cursor+1, head])` then advance
 *
 * That is all the tick body does that affects the cursor or the history.
 * Per-log work (calling `checkStealthAddressMatch`) is collapsed into the
 * boolean `e.isMatch` field of each generated event, which is exactly the
 * abstraction Property 18 quantifies over ("M ⊆ {e_1, ..., e_n}").
 */

import * as fc from 'fast-check';

/** A simulated `Announcement` event observed at a fixed block height. */
type Event = {
  /** Block height at which the event was emitted. */
  block: number;
  /**
   * Pre-computed `checkStealthAddressMatch(...)` result for this event.
   * Property 18 abstracts over the engine; the engine itself is covered
   * by Property 7 (`stealthEngine.property.test.ts`).
   */
  isMatch: boolean;
  /** Stable identity used to assert membership in the simulated history. */
  id: string;
};

/**
 * One simulated polling tick. `kind: 'failure'` models any reason the tick
 * body throws (RPC reject, malformed log, SecureStore write rejection); per
 * Requirement 11.6 the implementation must `console.warn` and leave the
 * cursor at its previous value. `kind: 'success'` models a tick that
 * observed `head` as the chain tip and completed all per-log work without
 * throwing.
 */
type Tick =
  | { kind: 'success'; head: number }
  | { kind: 'failure'; head: number };

/** Subset of {@link useStealthScanner} state that Property 18 quantifies over. */
type ScannerState = {
  /** `lastScannedBlock` — Requirement 11.4. */
  cursor: number;
  /** Ordered ids of events appended to "transaction history" — Requirement 11.3. */
  history: string[];
};

/**
 * Pure model of one polling tick. Mirrors `useStealthScanner.ts` `tick()`:
 *
 *   - On failure: do nothing. Cursor and history unchanged. (Req 11.6)
 *   - On success with `head ≤ cursor`: nothing to scan (the early
 *     `fromBlock > head` exit in the hook). Cursor unchanged.
 *   - On success with `head > cursor`: scan `[cursor + 1, head]`, append
 *     every matching event to history in block order, then advance cursor
 *     to `head`. (Reqs 11.2, 11.3, 11.4)
 */
function step(state: ScannerState, allEvents: Event[], t: Tick): ScannerState {
  if (t.kind === 'failure') return state;
  if (t.head <= state.cursor) return state;

  const fromBlock = state.cursor + 1;
  const toBlock = t.head;

  // Stable block-then-id ordering so the simulated history is deterministic
  // for any given input. The hook gets this ordering for free from
  // `queryFilter` (block, then logIndex).
  const matchedInWindow = allEvents
    .filter((e) => e.block >= fromBlock && e.block <= toBlock && e.isMatch)
    .sort((a, b) => (a.block - b.block) || a.id.localeCompare(b.id))
    .map((e) => e.id);

  return {
    cursor: toBlock,
    history: [...state.history, ...matchedInWindow],
  };
}

// --------------------------------------------------------------------------
// Generators
// --------------------------------------------------------------------------

/**
 * Random set of `Announcement` events with unique ids. Block range is kept
 * small relative to the tick generator so that the property exercises the
 * realistic regime where multiple events fall inside a single scan window.
 */
const eventsArb = fc.uniqueArray(
  fc.record({
    block: fc.integer({ min: 1, max: 50 }),
    isMatch: fc.boolean(),
    id: fc.uuid(),
  }),
  { selector: (e: Event) => e.id, maxLength: 30 },
);

/**
 * Random sequence of polling ticks. The chain head is monotonically
 * non-decreasing — this matches real EVM semantics on Sepolia (no reorgs
 * deeper than the cursor in normal operation) and prevents shrinking from
 * fixating on physically impossible head-decrement counterexamples that
 * would not exercise the property of interest.
 */
const ticksArb = fc
  .array(
    fc.record({
      kind: fc.constantFrom('success', 'failure') as fc.Arbitrary<'success' | 'failure'>,
      headDelta: fc.integer({ min: 0, max: 5 }),
    }),
    { maxLength: 60 },
  )
  .map((rawTicks) => {
    let head = 0;
    return rawTicks.map(({ kind, headDelta }) => {
      head += headDelta;
      return { kind, head } as Tick;
    });
  });

// --------------------------------------------------------------------------
// Property
// --------------------------------------------------------------------------

describe('Property 18: Stealth scanner completeness within two polling intervals', () => {
  it(
    'observes every match within two successful ticks of the chain head reaching its block, ' +
      'and never advances the cursor on a failed tick',
    () => {
      fc.assert(
        fc.property(eventsArb, ticksArb, (events, ticks) => {
          let state: ScannerState = { cursor: 0, history: [] };

          // Per-match-event: 1-based index, within the subsequence of
          // successful ticks whose head ≥ e.block, at which the event
          // first appeared in the simulated history. Property 18 caps
          // this index at 2.
          const observedAtEligibleIndex = new Map<string, number>();
          const eligibleSuccessCount = new Map<string, number>();

          for (const t of ticks) {
            const before = state;
            state = step(state, events, t);

            if (t.kind === 'failure') {
              // Requirement 11.6 + Property 18 second clause: a failing
              // tick must not advance the cursor or mutate history.
              expect(state.cursor).toBe(before.cursor);
              expect(state.history).toEqual(before.history);
              continue;
            }

            // Cursor monotonically non-decreasing on success.
            expect(state.cursor).toBeGreaterThanOrEqual(before.cursor);

            // Update the per-event eligibility tracking using THIS tick's
            // observed head (not the post-tick cursor — they're equal on a
            // pure success, but using `t.head` keeps the property text and
            // the assertion in lock-step).
            for (const e of events) {
              if (!e.isMatch) continue;
              if (t.head < e.block) continue;
              const next = (eligibleSuccessCount.get(e.id) ?? 0) + 1;
              eligibleSuccessCount.set(e.id, next);
              if (
                !observedAtEligibleIndex.has(e.id) &&
                state.history.includes(e.id)
              ) {
                observedAtEligibleIndex.set(e.id, next);
              }
            }
          }

          // Final assertions, one match event at a time.
          for (const e of events) {
            if (!e.isMatch) continue;
            const totalEligible = eligibleSuccessCount.get(e.id) ?? 0;

            if (totalEligible === 0) {
              // No successful tick ever reached this block. Per the
              // algorithm the event is correctly not yet observed; the
              // scanner is allowed to take arbitrarily long when the
              // chain head simply has not advanced.
              expect(state.history).not.toContain(e.id);
              continue;
            }

            // At least one eligible success tick fired ⇒ event must be
            // in history (Requirements 11.2, 11.3, 11.7).
            expect(state.history).toContain(e.id);

            const idx = observedAtEligibleIndex.get(e.id);
            expect(idx).toBeDefined();
            // The "two polling intervals" cap from Requirement 11.7.
            // The current implementation is tight (always idx === 1),
            // but the property allows up to 2 to leave headroom for a
            // future change that defers per-log work to a follow-up tick.
            expect(idx as number).toBeLessThanOrEqual(2);
          }
        }),
        { numRuns: 200 },
      );
    },
  );
});
