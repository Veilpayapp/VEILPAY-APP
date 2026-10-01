/**
 * Veilpay — Circuit Artifact Configuration (bundled-first, pinned)
 *
 * Build-time configuration for the Groth16 circuit artifacts consumed by
 * `ZkpProver` (the WebView-hosted snarkjs bridge) and any pre-flight checks
 * in `usePaymentTransaction` / privacy-stack guards.
 *
 * The artifacts are produced by `packages/circuits/compile.sh`:
 *   - `withdraw.wasm`         — circuit witness generator
 *   - `withdraw_final.zkey`   — proving key (post powers-of-tau + beacon)
 * and, for the prover code itself:
 *   - `snarkjs.min.js`        — the snarkjs 0.7.2 UMD (pinned CDN download)
 *
 * SOURCE MODES (Task "Prover off the CDN"):
 *   - RELEASE (`!__DEV__` / NODE_ENV=production): the artifact source is the
 *     **bundled local assets** staged under `apps/consumer-app/assets/circuits/`
 *     (staged by `scripts/stage-circuit-assets.js`, digest-verified). Remote
 *     artifact URLs are NOT used — there is no remote-by-default fetch, and
 *     the integrity pins below are MANDATORY (fail closed when empty or when
 *     an env override does not match the baked digests).
 *   - DEV: remote URLs remain the source, supplied via Expo public env vars
 *     (`EXPO_PUBLIC_CIRCUIT_WASM_URL` / `EXPO_PUBLIC_CIRCUIT_ZKEY_URL`), and
 *     pinning stays REQUIRED-IF-CONFIGURED (relaxed) so local dev builds that
 *     configure only URLs do not regress.
 *
 * PINS: the SHA-256 digests of the staged artifacts and the snarkjs SRI hash
 * are baked below as code defaults (`BAKED_*`). Env vars can override them
 * (e.g. a deliberately rotated circuit), but in RELEASE an override that does
 * not match the baked digest throws — see `assertCircuitIntegrityPinned`.
 *
 * Public inputs: [merkleRoot, nullifierHash, recipient, amount, token] —
 * see packages/circuits/docs/CIRCUIT_SECURITY.md.
 *
 * @see ../components/ZkpProver.tsx
 * @see ../../assets/circuits/README.md
 * @see ../../scripts/stage-circuit-assets.js
 * @see ../hooks/usePaymentTransaction.ts
 * @see Requirement 9.1 — Real Circuit Artifacts in ZkpProver
 */

/**
 * True when running in a release/production bundle: the Metro release build
 * inlines `__DEV__` as `false` and sets NODE_ENV=production, and a plain
 * NODE_ENV=production run (e.g. CI) is treated as release as well. Everything
 * release-only in this module keys off this flag.
 */
const DEV_FLAG: boolean =
  typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';
export const IS_RELEASE_BUILD: boolean =
  !DEV_FLAG || process.env.NODE_ENV === 'production';

// ---------------------------------------------------------------------------
// Baked integrity pins (code defaults; env vars may override — release
// requires the effective values to equal these).
//
// Reproduce with:
//   sha256sum apps/consumer-app/assets/circuits/withdraw.wasm
//   sha256sum apps/consumer-app/assets/circuits/withdraw_final.zkey
//   sha256sum apps/consumer-app/assets/circuits/snarkjs.min.js
//   openssl dgst -sha384 -binary snarkjs.min.js | openssl base64 -A
// scripts/stage-circuit-assets.js re-verifies every staged byte against these
// and fails closed on mismatch.
// ---------------------------------------------------------------------------

/** SHA-256 of the staged `withdraw.wasm` (witness generator). */
export const BAKED_CIRCUIT_WASM_SHA256 =
  '4292cc33840274ba8bbd9ce19fb5f2b371215af23d8e184b57824654ad9835a8';

/** SHA-256 of the staged `withdraw_final.zkey` (proving key). */
export const BAKED_CIRCUIT_ZKEY_SHA256 =
  '2269a668ed5076dcb3fbcacd58613ba796d6231ab85a71b4f613bcbb6b5898b3';

/** SHA-256 of the pinned snarkjs 0.7.2 UMD (`snarkjs.min.js`). */
export const BAKED_SNARKJS_SHA256 =
  'ed55d1f120a0333de24a8b632737e3244331e819d7d6411d75b3c0b0a91ea9ac';

/** SRI integrity hash (sha384, base64) of the pinned snarkjs 0.7.2 UMD. */
export const BAKED_SNARKJS_SRI =
  'sha384-GKtjkchdpNyrZRMyv1vJbvxxe5DWCz50yHyXQkbRumBABaTfx7yBR5fAGk6pUD//';

/**
 * URL of the compiled circuit WASM (`withdraw.wasm`) — DEV remote source only.
 *
 * Sourced from `process.env.EXPO_PUBLIC_CIRCUIT_WASM_URL` at bundle time.
 * Falls back to an empty string when the env var is unset; an empty value
 * MUST cause the dev privacy-flow pre-flight (`assertCircuitConfigured`) to
 * throw a configuration error rather than silently producing a 404 from
 * `snarkjs.groth16.fullProve`. RELEASE does not use this URL at all (the
 * source is the bundled local asset), so an unset value there is fine.
 */
export const CIRCUIT_WASM_URL: string =
  (process.env.EXPO_PUBLIC_CIRCUIT_WASM_URL as string | undefined) ?? '';

/**
 * URL of the proving key (`withdraw_final.zkey`) — DEV remote source only.
 * See {@link CIRCUIT_WASM_URL} for the release/dev split.
 */
export const CIRCUIT_ZKEY_URL: string =
  (process.env.EXPO_PUBLIC_CIRCUIT_ZKEY_URL as string | undefined) ?? '';

/**
 * Effective SHA-256 hex digest pin for `withdraw.wasm`.
 *
 * RELEASE default: the baked digest above (pinned). DEV default: empty
 * string, preserving the historical REQUIRED-IF-CONFIGURED behavior so dev
 * builds that configured only the artifact URLs do not regress. In both
 * modes `EXPO_PUBLIC_CIRCUIT_WASM_SHA256` overrides; in release the override
 * must equal the baked digest or the prover fails closed
 * (`assertCircuitIntegrityPinned`).
 */
export const CIRCUIT_WASM_SHA256: string = IS_RELEASE_BUILD
  ? (process.env.EXPO_PUBLIC_CIRCUIT_WASM_SHA256 as string | undefined) ??
    BAKED_CIRCUIT_WASM_SHA256
  : (process.env.EXPO_PUBLIC_CIRCUIT_WASM_SHA256 as string | undefined) ?? '';

/**
 * Effective SHA-256 hex digest pin for `withdraw_final.zkey`.
 * See {@link CIRCUIT_WASM_SHA256} for the release/dev default split.
 */
export const CIRCUIT_ZKEY_SHA256: string = IS_RELEASE_BUILD
  ? (process.env.EXPO_PUBLIC_CIRCUIT_ZKEY_SHA256 as string | undefined) ??
    BAKED_CIRCUIT_ZKEY_SHA256
  : (process.env.EXPO_PUBLIC_CIRCUIT_ZKEY_SHA256 as string | undefined) ?? '';

/**
 * SRI integrity hash (sha384, base64) for the snarkjs UMD. In dev the WebView
 * applies it natively to the CDN `<script>`; in release the UMD is bundled
 * locally and this pin is asserted at configuration level instead (the bytes
 * themselves are digest-verified at stage time by the staging script).
 * Default: the baked SRI above (env override: `EXPO_PUBLIC_SNARKJS_SRI`).
 */
export const SNARKJS_SRI: string =
  (process.env.EXPO_PUBLIC_SNARKJS_SRI as string | undefined) ?? BAKED_SNARKJS_SRI;

/**
 * Where the prover's artifacts come from in this build.
 *  - `'bundled-local'` (release): assets/circuits/* bundled by Metro.
 *  - `'remote'` (dev with URLs set): the EXPO_PUBLIC_CIRCUIT_*_URL hosts.
 *  - `'unconfigured'` (dev without URLs): the dev pre-flight throws.
 */
export type CircuitArtifactSource = 'bundled-local' | 'remote' | 'unconfigured';
export const CIRCUIT_ARTIFACT_SOURCE: CircuitArtifactSource = IS_RELEASE_BUILD
  ? 'bundled-local'
  : CIRCUIT_WASM_URL !== '' && CIRCUIT_ZKEY_URL !== ''
    ? 'remote'
    : 'unconfigured';

/**
 * RELEASE-only mandatory pin enforcement. Throws when the effective
 * SNARKJS_SRI / CIRCUIT_WASM_SHA256 / CIRCUIT_ZKEY_SHA256 values are empty or
 * do not match the digests baked above (which also covers an env override
 * pointing at different bytes). Dev is a no-op — remote + relaxed checks
 * remain allowed there.
 *
 * @throws Error with code `CIRCUIT_PINS_NOT_ENFORCED` in release builds whose
 *         pins are unpinned or re-pinned away from the baked defaults.
 */
export function assertCircuitIntegrityPinned(): void {
  if (!IS_RELEASE_BUILD) {
    return;
  }
  const problems: string[] = [];
  if (CIRCUIT_WASM_SHA256 !== BAKED_CIRCUIT_WASM_SHA256) {
    problems.push(
      `EXPO_PUBLIC_CIRCUIT_WASM_SHA256 (empty or "${CIRCUIT_WASM_SHA256}" != baked "${BAKED_CIRCUIT_WASM_SHA256}")`
    );
  }
  if (CIRCUIT_ZKEY_SHA256 !== BAKED_CIRCUIT_ZKEY_SHA256) {
    problems.push(
      `EXPO_PUBLIC_CIRCUIT_ZKEY_SHA256 (empty or "${CIRCUIT_ZKEY_SHA256}" != baked "${BAKED_CIRCUIT_ZKEY_SHA256}")`
    );
  }
  if (SNARKJS_SRI !== BAKED_SNARKJS_SRI) {
    problems.push(
      `EXPO_PUBLIC_SNARKJS_SRI (empty or "${SNARKJS_SRI}" != baked "${BAKED_SNARKJS_SRI}")`
    );
  }
  if (problems.length > 0) {
    const err = new Error(
      `Release build integrity pins are mandatory and none may be empty or re-pinned away from the digests baked in src/constants/circuit.ts: ${problems.join(
        '; '
      )}. Stage the pinned artifacts with apps/consumer-app/scripts/stage-circuit-assets.js (see apps/consumer-app/assets/circuits/README.md) or update the baked pins deliberately when rotating the circuit.`
    );
    (err as Error & { code?: string }).code = 'CIRCUIT_PINS_NOT_ENFORCED';
    throw err;
  }
}

/**
 * Throws a typed, human-readable error when the privacy flow cannot run in
 * this build. Intended to be called as a pre-flight guard at the start of any
 * `'max'`-privacy payment flow (and from `ZkpProver` before injecting the
 * `PROVE` script) so misconfigured builds fail loudly instead of appearing to
 * "hang" inside the WebView.
 *
 * RELEASE: the artifact source is the bundled local assets, so "configured"
 * means the integrity pins are present and match the baked digests
 * ({@link assertCircuitIntegrityPinned}).
 *
 * DEV: the source is remote, so "configured" means both artifact URLs are set.
 * The SHA-256 pins stay REQUIRED-IF-CONFIGURED: when both URLs and both
 * hashes are present the integrity check is enforced (in the WebView PROVE
 * script); when the hashes are absent we proceed with URL-only fetch rather
 * than disabling the whole privacy feature for a build that previously worked.
 *
 * @throws Error with code `CIRCUIT_NOT_CONFIGURED` (dev, missing URLs) or
 *         `CIRCUIT_PINS_NOT_ENFORCED` (release, missing/overridden pins).
 */
export function assertCircuitConfigured(): void {
  if (IS_RELEASE_BUILD) {
    // Fail closed on unpinned/overridden pins; the local asset files
    // themselves are a Metro build requirement (staged by the staging script).
    assertCircuitIntegrityPinned();
    return;
  }
  const missing: string[] = [];
  if (CIRCUIT_WASM_URL === '') missing.push('EXPO_PUBLIC_CIRCUIT_WASM_URL');
  if (CIRCUIT_ZKEY_URL === '') missing.push('EXPO_PUBLIC_CIRCUIT_ZKEY_URL');
  if (missing.length > 0) {
    const err = new Error(
      `Privacy circuit artifacts are not configured. Missing env var(s): ${missing.join(
        ', '
      )}. Set them in the Expo build environment to the public URLs of withdraw.wasm and withdraw_final.zkey produced by packages/circuits/compile.sh. (Optional: pin each artifact with its SHA-256 digest via EXPO_PUBLIC_CIRCUIT_WASM_SHA256 / EXPO_PUBLIC_CIRCUIT_ZKEY_SHA256 to enable integrity verification.)`
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
  if (IS_RELEASE_BUILD) {
    return (
      CIRCUIT_WASM_SHA256 === BAKED_CIRCUIT_WASM_SHA256 &&
      CIRCUIT_ZKEY_SHA256 === BAKED_CIRCUIT_ZKEY_SHA256 &&
      SNARKJS_SRI === BAKED_SNARKJS_SRI
    );
  }
  return CIRCUIT_WASM_URL !== '' && CIRCUIT_ZKEY_URL !== '';
}
