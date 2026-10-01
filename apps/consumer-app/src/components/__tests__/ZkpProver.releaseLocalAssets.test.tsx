// Feature: veilpay-privacy-stack — ZkpProver RELEASE local-asset wiring
// =====================================================================
// Covers the "Prover off the CDN" release path of ZkpProver.tsx:
//
//   (1) RELEASE + local artifacts unavailable (staging missing / asset
//       resolution fails) -> `generateProof` FAILS CLOSED with
//       CIRCUIT_LOCAL_ASSETS_UNAVAILABLE and never injects a PROVE script —
//       there is NO remote fallback for code or data in release.
//   (2) RELEASE + resolvable local artifacts -> the WebView page is the
//       local one (inline UMD, file-origin baseUrl, no CDN <script src>),
//       and the injected PROVE script fetches the wasm/zkey from their
//       file:// URIs with the MANDATORY (always-on) SHA-256 pin check.
//
// The dev path (CDN UMD + remote URLs + REQUIRED-IF-CONFIGURED pins) is
// covered by ZkpProver.lifecycle.test.tsx / .property.test.tsx, and the
// release pin CONFIGURATION semantics (assertCircuitIntegrityPinned etc.)
// by src/constants/__tests__/circuitPins.test.ts. This file exercises the
// ZkpProver wiring only, so the circuit module is mocked with
// release-shaped constants.
//
// Mocking notes (same structure as ZkpProver.lifecycle.test.tsx so a single
// React copy is in play):
//  - Top-level jest.mock() registrations + ONE late require of ZkpProver.
//  - The staged binary asset modules (`../../../assets/circuits/*`) are
//    virtual-mocked to numeric Metro asset ids (they are lazy requires
//    inside loadLocalCircuitArtifacts, so the mock is honored at call time
//    and the real binaries are never parsed by Jest).
//  - `expo-asset` / `expo-file-system/legacy` mocks delegate to mutable
//    `mock*` implementations so each test can choose the failure mode.

import React from 'react';
import { act, render } from '@testing-library/react-native';

// Shorten the guard timer so tests run fast. Must be set BEFORE the module
// is first required, because PROOF_TIMEOUT_MS is read at import time.
process.env.EXPO_PUBLIC_ZKP_PROOF_TIMEOUT_MS = '2000';

// Release-shaped circuit config (the real release semantics of these
// constants are covered by circuitPins.test.ts).
jest.mock('../../constants/circuit', () => ({
  __esModule: true,
  CIRCUIT_WASM_URL: '',
  CIRCUIT_ZKEY_URL: '',
  CIRCUIT_WASM_SHA256:
    '4292cc33840274ba8bbd9ce19fb5f2b371215af23d8e184b57824654ad9835a8',
  CIRCUIT_ZKEY_SHA256:
    '2269a668ed5076dcb3fbcacd58613ba796d6231ab85a71b4f613bcbb6b5898b3',
  SNARKJS_SRI:
    'sha384-GKtjkchdpNyrZRMyv1vJbvxxe5DWCz50yHyXQkbRumBABaTfx7yBR5fAGk6pUD//',
  IS_RELEASE_BUILD: true,
  assertCircuitConfigured: jest.fn(),
}));

const mockSetIsProving = jest.fn();
jest.mock('../../stores/walletStore', () => ({
  __esModule: true,
  useWalletStore: () => ({ setIsProving: mockSetIsProving }),
}));

// Virtual mocks: the .wasm/.zkey/.umd asset modules resolve to numeric Metro
// asset ids (as they would in a real bundle) instead of being parsed as JS.
jest.mock('../../../assets/circuits/withdraw.wasm', () => 101, { virtual: true });
jest.mock('../../../assets/circuits/withdraw_final.zkey', () => 102, {
  virtual: true,
});
jest.mock('../../../assets/circuits/snarkjs.min.umd', () => 103, { virtual: true });

// Mutable local-asset behavior, swapped per test.
type DownloadableAsset = { downloadAsync: () => Promise<{ localUri: string }> };
let mockAssetFromModule: (id: number) => DownloadableAsset = () => {
  throw new Error('asset not bundled (staging missing)');
};

jest.mock('expo-asset', () => ({
  __esModule: true,
  Asset: {
    fromModule: (id: number) => mockAssetFromModule(id),
  },
}));

// NOTE: jest.config.js moduleNameMapper maps 'expo-file-system/legacy' to
// __mocks__/expo-file-system-legacy.js, which takes precedence over a
// jest.mock factory — so the shared mock's readAsStringAsync jest.fn is
// re-implemented here instead. ZkpProver lazy-requires the same module
// instance, so this controls the release path's UMD read.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const FS_LEGACY_MOCK = require('expo-file-system/legacy') as {
  readAsStringAsync: jest.Mock<Promise<string>, [string]>;
};

// forwardRef-aware WebView fake (same pattern as the lifecycle test), also
// capturing the `source` prop so the release page (html + baseUrl) can be
// asserted.
type FakeWv = {
  onMessage: ((e: { nativeEvent: { data: string } }) => void) | undefined;
  onLoadStart: (() => void) | undefined;
  onLoad: (() => void) | undefined;
  onRenderProcessGone: (() => boolean) | undefined;
  onContentProcessDidTerminate: (() => void) | undefined;
  injectJavaScript: jest.Mock<void, [string]>;
  source: unknown;
  allowFileAccess: unknown;
  allowFileAccessFromFileURLs: unknown;
  allowUniversalAccessFromFileURLs: unknown;
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
      source: props.source,
      allowFileAccess: props.allowFileAccess,
      allowFileAccessFromFileURLs: props.allowFileAccessFromFileURLs,
      allowUniversalAccessFromFileURLs: props.allowUniversalAccessFromFileURLs,
    });
    inst.current.onMessage = props.onMessage;
    inst.current.onLoadStart = props.onLoadStart;
    inst.current.onLoad = props.onLoad;
    inst.current.onRenderProcessGone = props.onRenderProcessGone;
    inst.current.onContentProcessDidTerminate = props.onContentProcessDidTerminate;
    inst.current.source = props.source;
    React.useImperativeHandle(ref, () => inst.current, []);
    lastWv = inst.current;
    return null;
  });
  return { __esModule: true, WebView };
});

// Late import so the env var + mocks are in place first (single React copy).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ZkpProver } = require('../ZkpProver');

const WASM_URI = 'file:///data/user/0/cache/ExponentAsset-abc/withdraw.wasm';
const ZKEY_URI = 'file:///data/user/0/cache/ExponentAsset-def/withdraw_final.zkey';
const UMD_URI = 'file:///data/user/0/cache/ExponentAsset-ghi/snarkjs.min.umd';
// Stand-in for the 719KB UMD; ZkpProver sanity-checks that the read text is
// plausibly large, so pad it past that threshold.
const UMD_TEXT = `/* snarkjs@0.7.2 UMD stand-in */\nvar snarkjs = { groth16: { fullProve: function () {} } };\n${'// padding\n'.repeat(90)}`;
const BAKED_WASM = '4292cc33840274ba8bbd9ce19fb5f2b371215af23d8e184b57824654ad9835a8';
const BAKED_ZKEY = '2269a668ed5076dcb3fbcacd58613ba796d6231ab85a71b4f613bcbb6b5898b3';

FS_LEGACY_MOCK.readAsStringAsync.mockImplementation((uri: string) => {
  expect(uri).toBe(UMD_URI);
  return Promise.resolve(UMD_TEXT);
});

function useWorkingLocalAssets() {
  mockAssetFromModule = (id: number) => {
    const localUri = id === 101 ? WASM_URI : id === 102 ? ZKEY_URI : UMD_URI;
    return { downloadAsync: () => Promise.resolve({ localUri }) };
  };
}

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

function postReady() {
  act(() => {
    lastWv!.onMessage?.({ nativeEvent: { data: JSON.stringify({ type: 'READY' }) } });
  });
}

/**
 * Drain the microtask queue. NOTE: jest.setup.ts installs FAKE timers
 * globally (jest.useFakeTimers()), so setImmediate/setTimeout-based flushes
 * never fire — only microtask rounds advance the promise chains here.
 */
async function flushAsync(rounds = 30) {
  for (let i = 0; i < rounds; i++) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
}

async function settleInAct() {
  await act(async () => {
    await flushAsync();
  });
}

function trackRejection(promise: Promise<unknown>): () => Error | null {
  let rejection: Error | null = null;
  promise.catch((e: Error) => {
    rejection = e;
  });
  return () => rejection;
}

describe('ZkpProver release path — bundled local prover, no CDN', () => {
  beforeEach(() => {
    lastWv = null;
    mockSetIsProving.mockClear();
    // Default: assets unresolvable (staging missing). Each test opts in.
    mockAssetFromModule = () => {
      throw new Error('asset not bundled (staging missing)');
    };
  });
  afterEach(() => {
    lastWv = null;
  });

  it('fails closed when local artifacts are unavailable — no remote fallback', async () => {
    const ref = React.createRef<{ generateProof: (i: any) => Promise<unknown> }>();
    render(<ZkpProver ref={ref as any} />);

    const getRejection = trackRejection(ref.current!.generateProof(validInputs()));
    expect(mockSetIsProving).toHaveBeenLastCalledWith(true);

    // Drain microtasks (the release branch resolves/rejects asynchronously).
    await settleInAct();

    const rejection = getRejection();
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error & { code?: string }).code).toBe(
      'CIRCUIT_LOCAL_ASSETS_UNAVAILABLE'
    );
    expect(rejection!.message).toMatch(/NO remote fallback/i);
    // Fail closed means NO PROVE script was injected at all — in particular
    // nothing that could fall back to a remote URL.
    expect(lastWv!.injectJavaScript).not.toHaveBeenCalled();
    expect(mockSetIsProving).toHaveBeenLastCalledWith(false);
  });

  it('proves from local file:// URIs with the mandatory pin check and an inline UMD page', async () => {
    useWorkingLocalAssets();
    const ref = React.createRef<{ generateProof: (i: any) => Promise<unknown> }>();
    render(<ZkpProver ref={ref as any} />);

    // The mount effect resolves the bundled artifacts and swaps the WebView
    // over to the local prover page.
    await settleInAct();
    const source = lastWv!.source as { html: string; baseUrl: string };
    expect(typeof source.html).toBe('string');
    // Local page: the snarkjs UMD is INLINED and no CDN <script src> exists.
    expect(source.html).toContain(UMD_TEXT);
    expect(source.html).not.toContain('cdn.jsdelivr.net');
    expect(source.html).not.toContain('src="https://');
    expect(source.baseUrl).toBe('file:///data/user/0/cache/ExponentAsset-abc/');
    // Android file-access flags are enabled for the file-origin page.
    expect(lastWv!.allowFileAccess).toBe(true);
    expect(lastWv!.allowFileAccessFromFileURLs).toBe(true);
    expect(lastWv!.allowUniversalAccessFromFileURLs).toBe(true);

    postReady();

    const p = ref.current!.generateProof(validInputs());
    await settleInAct();
    expect(lastWv!.injectJavaScript).toHaveBeenCalledTimes(1);
    const script = lastWv!.injectJavaScript.mock.calls[0][0];

    // The PROVE script targets the local file:// URIs, never a URL.
    expect(script).toContain(JSON.stringify(WASM_URI));
    expect(script).toContain(JSON.stringify(ZKEY_URI));
    expect(script).not.toContain('https://');
    // Integrity is MANDATORY in release: the enforced flag is true and both
    // baked digests are baked into the script.
    expect(script).toContain(JSON.stringify(true));
    expect(script).toContain(BAKED_WASM);
    expect(script).toContain(BAKED_ZKEY);

    // The release promise machinery still settles on PROOF_SUCCESS.
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
    const result = (await p) as { proof: { pi_a: string[] } };
    expect(result.proof.pi_a[0]).toBe('0');
    expect(mockSetIsProving).toHaveBeenLastCalledWith(false);
  });
});
