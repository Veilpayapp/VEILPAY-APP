// Feature: veilpay-privacy-stack — ZkpProver Android rendering/lifecycle
// =====================================================================
// These tests exercise the Android lifecycle/rendering robustness of the
// headless ZkpProver:
//
//   1. A `generateProof` that never gets a READY (e.g. the WebView was
//      never laid out at zero size on Android) MUST reject via the guard
//      timer instead of stalling the spinner forever.
//   2. A `generateProof` that got a READY and injected its script but then
//      receives neither PROOF_SUCCESS nor PROOF_ERROR MUST also reject via
//      the guard timer.
//   3. `onRenderProcessGone` (Android kill / OS teardown of the WebView
//      render process) MUST reject any in-flight `generateProof` at once.
//   4. An unmount while a proof is in flight MUST reject the pending
//      promise so callers never await a promise that cannot resolve.
//   5. Regression guard: a normal READY -> PROOF_SUCCESS round-trip still
//      resolves and clears `isProving`.

import React from 'react';
import { render, act } from '@testing-library/react-native';

// Shorten the guard timer so tests run fast. Must be set BEFORE the module
// is first required, because PROOF_TIMEOUT_MS is read at import time.
process.env.EXPO_PUBLIC_ZKP_PROOF_TIMEOUT_MS = '2000';

jest.mock('../../constants/circuit', () => ({
  __esModule: true,
  CIRCUIT_WASM_URL: 'https://example.test/w.wasm',
  CIRCUIT_ZKEY_URL: 'https://example.test/w.zkey',
  CIRCUIT_WASM_SHA256: 'a'.repeat(64),
  CIRCUIT_ZKEY_SHA256: 'b'.repeat(64),
  assertCircuitConfigured: jest.fn(),
}));

const mockSetIsProving = jest.fn();
jest.mock('../../stores/walletStore', () => ({
  __esModule: true,
  useWalletStore: () => ({ setIsProving: mockSetIsProving }),
}));

// A richer WebView fake than the global jest.setup one: it records the
// latest instance (callbacks + injectJavaScript) so the test can drive the
// Android lifecycle handlers and replay onMessage. It exposes the instance
// via `useImperativeHandle` exactly like the real WebView does, because the
// component's internal `webViewRef` is how it calls `injectJavaScript`.
type FakeWv = {
  onMessage: ((e: { nativeEvent: { data: string } }) => void) | undefined;
  onLoadStart: (() => void) | undefined;
  onLoad: (() => void) | undefined;
  onRenderProcessGone: (() => boolean) | undefined;
  onContentProcessDidTerminate: (() => void) | undefined;
  injectJavaScript: jest.Mock<void, [string]>;
};
let lastWv: FakeWv | null = null;

jest.mock('react-native-webview', () => {
  const React = require('react') as typeof import('react');
  const WebView = React.forwardRef((props: any, ref: any) => {
    const inst = React.useRef<FakeWv>({
      onMessage: undefined,
      onLoadStart: undefined,
      onLoad: undefined,
      onRenderProcessGone: undefined,
      onContentProcessDidTerminate: undefined,
      injectJavaScript: jest.fn(),
    });
    inst.current.onMessage = props.onMessage;
    inst.current.onLoadStart = props.onLoadStart;
    inst.current.onLoad = props.onLoad;
    inst.current.onRenderProcessGone = props.onRenderProcessGone;
    inst.current.onContentProcessDidTerminate =
      props.onContentProcessDidTerminate;
    React.useImperativeHandle(ref, () => inst.current, []);
    lastWv = inst.current;
    return null;
  });
  return { __esModule: true, WebView };
});

// Late import so the env var + mocks are in place first.
const { ZkpProver } = require('../ZkpProver');
type PR = { proof: unknown; publicSignals: unknown[] };
type ZkpProverRefT = { generateProof: (i: any) => Promise<PR> };

const READY = JSON.stringify({ type: 'READY' });

function validInputs() {
  return {
    nullifier: '0x' + '1'.repeat(64),
    secret: '0x' + '2'.repeat(64),
    pathElements: Array.from({ length: 20 }, (_, i) => (i + 1).toString()),
    pathIndices: Array.from({ length: 20 }, () => 0),
    merkleRoot: '0x' + '3'.repeat(64),
    nullifierHash: '0x' + '4'.repeat(64),
    recipient: '0x' + '5'.repeat(40),
    amount: '1000000',
  };
}

/** Attach a rejection catcher; returns a getter for the latest rejection. */
function trackRejection(promise: Promise<unknown>): () => Error | null {
  let rejection: Error | null = null;
  promise.catch((e: Error) => {
    rejection = e;
  });
  return () => rejection;
}

/** Signal READY on the currently-rendered WebView. */
function postReady() {
  act(() => {
    lastWv!.onMessage?.({ nativeEvent: { data: READY } });
  });
}

describe('ZkpProver Android lifecycle robustness', () => {
  beforeEach(() => {
    lastWv = null;
    mockSetIsProving.mockClear();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    lastWv = null;
  });

  it('rejects when READY never fires (WebView never laid out) instead of stalling', async () => {
    const ref = React.createRef<ZkpProverRefT>();
    render(<ZkpProver ref={ref as any} />);
    // READY is NOT delivered — simulates Android not laying out / running
    // the 0-sized WebView, so the PROVE script is queued in pendingScriptRef.

    const getRejection = trackRejection(
      ref.current!.generateProof(validInputs())
    );
    expect(mockSetIsProving).toHaveBeenLastCalledWith(true);

    // No terminal message arrives; advance past the guard timer.
    await act(async () => {
      jest.advanceTimersByTime(2005);
    });

    expect(getRejection()).toBeInstanceOf(Error);
    expect(getRejection()!.message).toMatch(/timed out/i);
    expect(mockSetIsProving).toHaveBeenLastCalledWith(false);
  });

  it('rejects when READY arrives but neither SUCCESS nor ERROR does', async () => {
    const ref = React.createRef<ZkpProverRefT>();
    render(<ZkpProver ref={ref as any} />);
    postReady();

    const getRejection = trackRejection(
      ref.current!.generateProof(validInputs())
    );
    // READY was seen, so the PROVE script is injected immediately.
    expect(lastWv!.injectJavaScript).toHaveBeenCalledTimes(1);

    // No PROOF_* message back; advance past the guard timer.
    await act(async () => {
      jest.advanceTimersByTime(2005);
    });

    expect(getRejection()!.message).toMatch(/timed out/i);
  });

  it('rejects the in-flight promise when onRenderProcessGone fires (Android kill)', async () => {
    const ref = React.createRef<ZkpProverRefT>();
    render(<ZkpProver ref={ref as any} />);
    postReady();

    const getRejection = trackRejection(
      ref.current!.generateProof(validInputs())
    );

    // Android kills the WebView render process mid-proof.
    await act(async () => {
      lastWv!.onRenderProcessGone?.();
    });

    expect(getRejection()).toBeInstanceOf(Error);
    expect(getRejection()!.message).toMatch(/stopped by the OS|engine/i);
    expect(mockSetIsProving).toHaveBeenLastCalledWith(false);
  });

  it('rejects the in-flight promise on unmount (caller gone)', async () => {
    const ref = React.createRef<ZkpProverRefT>();
    const view = render(<ZkpProver ref={ref as any} />);
    postReady();

    const getRejection = trackRejection(
      ref.current!.generateProof(validInputs())
    );

    await act(async () => {
      view.unmount();
    });

    expect(getRejection()).toBeInstanceOf(Error);
    expect(getRejection()!.message).toMatch(/unmounted/i);
  });

  it('regression: READY -> success still resolves and clears isProving', async () => {
    const ref = React.createRef<ZkpProverRefT>();
    render(<ZkpProver ref={ref as any} />);
    postReady();

    const p = ref.current!.generateProof(validInputs());
    expect(lastWv!.injectJavaScript).toHaveBeenCalledTimes(1);

    act(() => {
      lastWv!.onMessage?.({
        nativeEvent: {
          data: JSON.stringify({
            type: 'PROOF_SUCCESS',
            proof: { pi_a: ['0'] },
            publicSignals: ['1', '2', '3', '4'],
          }),
        },
      });
    });

    const result = await p;
    expect((result.proof as any).pi_a[0]).toBe('0');
    expect(mockSetIsProving).toHaveBeenLastCalledWith(false);
  });
});
