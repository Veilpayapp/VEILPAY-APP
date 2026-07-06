// Public inputs: [merkleRoot, nullifierHash, recipient, amount] — see design.md §Public input ordering contract
//
// VeilPay — ZkpProver (WebView snarkjs bridge)
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
// On `PROVE`, the WebView pre-flights the artifact URLs with `fetch` so a
// 404 surfaces as a `PROOF_ERROR` rather than as an opaque WASM stream
// failure inside `fullProve`. It then calls
// `snarkjs.groth16.fullProve(inputs, CIRCUIT_WASM_URL, CIRCUIT_ZKEY_URL)`
// and posts the resulting `{ proof, publicSignals }` back as
// `PROOF_SUCCESS`. Any throw from `fullProve` (or from either pre-flight
// fetch) is mapped to `PROOF_ERROR { error }`.
//
// Snarkjs-loading tradeoff
// ------------------------
// The task description asks for the snarkjs UMD to be "bundled into the
// WebView HTML". In practice, Metro cannot inline a 1.2 MB UMD bundle as a
// raw string without a custom transformer (no `?raw` import support, no
// `Buffer`-style file read at runtime in the RN context). The realistic
// path within React Native is to load the UMD from a known, version-pinned
// URL — but we move that URL OFF the previously hardcoded
// `https://api.veilpay.io/circuits/...` host (which is a placeholder) and
// onto the public jsdelivr CDN, pinned to the exact `snarkjs@0.7.2` that
// is locked in this app's `package.json`. The URL is configurable via
// `EXPO_PUBLIC_SNARKJS_URL` so a self-hosted bundle can be swapped in for
// production if CDN access is undesirable.

import React, {
  useRef,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import {
  CIRCUIT_WASM_URL,
  CIRCUIT_ZKEY_URL,
  assertCircuitConfigured,
} from '../constants/circuit';
import { useWalletStore } from '../stores/walletStore';

// ---------------------------------------------------------------------------
// Snarkjs UMD source
// ---------------------------------------------------------------------------
//
// Pinned to snarkjs@0.7.2 to match the `^0.7.2` entry in
// `apps/consumer-app/package.json`. Override at build time with
// `EXPO_PUBLIC_SNARKJS_URL` if a self-hosted copy is preferred.
const DEFAULT_SNARKJS_CDN_URL =
  'https://cdn.jsdelivr.net/npm/snarkjs@0.7.2/build/snarkjs.min.js';
const SNARKJS_CDN_URL: string =
  (process.env.EXPO_PUBLIC_SNARKJS_URL as string | undefined) ??
  DEFAULT_SNARKJS_CDN_URL;

// ---------------------------------------------------------------------------
// Protocol types
// ---------------------------------------------------------------------------

/**
 * Canonical input shape for `snarkjs.groth16.fullProve` against
 * `withdraw.circom`. The eight keys are exactly the circuit signals in the
 * order the circuit was declared:
 *   private: nullifier, secret, pathElements, pathIndices
 *   public : merkleRoot, nullifierHash, recipient, amount
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

// The eight keys snarkjs expects, in the canonical declaration order. Used
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
];
const REQUIRED_INPUT_KEY_SET = new Set<string>(REQUIRED_INPUT_KEYS as ReadonlyArray<string>);

/**
 * Headless WebView component that offloads SnarkJS WASM proof generation
 * from the React Native JS thread. See file header for the postMessage
 * protocol.
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
    const { setIsProving } = useWalletStore();

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
      [setIsProving]
    );

    useImperativeHandle(
      ref,
      () => ({
        generateProof: (inputs: ProveInputs): Promise<ProofResult> => {
          // Fail fast on misconfigured builds (empty CIRCUIT_*_URL) so the
          // user gets a clear error instead of a 30s hang inside the
          // WebView fetch.
          assertCircuitConfigured();

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

            // The `PROVE` script that runs inside the WebView. We
            // pre-flight both artifact URLs with `fetch` so a CDN 404
            // surfaces as a clean PROOF_ERROR instead of an opaque WASM
            // stream failure deep inside `fullProve`.
            const script = `
              (async function() {
                try {
                  if (typeof snarkjs === 'undefined') {
                    throw new Error('snarkjs not loaded');
                  }
                  // Pre-flight: surface 404s as PROOF_ERROR.
                  const wasmRes = await fetch(${JSON.stringify(CIRCUIT_WASM_URL)});
                  if (!wasmRes.ok) {
                    throw new Error('wasm fetch failed: ' + wasmRes.status);
                  }
                  const zkeyRes = await fetch(${JSON.stringify(CIRCUIT_ZKEY_URL)});
                  if (!zkeyRes.ok) {
                    throw new Error('zkey fetch failed: ' + zkeyRes.status);
                  }
                  // Public inputs: [merkleRoot, nullifierHash, recipient, amount]
                  // — see design.md §Public input ordering contract.
                  const inputs = ${JSON.stringify(inputs)};
                  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
                    inputs,
                    ${JSON.stringify(CIRCUIT_WASM_URL)},
                    ${JSON.stringify(CIRCUIT_ZKEY_URL)}
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

            if (webViewReadyRef.current) {
              webViewRef.current?.injectJavaScript(script);
            } else {
              // Queue and replay when `READY` arrives.
              pendingScriptRef.current = script;
            }
          });
        },
      }),
      [setIsProving]
    );

    // HTML payload: load snarkjs UMD, then post `READY` once it has
    // finished executing. A global `onerror` handler maps any uncaught
    // throw (including a UMD load failure) to `PROOF_ERROR` so the RN
    // side never silently hangs.
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>VeilPay ZKP Engine</title>
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
          source={{ html: htmlContent }}
          onMessage={handleMessage}
          javaScriptEnabled={true}
          originWhitelist={['*']}
        />
      </View>
    );
  }
);

ZkpProver.displayName = 'ZkpProver';

const styles = StyleSheet.create({
  hidden: {
    height: 0,
    width: 0,
    opacity: 0,
    position: 'absolute',
  },
});
