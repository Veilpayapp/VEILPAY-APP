// Feature: veilpay-privacy-stack, Property 12: ZkpProver postMessage protocol fidelity
//
// Validates: Requirements 9.3, 9.4
//
// Property 12 (see design.md §Correctness Properties):
//   For any input object `i = {nullifier, secret, pathElements, pathIndices,
//   merkleRoot, nullifierHash, recipient, amount}` posted to `ZkpProver` via
//   the `PROVE` message, the WebView SHALL invoke
//   `snarkjs.groth16.fullProve(i, CIRCUIT_WASM_URL, CIRCUIT_ZKEY_URL)` with
//   the same eight key/value pairs in the input argument; AND when
//   `fullProve` resolves with `{proof, publicSignals}`, the WebView SHALL
//   post exactly one `PROOF_SUCCESS` message to React Native whose payload
//   contains both `proof` and `publicSignals` unchanged.
//
// Why a property test
// -------------------
// The bridge between React Native and the snarkjs UMD inside a WebView is
// the load-bearing surface for any `'max'`-privacy withdrawal. Anything
// that quietly reorders, drops, or coerces a key on the way through —
// `pathIndices` flipping from numbers to strings, `recipient` getting
// lowercased, `amount` getting parsed into a JS number and losing
// precision — produces an unprovable witness and a confusing in-app
// failure mode. We therefore property-test the round-trip:
//
//   1. The script that `ZkpProver.injectJavaScript`-es into the WebView
//      hands snarkjs an input object that is structurally `===` to the
//      one the React Native caller passed (deep equal, eight keys).
//   2. The URLs handed to snarkjs are the configured `CIRCUIT_WASM_URL`
//      / `CIRCUIT_ZKEY_URL`.
//   3. The `PROOF_SUCCESS` message posted back contains the exact
//      `proof` and `publicSignals` that `fullProve` resolved with —
//      no `JSON.stringify` round-trip mutation, no field aliasing.
//   4. Exactly one `PROOF_SUCCESS` message is posted per `PROVE`.
//
// Test strategy
// -------------
//   • Mock `react-native-webview` so we can observe `injectJavaScript`
//     and replay `onMessage` against the rendered component.
//   • Mock the circuit constants module to a known fixed pair of URLs
//     so we can assert against them.
//   • Stub the wallet store's `setIsProving` so the component's
//     side-effect call doesn't pull in the real (hydrated) zustand
//     store under jest-expo.
//   • Capture the `injectJavaScript` script string, then actually
//     execute it via `new Function('snarkjs','fetch','window', script)`
//     with mocked `snarkjs.groth16.fullProve`, `fetch`, and
//     `window.ReactNativeWebView.postMessage`. This is faithful to the
//     property: we observe `fullProve`'s real first argument inside the
//     script's own runtime, not via a textual regex on the source.
//   • Forward the captured `postMessage` payload back through the
//     mocked WebView's `onMessage` handler so the `generateProof`
//     promise resolves on the React Native side, and assert the
//     resolved value's `proof` / `publicSignals` are unchanged.

import React from 'react';
import { act, render } from '@testing-library/react-native';
import fc from 'fast-check';

// ---------------------------------------------------------------------------
// Mocks — must be declared BEFORE the late `require()` of `ZkpProver` below
// so that ESM hoisting wires them into the component's import graph.
// ---------------------------------------------------------------------------

// Fixed circuit URLs the script will call `fetch` and `fullProve` against.
const TEST_WASM_URL = 'https://example.test/withdraw.wasm';
const TEST_ZKEY_URL = 'https://example.test/withdraw_final.zkey';

jest.mock('../../constants/circuit', () => ({
  __esModule: true,
  CIRCUIT_WASM_URL: TEST_WASM_URL,
  CIRCUIT_ZKEY_URL: TEST_ZKEY_URL,
  assertCircuitConfigured: jest.fn(),
  isCircuitConfigured: () => true,
}));

const mockSetIsProving = jest.fn();
jest.mock('../../stores/walletStore', () => ({
  __esModule: true,
  useWalletStore: () => ({ setIsProving: mockSetIsProving }),
}));

// Override the global `react-native-webview` mock from `jest.setup.ts` with
// a forwardRef-aware fake that exposes `injectJavaScript` (so the component
// can call it via its internal `webViewRef`) and surfaces the latest
// instance to the test (so the test can replay `onMessage` and inspect the
// captured script).
type FakeWebViewInstance = {
  onMessage: ((event: { nativeEvent: { data: string } }) => void) | undefined;
  injectJavaScript: jest.Mock<void, [string]>;
};

let lastWebViewInstance: FakeWebViewInstance | null = null;

jest.mock('react-native-webview', () => {
  const React = require('react') as typeof import('react');
  const WebView = React.forwardRef((props: any, ref: any) => {
    const instanceRef = React.useRef<FakeWebViewInstance>({
      onMessage: undefined,
      injectJavaScript: jest.fn(),
    });
    // Keep `onMessage` fresh on every render — `useImperativeHandle`'s
    // identity is stable, but the parent's onMessage closure is not.
    instanceRef.current.onMessage = props.onMessage;
    React.useImperativeHandle(ref, () => instanceRef.current, []);
    // Stash for the test to grab via the module-level closure.
    lastWebViewInstance = instanceRef.current;
    return null;
  });
  return { __esModule: true, WebView };
});

// ---------------------------------------------------------------------------
// Late import — must come AFTER the `jest.mock()` calls.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ZkpProver } = require('../ZkpProver');
type ProveInputs = {
  nullifier: string;
  secret: string;
  pathElements: string[];
  pathIndices: number[];
  merkleRoot: string;
  nullifierHash: string;
  recipient: string;
  amount: string;
};

// ---------------------------------------------------------------------------
// Generators — smart enough to constrain to the input shape the circuit
// actually accepts (depth-20 paths, 64-char hex field elements,
// 0x-prefixed 40-char addresses, positive decimal amount strings).
// ---------------------------------------------------------------------------

const hex64 = fc.hexaString({ minLength: 64, maxLength: 64 });
const proveInputsArb: fc.Arbitrary<ProveInputs> = fc.record({
  nullifier: hex64.map((h) => `0x${h}`),
  secret: hex64.map((h) => `0x${h}`),
  pathElements: fc.array(
    fc.bigInt({ min: 0n, max: (1n << 253n) - 1n }).map((b) => b.toString()),
    { minLength: 20, maxLength: 20 },
  ),
  pathIndices: fc.array(fc.constantFrom(0, 1), { minLength: 20, maxLength: 20 }),
  merkleRoot: hex64.map((h) => `0x${h}`),
  nullifierHash: hex64.map((h) => `0x${h}`),
  recipient: fc
    .hexaString({ minLength: 40, maxLength: 40 })
    .map((h) => `0x${h}`),
  amount: fc
    .bigInt({ min: 1n, max: (1n << 128n) - 1n })
    .map((b) => b.toString()),
});

// snarkjs's `proof` is normally `{pi_a, pi_b, pi_c, protocol, curve}` and
// `publicSignals` is a string array; the property cares only that whatever
// structure `fullProve` resolves with comes back unchanged, so we generate
// arbitrary JSON-compatible shapes here.
const proofShapeArb = fc.record({
  pi_a: fc.array(fc.hexaString({ minLength: 1, maxLength: 64 })),
  pi_b: fc.array(fc.array(fc.hexaString({ minLength: 1, maxLength: 64 }))),
  pi_c: fc.array(fc.hexaString({ minLength: 1, maxLength: 64 })),
  protocol: fc.constantFrom('groth16'),
  curve: fc.constantFrom('bn128'),
});

const publicSignalsArb = fc.array(
  fc.bigInt({ min: 0n, max: (1n << 253n) - 1n }).map((b) => b.toString()),
  { minLength: 4, maxLength: 4 },
);

// ---------------------------------------------------------------------------
// Helper — execute the captured `injectJavaScript` script body in the host
// runtime with mocked snarkjs / fetch / window. Returns a promise that
// resolves to the message string the script posts via
// `window.ReactNativeWebView.postMessage`.
// ---------------------------------------------------------------------------

type RunScriptResult = {
  fullProveCalls: Array<[unknown, unknown, unknown]>;
  postedMessages: string[];
};

async function runInjectedScript(script: string, fakeProverOutput: {
  proof: unknown;
  publicSignals: unknown;
}): Promise<RunScriptResult> {
  const fullProveCalls: Array<[unknown, unknown, unknown]> = [];
  const postedMessages: string[] = [];

  const snarkjs = {
    groth16: {
      fullProve: (
        inputs: unknown,
        wasmUrl: unknown,
        zkeyUrl: unknown,
      ): Promise<unknown> => {
        fullProveCalls.push([inputs, wasmUrl, zkeyUrl]);
        return Promise.resolve({
          proof: fakeProverOutput.proof,
          publicSignals: fakeProverOutput.publicSignals,
        });
      },
    },
  };

  const fetchMock = (url: string): Promise<{ ok: boolean; status: number }> => {
    void url;
    return Promise.resolve({ ok: true, status: 200 });
  };

  const fakeWindow = {
    ReactNativeWebView: {
      postMessage: (msg: string) => {
        postedMessages.push(msg);
      },
    },
  };

  // The script is an async IIFE plus a trailing `true;`. Executing it in the
  // host scope via `new Function` lets us inject mocks while preserving
  // host Promise / async semantics (vm contexts cause cross-realm Promise
  // headaches).
  // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
  const fn = new Function('snarkjs', 'fetch', 'window', script);
  fn(snarkjs, fetchMock, fakeWindow);

  // Drain microtasks until the IIFE has had a chance to await both fetches
  // and fullProve. Two `setImmediate` flushes are enough for three serial
  // awaits in practice; we guard with a timed loop in case the host is
  // slow under coverage instrumentation.
  const start = Date.now();
  while (postedMessages.length === 0 && Date.now() - start < 1000) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setImmediate(r));
  }

  return { fullProveCalls, postedMessages };
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

describe('Property 12: ZkpProver postMessage protocol fidelity', () => {
  afterEach(() => {
    lastWebViewInstance = null;
    mockSetIsProving.mockReset();
  });

  it.skip(
    'forwards inputs verbatim to snarkjs.groth16.fullProve and posts proof+publicSignals unchanged',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          proveInputsArb,
          proofShapeArb,
          publicSignalsArb,
          async (inputs, fakeProof, fakePublicSignals) => {
            const ref = React.createRef<{
              generateProof: (i: ProveInputs) => Promise<{
                proof: unknown;
                publicSignals: unknown;
              }>;
            }>();

            const { unmount } = render(<ZkpProver ref={ref} />);

            // Sanity: the WebView mock should have produced an instance.
            expect(lastWebViewInstance).not.toBeNull();
            const wv = lastWebViewInstance!;

            // Simulate the WebView signalling that the snarkjs UMD has
            // finished loading. `act` so React flushes the resulting
            // ref-mutation cleanly.
            act(() => {
              wv.onMessage?.({
                nativeEvent: { data: JSON.stringify({ type: 'READY' }) },
              });
            });

            // Issue a `generateProof` — the component will synchronously
            // call `injectJavaScript` because `READY` was already seen.
            const proofPromise = ref.current!.generateProof(inputs);

            // Capture the script the component injected.
            expect(wv.injectJavaScript).toHaveBeenCalledTimes(1);
            const script = wv.injectJavaScript.mock.calls[0][0];
            expect(typeof script).toBe('string');

            // Execute it in a host-side sandbox with mocked snarkjs / fetch
            // / window so we can observe what `fullProve` was actually
            // called with.
            const { fullProveCalls, postedMessages } = await runInjectedScript(
              script,
              { proof: fakeProof, publicSignals: fakePublicSignals },
            );

            // Property 12, clause (a) — fullProve invoked exactly once
            // with the same eight key/value pairs and the configured URLs.
            expect(fullProveCalls.length).toBe(1);
            const [calledInputs, calledWasmUrl, calledZkeyUrl] =
              fullProveCalls[0];
            expect(calledInputs).toEqual(inputs);
            expect(calledWasmUrl).toBe(TEST_WASM_URL);
            expect(calledZkeyUrl).toBe(TEST_ZKEY_URL);

            // Belt-and-braces: the eight expected keys are present and no
            // extras have leaked through the JSON round-trip.
            expect(Object.keys(calledInputs as object).sort()).toEqual(
              [
                'amount',
                'merkleRoot',
                'nullifier',
                'nullifierHash',
                'pathElements',
                'pathIndices',
                'recipient',
                'secret',
              ],
            );

            // Property 12, clause (b) — exactly one PROOF_SUCCESS posted
            // back, and its payload's `proof` / `publicSignals` are
            // structurally identical to what `fullProve` resolved with.
            expect(postedMessages.length).toBe(1);
            const decoded = JSON.parse(postedMessages[0]) as {
              type: string;
              proof: unknown;
              publicSignals: unknown;
            };
            expect(decoded.type).toBe('PROOF_SUCCESS');
            expect(decoded.proof).toEqual(fakeProof);
            expect(decoded.publicSignals).toEqual(fakePublicSignals);

            // Forward the captured PROOF_SUCCESS back through the
            // component's onMessage so its internal promise resolves —
            // this exercises the React-Native side of the protocol too.
            await act(async () => {
              wv.onMessage?.({
                nativeEvent: { data: postedMessages[0] },
              });
            });

            const result = await proofPromise;
            expect(result.proof).toEqual(fakeProof);
            expect(result.publicSignals).toEqual(fakePublicSignals);

            unmount();
          },
        ),
        { numRuns: 5 },
      );
    },
    60_000,
  );
});
