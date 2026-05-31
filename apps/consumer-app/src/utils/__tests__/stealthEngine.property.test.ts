// Feature: veilpay-privacy-stack, Property 7: Stealth ECDH round-trip
/**
 * Property 7 — Stealth ECDH round-trip.
 *
 * For any recipient secp256k1 keypair `(spendingPriv, spendingPub, viewingPriv, viewingPub)`
 * produced by `generateStealthKeyPair()` and any subsequent
 * `deriveStealthAddress(viewingPub, spendingPub) → (stealthAddress, ephemeralPubKey)`:
 *
 *   1. `checkStealthAddressMatch(stealthAddress, ephemeralPubKey, viewingPriv, spendingPub)` ⇒ `true`.
 *   2. The derived `stealthAddress` matches `^0x[0-9a-fA-F]{40}$` and is non-zero.
 *   3. `checkStealthAddressMatch(stealthAddress, ephemeralPubKey, K2.viewingPriv, K2.spendingPub)` ⇒ `false`
 *      for any independently generated keypair `K2`.
 *
 * See:
 *   - `.kiro/specs/veilpay-privacy-stack/design.md` §Correctness Properties → Property 7
 *   - `.kiro/specs/veilpay-privacy-stack/requirements.md` §Requirement 10 (clauses 10.3, 10.4, 10.5, 10.6)
 *
 * Validates: Requirements 10.3, 10.4, 10.5, 10.6
 *
 * Iteration count is 25 because each run does four scalar-multiplications and three
 * keypair generations — proof generation is not involved here, but secp256k1 ops are
 * still measurably non-trivial under jest-expo's transformed module graph.
 */

import fc from 'fast-check';

import {
  checkStealthAddressMatch,
  deriveStealthAddress,
  generateStealthKeyPair,
} from '../stealthEngine';

const EVM_ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`.toLowerCase();

describe('Property 7: Stealth ECDH round-trip', () => {
  it(
    'derives a valid non-zero EVM address, returns true for the matching keypair, and false for any independent keypair',
    () => {
      // The keypair RNG is non-deterministic by design (it pulls from `crypto.getRandomValues`),
      // so the fast-check arbitrary is just a token that drives iteration count. Shrinking
      // would not give us a smaller secp256k1 keypair anyway — the property is universal over
      // the curve, not over the seed.
      fc.assert(
        fc.property(fc.integer(), () => {
          const recipient = generateStealthKeyPair();
          const stranger = generateStealthKeyPair();

          const { stealthAddress, ephemeralPubKey } = deriveStealthAddress(
            recipient.viewingPub,
            recipient.spendingPub,
          );

          // Requirement 10.6 — derived stealth address is a well-formed EVM address.
          expect(stealthAddress).toMatch(EVM_ADDRESS_REGEX);
          // ...and non-zero. A zero address would mean the keccak prefix collided with all-zeros,
          // which is cryptographically negligible but still worth asserting because a buggy
          // slice or hex-decode would reproduce it deterministically.
          expect(stealthAddress.toLowerCase()).not.toBe(ZERO_ADDRESS);

          // Requirements 10.3 & 10.5 — round-trip succeeds for the matching viewing key.
          const matchPositive = checkStealthAddressMatch(
            stealthAddress,
            ephemeralPubKey,
            recipient.viewingKey,
            recipient.spendingPub,
          );
          expect(matchPositive).toBe(true);

          // Requirement 10.4 — match must fail for an independently generated keypair.
          // We swap BOTH halves (viewingKey + spendingPub) to model a wholly unrelated recipient;
          // keeping one half from `recipient` would not exercise the negative path cleanly.
          const matchNegative = checkStealthAddressMatch(
            stealthAddress,
            ephemeralPubKey,
            stranger.viewingKey,
            stranger.spendingPub,
          );
          expect(matchNegative).toBe(false);
        }),
        { numRuns: 25 },
      );
    },
    // Generous timeout — 25 iterations × (3 keygen + 1 derive + 2 match) secp256k1 ops.
    60_000,
  );
});
