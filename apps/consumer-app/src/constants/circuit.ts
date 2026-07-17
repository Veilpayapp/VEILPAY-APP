/**
 * VeilPay — Circuit Artifact URLs
 *
 * Build-time configuration for the Groth16 circuit artifacts consumed by
 * `ZkpProver` (the WebView-hosted snarkjs bridge) and any pre-flight checks
 * in `usePaymentTransaction` / privacy-stack guards.
 *
 * The two artifacts are produced by `packages/circuits/compile.sh`:
 *   - `withdraw.wasm`         — circuit witness generator
 *   - `withdraw_final.zkey`   — proving key (post powers-of-tau + beacon)
 *
 * They MUST be served from a host the mobile WebView can reach. URLs are
 * supplied at bundle time via Expo public env vars so they are statically
 * inlined and visible to `process.env.*` reads from the JS runtime:
 *
 *   EXPO_PUBLIC_CIRCUIT_WASM_URL = https://<your-cdn>/withdraw.wasm
 *   EXPO_PUBLIC_CIRCUIT_ZKEY_URL = https://<your-cdn>/withdraw_final.zkey
 *
 * If either env var is unset, the corresponding constant falls back to an
 * empty string. `assertCircuitConfigured()` exists so callers can fail fast
 * with a clear configuration error rather than letting `snarkjs.groth16
 * .fullProve` blow up later with an opaque 404 from a relative URL fetch.
 *
 * Public inputs: [merkleRoot, nullifierHash, recipient, amount, token] —
 * see packages/circuits/docs/CIRCUIT_SECURITY.md.
 *
 * @see ../components/ZkpProver.tsx
 * @see ../hooks/usePaymentTransaction.ts
 * @see Requirement 9.1 — Real Circuit Artifacts in ZkpProver
 */

/**
 * URL of the compiled circuit WASM (`withdraw.wasm`).
 *
 * Sourced from `process.env.EXPO_PUBLIC_CIRCUIT_WASM_URL` at bundle time.
 * Falls back to an empty string when the env var is unset; an empty value
 * MUST cause the privacy-flow pre-flight (`assertCircuitConfigured`) to
 * throw a configuration error rather than silently producing a 404 from
 * `snarkjs.groth16.fullProve`.
 */
export const CIRCUIT_WASM_URL: string =
  (process.env.EXPO_PUBLIC_CIRCUIT_WASM_URL as string | undefined) ?? '';

/**
 * URL of the proving key (`withdraw_final.zkey`).
 *
 * Sourced from `process.env.EXPO_PUBLIC_CIRCUIT_ZKEY_URL` at bundle time.
 * Falls back to an empty string when the env var is unset; an empty value
 * MUST cause the privacy-flow pre-flight (`assertCircuitConfigured`) to
 * throw a configuration error rather than silently producing a 404 from
 * `snarkjs.groth16.fullProve`.
 */
export const CIRCUIT_ZKEY_URL: string =
  (process.env.EXPO_PUBLIC_CIRCUIT_ZKEY_URL as string | undefined) ?? '';

/**
 * Throws a typed, human-readable error if either circuit artifact URL is
 * unconfigured. Intended to be called as a pre-flight guard at the start of
 * any `'max'`-privacy payment flow (and from `ZkpProver` before injecting
 * the `PROVE` script) so misconfigured builds fail loudly instead of
 * appearing to "hang" inside the WebView.
 *
 * @throws Error with code `CIRCUIT_NOT_CONFIGURED` when either URL is empty.
 */
export function assertCircuitConfigured(): void {
  if (CIRCUIT_WASM_URL === '' || CIRCUIT_ZKEY_URL === '') {
    const missing: string[] = [];
    if (CIRCUIT_WASM_URL === '') missing.push('EXPO_PUBLIC_CIRCUIT_WASM_URL');
    if (CIRCUIT_ZKEY_URL === '') missing.push('EXPO_PUBLIC_CIRCUIT_ZKEY_URL');
    const err = new Error(
      `Privacy circuit artifacts are not configured. Missing env var(s): ${missing.join(
        ', '
      )}. Set them in the Expo build environment to the public URLs of withdraw.wasm and withdraw_final.zkey produced by packages/circuits/compile.sh.`
    );
    (err as Error & { code?: string }).code = 'CIRCUIT_NOT_CONFIGURED';
    throw err;
  }
}

/**
 * Non-throwing variant of {@link assertCircuitConfigured}. Useful for UI
 * gating (e.g. disabling the "max privacy" option on the privacy-level
 * screen) where we want a boolean instead of an exception.
 */
export function isCircuitConfigured(): boolean {
  return CIRCUIT_WASM_URL !== '' && CIRCUIT_ZKEY_URL !== '';
}
