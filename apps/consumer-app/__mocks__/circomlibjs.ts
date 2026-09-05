/**
 * Jest manual mock for circomlibjs.
 *
 * The real circomlibjs package exists (hoisted at the monorepo root) but its
 * transitive dependency `ffjavascript` is not installed in this test
 * environment, so `buildPoseidon` cannot be loaded by Jest. This mock provides
 * a deterministic stand-in so `nullifierHashValidation` (SEC-004) can load and
 * its behavior can be tested without the heavy WASM/BN254 dependency.
 *
 * The mock preserves the real module's contract:
 *   - buildPoseidon() resolves (asynchronously) to a callable hasher
 *   - hasher(inputs: bigint[]) returns a bigint < 2^256
 *   - the hash is a pure function of its inputs: equal inputs yield equal
 *     outputs, and distinct inputs yield distinct outputs (bijective mod 2^256)
 *
 * Because the hash is a function of the BigInt *values*, the case-insensitive
 * hex behavior of `hexToBigInt` (0xAB.. vs 0xab.. parse to the same value)
 * naturally produces matching hashes — same as the real Poseidon.
 */

const MASK = (1n << 256n) - 1n;

/**
 * Deterministic Poseidon stand-in.
 * Single-input calls are a bijection mod 2^256 (odd multiplier + additive
 * offset), then avalanched with an XOR-fold (bijective) and one more odd
 * multiplication — so distinct nullifiers always produce distinct hashes.
 */
function poseidon(inputs: bigint[]): bigint {
  const A = 0x9e3779b97f4a7c15f39cc0605cedc835n; // odd -> invertible mod 2^256
  const B = 0x6a09e667f3bcc908b2fb1366ea957d3en;

  let h = 0x243f6a8885a308d313198a2e03707344n;
  for (const input of inputs) {
    h = (h * A + B + input) & MASK;
  }

  // Final avalanche: XOR-fold by half the width, then multiply by an odd
  // constant (bijective mod 2^256).
  h ^= h >> 128n;
  h = (h * 0x100000001b3n) & MASK;
  return h;
}

export const buildPoseidon = jest.fn(
  (): Promise<(inputs: bigint[]) => bigint> => Promise.resolve(poseidon)
);
