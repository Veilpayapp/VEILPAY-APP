// Public inputs: [merkleRoot, nullifierHash, recipient, amount, token] — see design.md §Public input ordering contract
//
// Veilpay — ZkpProver (WebView snarkjs bridge)
// ============================================
//
// This component runs `snarkjs.groth16.fullProve` inside an off-thread
// React Native WebView so that the heavy WASM workload does not block the
// JS thread (and so the Hermes engine, which lacks a usable WebAssembly
// runtime, never has to touch the prover at all).
//
// postMessage protocol (formalized so RN side can typecheck — see
// design.md §`apps/consumer-app/src/components/ZkpProver.tsx`):
//
//   | type            | direction       | payload                                     |
//   |-----------------|-----------------|---------------------------------------------|
//   | READY           | WebView → RN    | {} — snarkjs UMD has loaded                 |
//   | PROVE           | RN → WebView    | { inputs: ProveInputs }                     |
//   | PROOF_SUCCESS   | WebView → RN    | { proof, publicSignals }                    |
//   | PROOF_ERROR     | WebView → RN    | { error: string }                           |
//
// On `PROVE`, the WebView pre-flights the artifact sources with `fetch` so a
// failure surfaces as a `PROOF_ERROR` rather than as an opaque WASM stream
// failure inside `fullProve`. It then calls
// `snarkjs.groth16.fullProve(inputs, wasmSource, zkeySource)`
// and posts the resulting `{ proof, publicSignals }` back as
// `PROOF_SUCCESS`. Any throw from `fullProve` (or from either pre-flight
// fetch, or from the SHA-256 integrity check) is mapped to
// `PROOF_ERROR { error }`.
//
// Artifact sources — release vs dev (Task "Prover off the CDN")
// --------------------------------------------------------------
// RELEASE (`IS_RELEASE_BUILD`): every byte the prover needs is BUNDLED.
//   - snarkjs UMD: the `snarkjs.min.umd` Metro asset (staged under
//     `assets/circuits/`, digest-pinned) is read as text and inlined into
//     the WebView HTML — the prover executes NO remote code.
//   - withdraw.wasm / withdraw_final.zkey: Metro assets resolved through
//     expo-asset to `file://` local URIs, fetched by the WebView from the
//     same file origin (Android: `allowFileAccess*` props below).
//   - Integrity pins are MANDATORY (`assertCircuitConfigured` →
//     `assertCircuitIntegrityPinned` throws on empty/overridden pins) and
//     the wasm/zkey bytes are SHA-256-verified inside the WebView before
//     `fullProve` runs. Any failure (missing staged assets, pin mismatch,
//     file fetch blocked) fails CLOSED — there is NO remote fallback.
// DEV: unchanged behavior — snarkjs UMD from the pinned jsdelivr CDN URL
//   (SRI-pinned by default) and wasm/zkey from the
//   `EXPO_PUBLIC_CIRCUIT_*_URL` hosts, with REQUIRED-IF-CONFIGURED pin
//   checks, so local builds keep working exactly as before.

import React, {
  useRef,
  useImperativeHandle,
  forwardRef,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import {
  CIRCUIT_WASM_URL,
  CIRCUIT_ZKEY_URL,
  CIRCUIT_WASM_SHA256,
  CIRCUIT_ZKEY_SHA256,
  SNARKJS_SRI,
  IS_RELEASE_BUILD,
  assertCircuitConfigured,
} from '../constants/circuit';
import { useWalletStore } from '../stores/walletStore';

// ---------------------------------------------------------------------------
// Snarkjs UMD source (DEV remote path)
// ---------------------------------------------------------------------------
//
// Pinned to snarkjs@0.7.2 to match the `^0.7.2` entry in
// `apps/consumer-app/package.json`. Override at build time with
// `EXPO_PUBLIC_SNARKJS_URL` if a self-hosted copy is preferred. RELEASE
// ignores this URL entirely — the UMD is inlined from the bundled
// `assets/circuits/snarkjs.min.umd` asset (see `loadLocalCircuitArtifacts`).
const DEFAULT_SNARKJS_CDN_URL =
  'https://cdn.jsdelivr.net/npm/snarkjs@0.7.2/build/snarkjs.min.js';
const SNARKJS_CDN_URL: string =
  (process.env.EXPO_PUBLIC_SNARKJS_URL as string | undefined) ??
  DEFAULT_SNARKJS_CDN_URL;
// SRI integrity hash for the dev CDN `<script>` (native WebView SRI
// enforcement rejects a tampered UMD before it executes). Defaults to the
// digest baked in constants/circuit.ts (see BAKED_SNARKJS_SRI there);
// override/disable via EXPO_PUBLIC_SNARKJS_SRI.

// Upper bound (ms) a single `generateProof` may run before it is treated as
// a stall. Real proofs over WASM take tens of seconds (Groth16 + pre-flight
// fetch + SHA-256 integrity checks), so this is deliberately generous; it
// exists to bound the truly-ungraded cases (READY never fires, a dead
// WebView, or a hung UMD load) rather than to interrupt normal proofs.
// Overridable for tests via `EXPO_PUBLIC_ZKP_PROOF_TIMEOUT_MS`.
const PROOF_TIMEOUT_MS: number = Number(
  process.env.EXPO_PUBLIC_ZKP_PROOF_TIMEOUT_MS as string | undefined
) || 120_000;

// ---------------------------------------------------------------------------
// Local (bundled) circuit artifacts — RELEASE path
// ---------------------------------------------------------------------------

/** The three bytes the release prover needs, resolved to on-device files. */
type LocalCircuitArtifacts = {
  /** `file://` URI of the downloaded `withdraw.wasm` Metro asset. */
  wasmUri: string;
  /** `file://` URI of the downloaded `withdraw_final.zkey` Metro asset. */
  zkeyUri: string;
  /** snarkjs UMD source text (script-closer escaped) to inline in the HTML. */
  snarkjsSource: string;
  /** `file://` directory containing the assets — the WebView `baseUrl`. */
  baseDirUri: string;
};

/**
 * A literal `</script` anywhere inside an inline `<script>` block would
 * terminate the block early, so escape it. Inside JS string literals,
 * regexes and comments `<\/script` is semantically identical, so this
 * cannot change what the UMD does. (The pinned snarkjs 0.7.2 build contains
 * zero occurrences today — verified at stage time — this is defense in
 * depth for future rotations.)
 */
function escapeInlineScript(source: string): string {
  return source.replace(/<\/script/gi, '<\\/script');
}

function localAssetsError(message: string): Error {
  const err = new Error(
    `Local prover artifacts unavailable (release builds have NO remote fallback for code or data): ${message} Stage the pinned artifacts with: node apps/consumer-app/scripts/stage-circuit-assets.js (see apps/consumer-app/assets/circuits/README.md).`
  );
  (err as Error & { code?: string }).code = 'CIRCUIT_LOCAL_ASSETS_UNAVAILABLE';
  return err;
}

/**
 * Resolve the bundled circuit artifacts to on-device `file://` URIs (plus the
 * UMD source text) via the Metro asset pipeline + expo-asset. All requires
 * are deliberately LAZY: Metro still resolves them statically (they are the
 * reason a bundle requires the staged files), but Jest never executes the
 * release path, so tests are unaffected by the binary asset modules.
 */
async function loadLocalCircuitArtifacts(): Promise<LocalCircuitArtifacts> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const wasmModuleId = require('../../assets/circuits/withdraw.wasm') as number;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const zkeyModuleId = require('../../assets/circuits/withdraw_final.zkey') as number;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const umdModuleId = require('../../assets/circuits/snarkjs.min.umd') as number;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Asset } = require('expo-asset') as typeof import('expo-asset');
    const [wasmAsset, zkeyAsset, umdAsset] = await Promise.all([
      Asset.fromModule(wasmModuleId).downloadAsync(),
      Asset.fromModule(zkeyModuleId).downloadAsync(),
      Asset.fromModule(umdModuleId).downloadAsync(),
    ]);
    const wasmUri = (wasmAsset as { localUri?: string | null }).localUri ?? null;
    const zkeyUri = (zkeyAsset as { localUri?: string | null }).localUri ?? null;
    const umdUri = (umdAsset as { localUri?: string | null }).localUri ?? null;
    if (!wasmUri || !zkeyUri || !umdUri) {
      throw localAssetsError(
        'expo-asset did not resolve local URIs for the staged withdraw.wasm / withdraw_final.zkey / snarkjs.min.umd assets.'
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const FS = require('expo-file-system/legacy') as {
      readAsStringAsync?: (
        uri: string,
        options?: { encoding?: string }
      ) => Promise<string>;
    };
    if (!FS.readAsStringAsync) {
      throw localAssetsError('expo-file-system readAsStringAsync is unavailable.');
    }
    const snarkjsSource = await FS.readAsStringAsync(umdUri, { encoding: 'utf8' });
    if (typeof snarkjsSource !== 'string' || snarkjsSource.length < 1000) {
      throw localAssetsError('the staged snarkjs UMD could not be read as text.');
    }
    return {
      wasmUri,
      zkeyUri,
      snarkjsSource: escapeInlineScript(snarkjsSource),
      baseDirUri: wasmUri.substring(0, wasmUri.lastIndexOf('/') + 1),
    };
  } catch (e) {
    if (
      e instanceof Error &&
      (e as Error & { code?: string }).code === 'CIRCUIT_LOCAL_ASSETS_UNAVAILABLE'
    ) {
      throw e;
    }
    throw localAssetsError(e instanceof Error ? e.message : String(e));
  }
}

/** Module-level cache so the ~8MB download from the APK happens once. */
let localArtifactsPromise: Promise<LocalCircuitArtifacts> | null = null;

function ensureLocalCircuitArtifacts(): Promise<LocalCircuitArtifacts> {
  if (!localArtifactsPromise) {
    localArtifactsPromise = loadLocalCircuitArtifacts().catch((e: unknown) => {
      // Do not cache failures — the next generateProof retries.
      localArtifactsPromise = null;
      throw e;
    });
  }
  return localArtifactsPromise;
}

/**
 * The release WebView page: the snarkjs UMD INLINED (no network access at
 * all — no `<script src>`), then a READY post once it has executed. Scripts
 * run in document order, so the READY post is guaranteed to fire after the
 * UMD (or report its failure).
 */
function buildReleaseHtml(inlineUmdSource: string): string {
  return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Veilpay ZKP Engine</title>
      </head>
      <body>
        <script>
          window.onerror = function (message) {
            try {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'PROOF_ERROR',
                error: String(message)
              }));
            } catch (_) { /* swallow */ }
            return true;
          };
        </script>
        <script>
          /* snarkjs@0.7.2 UMD — bundled locally from assets/circuits/snarkjs.min.umd
             (sha256 ed55d1f120a0333de24a8b632737e3244331e819d7d6411d75b3c0b0a91ea9ac,
             SRI sha384-GKtjkchdpNyrZRMyv1vJbvxxe5DWCz50yHyXQkbRumBABaTfx7yBR5fAGk6pUD//).
             The release prover never fetches code from the network. */
          ${inlineUmdSource}
        </script>
        <script>
          if (typeof snarkjs === 'undefined') {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'PROOF_ERROR',
              error: 'snarkjs local bundle failed to initialize'
            }));
          } else {
            window.ReactNativeWebView.postMessage(JSON.stringify({type:'READY'}));
          }
        </script>
      </body>
      </html>
    `;
}

/** Placeholder page shown in release until the local assets resolve. It
 *  never posts READY — generateProof fails fast on the artifacts promise
 *  instead of waiting for the guard timer. */
const RELEASE_PENDING_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body></body></html>`;

// ---------------------------------------------------------------------------
// Protocol types
// ---------------------------------------------------------------------------

/**
 * Canonical input shape for `snarkjs.groth16.fullProve` against
 * `withdraw.circom`. The nine keys are exactly the circuit signals in the
 * order the circuit was declared (packages/circuits/withdraw.circom:36-47;
 * build/verification_key.json has nPublic=5):
 *   private: nullifier, secret, pathElements, pathIndices
 *   public : merkleRoot, nullifierHash, recipient, amount, token
 */
export type ProveInputs = {
  nullifier: string;
  secret: string;
  pathElements: string[];
  pathIndices: number[];
  merkleRoot: string;
  nullifierHash: string;
  recipient: string;
  amount: string;
  token: string;
};

/** Messages the WebView posts back to React Native. */
type IncomingMessage =
  | { type: 'READY' }
  | { type: 'PROOF_SUCCESS'; proof: unknown; publicSignals: unknown[] }
  | { type: 'PROOF_ERROR'; error: string };

/** Messages React Native posts into the WebView. (Currently informational
 *  — the actual `PROVE` payload is delivered via `injectJavaScript` so we
 *  can interpolate `JSON.stringify(inputs)` directly into the script.) */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type OutgoingMessage = { type: 'PROVE'; inputs: ProveInputs };

/** Shape of a successful proof result returned from `generateProof`. */
export type ProofResult = { proof: unknown; publicSignals: unknown[] };

/** Imperative API exposed by the `ZkpProver` ref. */
export interface ZkpProverRef {
  generateProof: (inputs: ProveInputs) => Promise<ProofResult>;
}

interface ZkpProverProps {}

// The nine keys snarkjs expects, in the canonical declaration order. Used
// by `generateProof` to fail fast on caller-side typos rather than letting
// snarkjs throw a cryptic "circuit signal X not found" deep inside the
// WASM runtime.
const REQUIRED_INPUT_KEYS: ReadonlyArray<keyof ProveInputs> = [
  'nullifier',
  'secret',
  'pathElements',
  'pathIndices',
  'merkleRoot',
  'nullifierHash',
  'recipient',
  'amount',
  'token',
];
const REQUIRED_INPUT_KEY_SET = new Set<string>(REQUIRED_INPUT_KEYS as ReadonlyArray<string>);

/**
 * The `PROVE` script injected into the WebView. Parametrized over the
 * artifact sources so the DEV path (remote URLs) and the RELEASE path
 * (local `file://` URIs) share one implementation:
 *  - pre-flight `fetch` of both sources so failures surface as clean
 *    PROOF_ERRORs instead of opaque WASM stream errors;
 *  - SHA-256 verification of the fetched bytes against the pinned digests
 *    (always ON in release — pins are mandatory there);
 *  - `snarkjs.groth16.fullProve(inputs, wasmSource, zkeySource)`.
 */
function buildProveScript(params: {
  inputs: ProveInputs;
  wasmSource: string;
  zkeySource: string;
  integrityEnforced: boolean;
  wasmSha256: string;
  zkeySha256: string;
}): string {
  const {
    inputs,
    wasmSource,
    zkeySource,
    integrityEnforced,
    wasmSha256,
    zkeySha256,
  } = params;
  return `
              (async function() {
                try {
                  if (typeof snarkjs === 'undefined') {
                    throw new Error('snarkjs not loaded');
                  }
                  // Pre-flight: fetch both artifacts, verify their SHA-256 against
                  // the build-pinned digests, and only then hand them to fullProve.
                  async function sha256Hex(buf) {
                    if (!crypto || !crypto.subtle || !crypto.subtle.digest) {
                      throw new Error('integrity check unavailable (crypto.subtle missing)');
                    }
                    const digest = await crypto.subtle.digest('SHA-256', buf);
                    const bytes = new Uint8Array(digest);
                    let hex = '';
                    for (let i = 0; i < bytes.length; i++) {
                      hex += bytes[i].toString(16).padStart(2, '0');
                    }
                    return hex;
                  }
                  const wasmRes = await fetch(${JSON.stringify(wasmSource)});
                  if (!wasmRes.ok) {
                    throw new Error('wasm fetch failed: ' + wasmRes.status);
                  }
                  const wasmBytes = await wasmRes.arrayBuffer();
                  const zkeyRes = await fetch(${JSON.stringify(zkeySource)});
                  if (!zkeyRes.ok) {
                    throw new Error('zkey fetch failed: ' + zkeyRes.status);
                  }
                  const zkeyBytes = await zkeyRes.arrayBuffer();
                  // Enforce SHA-256 pinning only when both digests are pinned
                  // (REQUIRED-IF-CONFIGURED in dev). In RELEASE the pins are
                  // mandatory (assertCircuitIntegrityPinned) and the digests
                  // are the ones baked in constants/circuit.ts.
                  if (${JSON.stringify(integrityEnforced)}) {
                    const wasmHex = await sha256Hex(wasmBytes);
                    if (wasmHex !== ${JSON.stringify(wasmSha256)}) {
                      throw new Error('wasm integrity check failed (sha256 mismatch)');
                    }
                    const zkeyHex = await sha256Hex(zkeyBytes);
                    if (zkeyHex !== ${JSON.stringify(zkeySha256)}) {
                      throw new Error('zkey integrity check failed (sha256 mismatch)');
                    }
                  }
                  // Public inputs: [merkleRoot, nullifierHash, recipient,
                  // amount, token] — see design.md §Public input ordering
                  // contract. The full inputs object (nine keys) is
                  // serialized verbatim into the script below, so the
                  // public token signal reaches fullProve with the
                  // private signals.
                  const inputs = ${JSON.stringify(inputs)};
                  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
                    inputs,
                    ${JSON.stringify(wasmSource)},
                    ${JSON.stringify(zkeySource)}
                  );
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'PROOF_SUCCESS',
                    proof: proof,
                    publicSignals: publicSignals
                  }));
                } catch (e) {
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'PROOF_ERROR',
                    error: (e && e.message) ? e.message : String(e)
                  }));
                }
              })();
              true;
            `;
}

/**
 * Headless WebView component that offloads SnarkJS WASM proof generation
 * from the React Native JS thread. See file header for the postMessage
 * protocol and the release/dev artifact-source split.
 */
export const ZkpProver = forwardRef<ZkpProverRef, ZkpProverProps>(
  (_props, ref) => {
    const webViewRef = useRef<WebView>(null);
    const resolveRef = useRef<((value: ProofResult) => void) | null>(null);
    const rejectRef = useRef<((reason?: Error) => void) | null>(null);
    // True once the WebView has posted a `READY` message back. Until then
    // any `generateProof` call queues its injected script and dispatches
    // it the moment `READY` arrives.
    const webViewReadyRef = useRef<boolean>(false);
    const pendingScriptRef = useRef<string | null>(null);
    // Guard timer for a `generateProof` that never settles (READY or PROOF
    // never fires, or the WebView is gone). Bounds the worst-case stall so
    // the "GENERATING ZK PROOF..." spinner cannot hang forever.
    const proofTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // RELEASE only: the local prover page (inline UMD) once the bundled
    // artifacts have resolved. Ref mirrors the state so the imperative
    // `generateProof` (stable closure) can read it without a re-render.
    const [localProverPage, setLocalProverPage] = useState<{
      html: string;
      baseUrl: string;
    } | null>(null);
    const localProverPageRef = useRef<{ html: string; baseUrl: string } | null>(null);
    const { setIsProving } = useWalletStore();

    const applyLocalProverPage = useCallback(
      (page: { html: string; baseUrl: string }) => {
        localProverPageRef.current = page;
        setLocalProverPage(page);
      },
      []
    );

    // RELEASE: warm the bundled-artifact cache and swap the WebView over to
    // the local prover page (inline UMD, file-origin baseUrl) as soon as the
    // assets resolve. On failure we log and stay on the pending page — every
    // `generateProof` then fails closed with the same error (no remote
    // fallback, no silent hang: the artifacts promise rejects fast).
    useEffect(() => {
      if (!IS_RELEASE_BUILD) {
        return;
      }
      let cancelled = false;
      ensureLocalCircuitArtifacts()
        .then((artifacts) => {
          if (cancelled) return;
          applyLocalProverPage({
            html: buildReleaseHtml(artifacts.snarkjsSource),
            baseUrl: artifacts.baseDirUri,
          });
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          console.error(
            '[ZkpProver] local circuit assets unavailable — max-privacy proofs will fail closed:',
            e
          );
        });
      return () => {
        cancelled = true;
      };
    }, [applyLocalProverPage]);

    /**
     * Settle any in-flight `generateProof` as a failure and reset all
     * transient prover state. Safe to call with nothing in flight (it is a
     * no-op then). Used by the timeout, Android render-process death, a
     * WebView reload, and unmount so a promise is never left unsettled.
     */
    const failInflight = useCallback(
      (error: Error) => {
        if (proofTimeoutRef.current) {
          clearTimeout(proofTimeoutRef.current);
          proofTimeoutRef.current = null;
        }
        const reject = rejectRef.current;
        resolveRef.current = null;
        rejectRef.current = null;
        pendingScriptRef.current = null;
        webViewReadyRef.current = false;
        if (reject) {
          setIsProving(false);
          reject(error);
        }
      },
      [setIsProving]
    );

    /** Clear the per-attempt guard timer once a proof has settled. */
    const clearProofTimeout = useCallback(() => {
      if (proofTimeoutRef.current) {
        clearTimeout(proofTimeoutRef.current);
        proofTimeoutRef.current = null;
      }
    }, []);

    const handleMessage = useCallback(
      (event: WebViewMessageEvent) => {
        let data: IncomingMessage;
        try {
          data = JSON.parse(event.nativeEvent.data) as IncomingMessage;
        } catch (e) {
          console.error('[ZkpProver] failed to parse WebView message', e);
          return;
        }

        switch (data.type) {
          case 'READY': {
            webViewReadyRef.current = true;
            // If a `generateProof` call landed before the UMD finished
            // loading, replay its script now.
            if (pendingScriptRef.current) {
              const script = pendingScriptRef.current;
              pendingScriptRef.current = null;
              webViewRef.current?.injectJavaScript(script);
            }
            return;
          }
          case 'PROOF_SUCCESS': {
            clearProofTimeout();
            setIsProving(false);
            resolveRef.current?.({
              proof: data.proof,
              publicSignals: data.publicSignals,
            });
            resolveRef.current = null;
            rejectRef.current = null;
            return;
          }
          case 'PROOF_ERROR': {
            clearProofTimeout();
            setIsProving(false);
            rejectRef.current?.(new Error(data.error));
            resolveRef.current = null;
            rejectRef.current = null;
            return;
          }
          default: {
            console.warn(
              '[ZkpProver] unknown message type from WebView:',
              (data as { type?: string })?.type
            );
            return;
          }
        }
      },
      [setIsProving, clearProofTimeout]
    );

    useImperativeHandle(
      ref,
      () => ({
        generateProof: (inputs: ProveInputs): Promise<ProofResult> => {
          // Fail fast on misconfigured builds. RELEASE: pins are mandatory
          // (throws CIRCUIT_PINS_NOT_ENFORCED on empty/overridden pins).
          // DEV: throws CIRCUIT_NOT_CONFIGURED when the artifact URLs are
          // missing.
          assertCircuitConfigured();

          // Integrity pinning:
          //  - RELEASE: always enforced — the pins are mandatory and were
          //    just asserted to match the baked digests.
          //  - DEV: REQUIRED-IF-CONFIGURED — enforce the SHA-256 check only
          //    when BOTH hashes are pinned. If either is absent we proceed
          //    with URL-only fetch (no blocking) so local builds that
          //    configured just the URLs don't regress.
          // Treat empty-string OR undefined as "not pinned" so both real
          // builds (?? '' fallback) and test mocks that omit the vars behave
          // the same: integrity is enforced only when BOTH digests are set.
          const INTEGRITY_ENFORCED = IS_RELEASE_BUILD
            ? true
            : !!(CIRCUIT_WASM_SHA256 && CIRCUIT_ZKEY_SHA256);

          // Caller-side schema check — catch missing/extra keys before we
          // serialize the input object across the bridge.
          if (inputs === null || typeof inputs !== 'object') {
            return Promise.reject(
              new Error('ZkpProver.generateProof: inputs must be an object')
            );
          }
          const inputKeys = Object.keys(inputs);
          for (const k of REQUIRED_INPUT_KEYS) {
            if (!(k in inputs)) {
              return Promise.reject(
                new Error(
                  `ZkpProver.generateProof: missing required input key "${k}"`
                )
              );
            }
          }
          for (const k of inputKeys) {
            if (
              !REQUIRED_INPUT_KEY_SET.has(k)
            ) {
              return Promise.reject(
                new Error(
                  `ZkpProver.generateProof: unexpected input key "${k}"`
                )
              );
            }
          }

          setIsProving(true);

          return new Promise<ProofResult>((resolve, reject) => {
            resolveRef.current = resolve;
            rejectRef.current = reject;

            // Guard against a promise that never settles: if neither READY
            // nor PROOF_SUCCESS/PROOF_ERROR arrives within the window (the
            // WebView was never laid out, the UMD load hung, the RELEASE
            // asset download hung, or a proof is unusually slow), reject and
            // reset rather than stalling the spinner forever. Cleared by the
            // first terminal message. Starts at CALL time so the release
            // artifact resolution is covered too.
            if (proofTimeoutRef.current) {
              clearTimeout(proofTimeoutRef.current);
            }
            proofTimeoutRef.current = setTimeout(() => {
              failInflight(
                new Error(
                  'ZK proof generation timed out. Please try again.'
                )
              );
            }, PROOF_TIMEOUT_MS);

            const dispatchScript = (script: string) => {
              if (webViewReadyRef.current) {
                webViewRef.current?.injectJavaScript(script);
              } else {
                // Queue and replay when `READY` arrives.
                pendingScriptRef.current = script;
              }
            };

            const dispatch = (wasmSource: string, zkeySource: string) => {
              dispatchScript(
                buildProveScript({
                  inputs,
                  wasmSource,
                  zkeySource,
                  integrityEnforced: INTEGRITY_ENFORCED,
                  wasmSha256: CIRCUIT_WASM_SHA256 ?? '',
                  zkeySha256: CIRCUIT_ZKEY_SHA256 ?? '',
                })
              );
            };

            if (IS_RELEASE_BUILD) {
              // RELEASE: resolve the bundled local artifacts first (fail
              // closed — never fall back to a remote URL), make sure the
              // WebView runs the local prover page (inline UMD), and prove
              // against the on-device file:// URIs.
              ensureLocalCircuitArtifacts()
                .then((artifacts) => {
                  if (rejectRef.current !== reject) {
                    return; // superseded by a newer generateProof
                  }
                  if (!localProverPageRef.current) {
                    applyLocalProverPage({
                      html: buildReleaseHtml(artifacts.snarkjsSource),
                      baseUrl: artifacts.baseDirUri,
                    });
                  }
                  dispatch(artifacts.wasmUri, artifacts.zkeyUri);
                })
                .catch((e: unknown) => {
                  if (rejectRef.current !== reject) {
                    return;
                  }
                  failInflight(
                    e instanceof Error ? e : new Error(String(e))
                  );
                });
            } else {
              // DEV: remote artifact URLs (as configured), unchanged.
              dispatch(CIRCUIT_WASM_URL, CIRCUIT_ZKEY_URL);
            }
          });
        },
      }),
      [setIsProving, failInflight, applyLocalProverPage]
    );

    // Tear down on unmount: settle any in-flight proof as a failure so the
    // caller never awaits a promise that can no longer be resolved.
    useEffect(() => {
      return () => {
        failInflight(new Error('ZkpProver unmounted before proof completed'));
      };
    }, [failInflight]);

    // DEV HTML payload: load the snarkjs UMD from the pinned CDN, then post
    // `READY` once it has finished executing. A global `onerror` handler maps
    // any uncaught throw (including a UMD load failure) to `PROOF_ERROR` so
    // the RN side never silently hangs. The SRI integrity attribute is
    // emitted whenever a pin is configured (default: the baked digest).
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Veilpay ZKP Engine</title>
      </head>
      <body>
        <script>
          window.onerror = function (message) {
            try {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'PROOF_ERROR',
                error: String(message)
              }));
            } catch (_) { /* swallow */ }
            return true;
          };
        </script>
        <script
          src="${SNARKJS_CDN_URL}"
          ${SNARKJS_SRI ? 'integrity="' + SNARKJS_SRI + '" crossorigin="anonymous"' : ''}
          onload="window.ReactNativeWebView.postMessage(JSON.stringify({type:'READY'}));"
          onerror="window.ReactNativeWebView.postMessage(JSON.stringify({type:'PROOF_ERROR', error:'snarkjs UMD failed to load from ${SNARKJS_CDN_URL}'}));"
        ></script>
      </body>
      </html>
    `;

    return (
      <View style={styles.hidden}>
        <WebView
          ref={webViewRef}
          source={
            IS_RELEASE_BUILD
              ? localProverPage
                ? { html: localProverPage.html, baseUrl: localProverPage.baseUrl }
                : { html: RELEASE_PENDING_HTML }
              : { html: htmlContent }
          }
          onMessage={handleMessage}
          javaScriptEnabled={true}
          originWhitelist={['*']}
          // RELEASE local artifacts: the page is a file-origin document
          // (baseUrl = the expo-asset cache dir) and fetches withdraw.wasm /
          // withdraw_final.zkey from file:// URIs. Android needs these flags
          // for that; they are inert in dev (no file-origin page) and on
          // platforms without them. If the fetch is blocked the WebView
          // reports a PROOF_ERROR — fail closed, no remote fallback.
          allowFileAccess={true}
          allowFileAccessFromFileURLs={true}
          allowUniversalAccessFromFileURLs={true}
          // Android lifecycle: when the WebView render process is killed
          // (memory pressure, OS teardown) or the content process terminates,
          // the hidden engine can no longer answer. Settle any in-flight
          // promise as a failure so the spinner cannot hang, and force a
          // fresh READY on the next load.
          onRenderProcessGone={() => {
            failInflight(
              new Error('ZK proof engine was stopped by the OS. Please retry.')
            );
            return true; // suppress the default "this page isn't responding" teardown
          }}
          onContentProcessDidTerminate={() => {
            failInflight(
              new Error('ZK proof engine content process terminated. Please retry.')
            );
          }}
          // A (re)load invalidates any previously-seen READY: the WebView is
          // re-running the HTML and must post READY again before it can prove.
          // This covers Android activity recreation after backgrounding, where
          // the native WebView is rebuilt but the JS refs persist — and the
          // RELEASE swap from the pending page to the local prover page.
          onLoadStart={() => {
            webViewReadyRef.current = false;
          }}
          onLoad={() => {
            webViewReadyRef.current = false;
          }}
        />
      </View>
    );
  }
);

ZkpProver.displayName = 'ZkpProver';

const styles = StyleSheet.create({
  // On Android a WebView laid out at zero width/height is not rendered, so
  // its JavaScript (the snarkjs UMD load + READY) may never execute. Keep
  // the engine a real, non-zero size but park it offscreen ('left: -9999')
  // and transparent ('opacity: 0') so it is invisible yet still laid out and
  // running.
  hidden: {
    position: 'absolute',
    left: -9999,
    top: 0,
    width: 320,
    height: 480,
    opacity: 0,
  },
});
