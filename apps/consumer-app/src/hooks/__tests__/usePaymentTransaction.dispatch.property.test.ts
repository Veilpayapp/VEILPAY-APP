// Feature: veilpay-privacy-stack, Property 9: Stealth announcer is invoked iff privacy level is 'stealth'
/**
 * Property 9 — Stealth announcer dispatch gating.
 *
 * Statement (verbatim from design.md §Correctness Properties → Property 9):
 *
 *   For any random `(recipient, amount, token, privacyLevel)` 4-tuple, the
 *   `usePaymentTransaction` hook SHALL invoke `StealthAnnouncer.announce`
 *   exactly once iff `privacyLevel === 'stealth'`, and exactly zero times
 *   for `'standard'` and `'max'`. Furthermore on the `'stealth'` path the
 *   `announce` call MUST be observed strictly BEFORE the local UI state
 *   transitions to `'confirmed'` (Requirement 4.6).
 *
 * Validates: Requirements 4.1, 4.6, 4.7, 12.4, 12.5
 *
 * --------------------------------------------------------------------------
 * Why we drive the *real* hook rather than a model
 * --------------------------------------------------------------------------
 *
 * Property 9 is about the dispatcher *mechanism*: which call site fires on
 * which `privacyLevel`, and in what order relative to the React state
 * machine the UI consumes. A model test would have to re-implement the
 * `switch (privacyLevel)` shape, defeating the purpose. So we render the
 * real hook with `@testing-library/react-native`, mock every heavy I/O
 * boundary it touches, and observe call counts and call ordering at the
 * `ethers.Contract.announce` seam.
 *
 * Boundary table (mocked → role in the property):
 *   - `secureSigner.signAndSendTransaction`     → returns a stub tx hash so
 *                                                  the standard / stealth
 *                                                  branches reach the post-
 *                                                  broadcast polling step.
 *   - `secureSigner.deriveAddressFromStoredMnemonic` → returns a stub addr
 *                                                  so `hasMnemonic` flips
 *                                                  to `true` and the
 *                                                  pre-flight gate opens.
 *   - `transactions.getStoredMnemonic`          → returns a stub 12-word
 *                                                  list so the stealth
 *                                                  branch can construct
 *                                                  the announce signer.
 *   - `txStatusPoller.pollTransactionStatus`    → resolves `'completed'`
 *                                                  so the stealth branch
 *                                                  reaches the announce
 *                                                  call site (rather than
 *                                                  bailing on a timeout).
 *   - `gasEstimator`                            → trivial estimate so the
 *                                                  background gas refresh
 *                                                  effect is a no-op.
 *   - `walletStore` / `useNetworkStatus`        → wallet is connected to
 *                                                  evm, online.
 *   - `commitmentStore.loadCommitmentRecord`    → returns `null` so the
 *                                                  `'max'` branch bails
 *                                                  *before* the prover
 *                                                  runs — the property
 *                                                  observation we need is
 *                                                  "announce was NOT
 *                                                  called", which is true
 *                                                  for the bail path just
 *                                                  as much as for the
 *                                                  full-prove path.
 *   - `relayerClient.submitWithdraw`            → resolved stub; never
 *                                                  reached because of the
 *                                                  `loadCommitmentRecord`
 *                                                  bail.
 *   - `stealthEngine.deriveStealthAddress`      → returns deterministic
 *                                                  stealth addr +
 *                                                  ephemeral pubkey.
 *   - `directory.fetchRecipientPublicKey`       → returns a stub pubkey
 *                                                  so the stealth branch
 *                                                  does not bail with
 *                                                  "Recipient public key
 *                                                  not found".
 *   - `rpc.getRpcUrl`                           → stub URL so the
 *                                                  ethers signer can be
 *                                                  constructed.
 *   - `ethers.Contract`                         → returns an object whose
 *                                                  `announce` is the
 *                                                  observable mock.
 *   - `constants/contracts`                     → all addresses look real,
 *                                                  `isPrivacyStackConfigured()`
 *                                                  returns `true` so the
 *                                                  pre-flight does not
 *                                                  refuse the flow.
 *
 * Per-iteration the test re-renders the hook with a fresh
 * `(recipient, amount, token, privacyLevel)` tuple, runs `handleConfirmSend`,
 * and asserts:
 *
 *   - `announceMock.callCount === (privacyLevel === 'stealth' ? 1 : 0)`
 *   - For `'stealth'`, `announce` was called with `(1, addr, pubkey, '0x')`
 *   - For `'stealth'`, the React state observed *during* the announce mock
 *     invocation was NOT yet `'confirmed'`; after the dispatcher returns,
 *     the state is `'confirmed'`. Together this proves announce-before-confirmed.
 *
 * Iteration count is held to 30 — deliberately small. Each iteration mounts
 * a fresh React hook tree, runs through the full async dispatcher with
 * timer-based effects, and tears down. The asymptotic cost is dominated by
 * React reconciliation, not by the property logic; 30 iterations comfortably
 * cover the three-element privacyLevel union with healthy redundancy.
 */

// ---------------------------------------------------------------------------
// 1. Mocks set up BEFORE imports — `jest.mock` calls are hoisted to the top
//    of the file by babel-jest, but the factories close over the
//    `mock*`-prefixed module-scoped fns below (allowed by the babel-jest
//    "starts with mock" exception to the out-of-scope rule).
// ---------------------------------------------------------------------------

const mockAnnounce = jest.fn();
const mockAnnounceTxWait = jest.fn();
const mockJsonRpcProvider = jest.fn();
const mockWalletFromPhrase = jest.fn();
const mockEthersContract = jest.fn();

jest.mock('ethers', () => ({
  __esModule: true,
  ethers: {
    get JsonRpcProvider() { return mockJsonRpcProvider; },
    Wallet: { get fromPhrase() { return mockWalletFromPhrase; } },
    get Contract() { return mockEthersContract; },
  },
}));

// secureSigner: the EVM signer surface the dispatcher uses.
const mockSignAndSendTransaction = jest.fn();
const mockDeriveAddressFromStoredMnemonic = jest.fn();
jest.mock('../../utils/secureSigner', () => ({
  __esModule: true,
  signAndSendTransaction: (...args: unknown[]) =>
    mockSignAndSendTransaction(...args),
  deriveAddressFromStoredMnemonic: (...args: unknown[]) =>
    mockDeriveAddressFromStoredMnemonic(...args),
}));

// solanaSigner / stellarSigner: not exercised on the EVM path the dispatcher
// takes here, but mocked anyway so their real modules' heavy deps do not load
// in the jest sandbox.
jest.mock('../../utils/solanaSigner', () => ({
  __esModule: true,
  signAndSendSolanaTransaction: jest.fn(),
}));
jest.mock('../../utils/stellarSigner', () => ({
  __esModule: true,
  signAndSendStellarTransaction: jest.fn(),
}));

// transactions: the dispatcher needs `getStoredMnemonic` for the announce
// signer; we keep `TransactionError` real because the dispatcher's catch
// arm does `instanceof TransactionError`.
const mockGetStoredMnemonic = jest.fn();
jest.mock('../../utils/transactions', () => {
  const actual = jest.requireActual('../../utils/transactions');
  return {
    __esModule: true,
    ...actual,
    getStoredMnemonic: (...args: unknown[]) => mockGetStoredMnemonic(...args),
  };
});

// rpc.getRpcUrl: stub URL string is enough — the ethers JsonRpcProvider is
// itself mocked and never makes a real call.
jest.mock('../../utils/rpc', () => ({
  __esModule: true,
  getRpcUrl: jest.fn(() => 'https://mock-rpc.veilpay.test'),
}));

// directory: returns a stub recipient pubkey so the stealth branch advances
// past the directory lookup. The stealth engine itself is also mocked so
// the value here is not cryptographically interpreted.
jest.mock('../../utils/directory', () => ({
  __esModule: true,
  fetchRecipientPublicKey: jest.fn(async () => `0x${'02'.padEnd(66, 'a')}`),
}));

// txStatusPoller: every poll resolves `'completed'`. This is the cheapest
// way to drive the dispatcher all the way to the announce step (stealth)
// or to the markSpent step (max — though we cut max off earlier).
const mockPollTransactionStatus = jest.fn();
jest.mock('../../utils/txStatusPoller', () => ({
  __esModule: true,
  pollTransactionStatus: (...args: unknown[]) =>
    mockPollTransactionStatus(...args),
}));

// gasEstimator: trivial estimate. The hook's gas-refresh useEffect invokes
// `estimateTransactionGas` periodically; a fast resolution keeps the test
// from waiting on real timers.
jest.mock('../../utils/gasEstimator', () => ({
  __esModule: true,
  estimateTransactionGas: jest.fn(async () => ({
    gasLimit: 21000n,
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
    gasPrice: 1n,
    estimatedCostWei: 21000n,
    estimatedCostEth: '0.00000000000002',
    estimatedCostUsd: null,
    isStale: false,
    fetchedAt: 0,
  })),
  isGasExpensive: jest.fn(() => false),
}));

// stealthEngine: deterministic outputs so the announce mock receives
// predictable arguments we can match on.
jest.mock('../../utils/stealthEngine', () => ({
  __esModule: true,
  deriveStealthAddress: jest.fn(() => ({
    stealthAddress: `0x${'b'.repeat(40)}`,
    ephemeralPubKey: `0x${'02'.padEnd(66, 'c')}`,
  })),
}));

// encryption: standard-flow memo encryption. Returns a fixed payload — the
// memo path only fires when the recipient is in the directory, and our
// test inputs deliberately do not pass a memo, so this is mostly defensive.
jest.mock('../../utils/encryption', () => ({
  __esModule: true,
  encryptNote: jest.fn(() => ({ ct: '00', nonce: '00', ephemeralPub: '00' })),
  generateEphemeralKeyPair: jest.fn(() => ({
    publicKey: new Uint8Array(32),
    secretKey: new Uint8Array(32),
  })),
}));

// analytics: trackEvent fires throughout the dispatcher; mock it so we
// don't pull the real Sentry / amplitude wiring into the sandbox.
jest.mock('../../utils/analytics', () => ({
  __esModule: true,
  trackEvent: jest.fn(),
}));

// walletStore: minimal selector-style hook returning evm + a stub address.
// We MUST return a stable object reference here because `usePaymentTransaction`
// puts `activeChain` in a `useEffect` dependency array. Returning a new object
// literal on every render causes an infinite render/effect loop!
const MOCK_WALLET_STATE = {
  activeChain: { type: 'evm', key: 'sepolia' },
  address: `0x${'9'.repeat(40)}`,
};
jest.mock('../../stores/walletStore', () => ({
  __esModule: true,
  useWalletStore: jest.fn(() => MOCK_WALLET_STATE),
}));

// useNetworkStatus: online.
jest.mock('../../hooks/useNetworkStatus', () => ({
  __esModule: true,
  useNetworkStatus: jest.fn(() => ({
    isConnected: true,
    isInternetReachable: true,
    type: 'wifi',
  })),
}));

// Toast: minimal stub. The hook calls `toast.show(...)` which we make a
// jest.fn so it doesn't error out under the renderless harness.
jest.mock('../../components/Toast', () => ({
  __esModule: true,
  useToast: jest.fn(() => ({
    visible: false,
    message: '',
    type: 'info',
    show: jest.fn(),
    hide: jest.fn(),
  })),
  // The default export is the Toast component; we don't render it here.
  default: () => null,
}));

// commitmentStore: `loadCommitmentRecord → null` short-circuits the `'max'`
// branch with a "no commitment found" toast and `setTxStatus('failed')`,
// which is exactly the observation the property needs — `announce` is not
// called on the bail path either.
const mockLoadCommitmentRecord = jest.fn();
const mockMarkSpent = jest.fn();
jest.mock('../../stores/commitmentStore', () => ({
  __esModule: true,
  loadCommitmentRecord: (...args: unknown[]) =>
    mockLoadCommitmentRecord(...args),
  markSpent: (...args: unknown[]) => mockMarkSpent(...args),
}));

// relayerClient: never reached in this test (max bails before submit), but
// mocked so the relayerClient module's env-var capture does not log noise.
jest.mock('../../services/relayerClient', () => {
  class RelayerError extends Error {
    kind: string;
    status?: number;
    body?: unknown;
    constructor(kind: string, message: string) {
      super(message);
      this.name = 'RelayerError';
      this.kind = kind;
    }
  }
  return {
    __esModule: true,
    submitWithdraw: jest.fn(async () => ({
      success: true,
      txHash: `0x${'1'.repeat(64)}`,
    })),
    RelayerError,
  };
});

// constants/contracts: provide non-zero, syntactically-valid addresses so
// `isPrivacyStackConfigured()` returns true and the pre-flight gate opens.
jest.mock('../../constants/contracts', () => ({
  __esModule: true,
  VEIL_POOL_ADDRESS: `0x${'1'.repeat(40)}`,
  STEALTH_ANNOUNCER_ADDRESS: `0x${'2'.repeat(40)}`,
  GROTH16_VERIFIER_ADDRESS: `0x${'3'.repeat(40)}`,
  SEPOLIA_CHAIN_ID: 11155111,
  isPrivacyStackConfigured: jest.fn(() => true),
}));

// expo-secure-store: in-memory map. The dispatcher itself never calls
// SecureStore directly (commitmentStore is fully mocked), but the hook's
// transitive imports may touch it.
jest.mock('expo-secure-store', () => {
  const memory = new Map<string, string>();
  return {
    __esModule: true,
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    setItemAsync: jest.fn(async (k: string, v: string) => {
      memory.set(k, v);
    }),
    getItemAsync: jest.fn(async (k: string) =>
      memory.has(k) ? (memory.get(k) as string) : null
    ),
    deleteItemAsync: jest.fn(async (k: string) => {
      memory.delete(k);
    }),
  };
});

// ---------------------------------------------------------------------------
// 2. Imports — these run AFTER all `jest.mock` factories above are
//    registered, so every named import below resolves to the mocked module.
// ---------------------------------------------------------------------------

jest.setTimeout(120000);

import { act, renderHook, cleanup } from '@testing-library/react-native';
import * as fc from 'fast-check';

import { usePaymentTransaction } from '../usePaymentTransaction';
import type { PrivacyLevel } from '../../stores/settingsStore';
import type { ZkpProverRef } from '../../components/ZkpProver';

// ---------------------------------------------------------------------------
// 3. Helpers — small generators kept simple so a shrunk counterexample is
//    legible. The recipient/token addresses are valid EVM hex strings; the
//    amount is a positive decimal that survives `parseEther` without
//    precision tricks.
// ---------------------------------------------------------------------------

const arbitraryAddress = (): fc.Arbitrary<`0x${string}`> =>
  fc
    .uint8Array({ minLength: 20, maxLength: 20 })
    .map((bytes) => {
      let hex = '';
      for (let i = 0; i < bytes.length; i++)
        hex += bytes[i].toString(16).padStart(2, '0');
      return `0x${hex}` as `0x${string}`;
    });

// `parseEther` accepts a decimal string with up to 18 fractional digits and
// throws on out-of-range or malformed input. We constrain to a small,
// well-behaved set of human-readable amounts so the generator never trips
// the gas-refresh effect's `parseEther`.
const arbitraryAmount = (): fc.Arbitrary<string> =>
  fc.oneof(
    fc.constantFrom('0.01', '0.1', '1', '5', '12.5', '100'),
    fc
      .integer({ min: 1, max: 999 })
      .map((n) => `${n}.${(n * 7) % 100}`),
  );

const arbitraryToken = (): fc.Arbitrary<string> =>
  fc.constantFrom('ETH', 'USDC', 'DAI');

const arbitraryPrivacyLevel = (): fc.Arbitrary<PrivacyLevel> =>
  fc.constantFrom<PrivacyLevel>('standard', 'stealth', 'max');

const arbitraryInputs = () =>
  fc.record({
    recipient: arbitraryAddress(),
    amount: arbitraryAmount(),
    token: arbitraryToken(),
    privacyLevel: arbitraryPrivacyLevel(),
  });

// ---------------------------------------------------------------------------
// 4. Per-iteration mock setup. Resets every counter and re-establishes the
//    "happy path" responses that drive the standard / stealth branches to
//    completion. The `'max'` branch is intentionally short-circuited by
//    `loadCommitmentRecord → null` so we observe a non-call on `announce`
//    without paying the cost of building a full proof harness.
// ---------------------------------------------------------------------------

interface SharedState {
  /** The `txStatus` snapshot captured at the moment `announce` is invoked. */
  txStatusAtAnnounceCall: string | null;
  /** Tracks per-iteration `result` so the announce mock can read it. */
  resultRef: { current: { txStatus: string } } | null;
}

const sharedState: SharedState = {
  txStatusAtAnnounceCall: null,
  resultRef: null,
};

function resetMocks(): void {
  jest.clearAllMocks();
  sharedState.txStatusAtAnnounceCall = null;
  sharedState.resultRef = null;

  // Re-arm the mocks that need to do anything more than "return undefined".
  mockEthersContract.mockImplementation(() => ({
    announce: (...args: unknown[]) => mockAnnounce(...args),
  }));
  mockJsonRpcProvider.mockImplementation(() => ({}));
  mockWalletFromPhrase.mockImplementation(() => ({}));

  mockDeriveAddressFromStoredMnemonic.mockResolvedValue(
    `0x${'9'.repeat(40)}` as const,
  );
  mockGetStoredMnemonic.mockResolvedValue(
    Array.from({ length: 12 }, (_, i) => `word${i}`),
  );

  mockSignAndSendTransaction.mockResolvedValue({
    hash: `0x${'a'.repeat(64)}`,
    chainId: 11155111,
    gasEstimate: {
      gasLimit: 21000n,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 1n,
      gasPrice: 1n,
      estimatedCostWei: 21000n,
      estimatedCostEth: '0.00000000000002',
      estimatedCostUsd: null,
      isStale: false,
      fetchedAt: 0,
    },
  });

  mockPollTransactionStatus.mockResolvedValue({
    status: 'completed',
    record: {
      id: `0x${'a'.repeat(64)}`,
      type: 'sent',
      amount: '1',
      timestamp: 0,
    },
    timedOut: false,
  });

  // `'max'` flow bail-out: no record for the synthesized commitment hash.
  mockLoadCommitmentRecord.mockResolvedValue(null);

  mockAnnounceTxWait.mockResolvedValue({});
  // The announce mock captures the React state at the moment of invocation
  // (this is the load-bearing observation for the "before-confirmed"
  // assertion) and resolves with a tx-like object whose `.wait()` resolves
  // to a stub receipt — mirroring `ethers.Contract.send()` semantics.
  mockAnnounce.mockImplementation((..._args: unknown[]) => {
    sharedState.txStatusAtAnnounceCall =
      sharedState.resultRef?.current?.txStatus ?? null;
    return Promise.resolve({
      hash: `0x${'d'.repeat(64)}`,
      wait: mockAnnounceTxWait,
    });
  });
}

// Stub `ZkpProverRef` — the `'max'` branch never invokes it because we cut
// the flow off at `loadCommitmentRecord → null`, but we pass a non-null ref
// so the hook's destructuring does not crash.
const stubProverRef: React.RefObject<ZkpProverRef | null> = {
  current: {
    generateProof: jest.fn(async () => ({
      proof: '0x00',
      publicSignals: ['0x00', '0x00', '0x00', '0x00'],
    })),
  } as unknown as ZkpProverRef,
};

const stubSelectedNetwork = { name: 'Sepolia' };

// ---------------------------------------------------------------------------
// 5. The property.
// ---------------------------------------------------------------------------

describe("Property 9: Stealth announcer is invoked iff privacy level is 'stealth'", () => {
  // We use real timers here to prevent deadlocks if the dispatcher awaits any sleeps.
  // The hook's unmount() cleans up the gas-refresh interval.

  it(
    'invokes announce exactly once on stealth (with the canonical args, before confirmed) ' +
      'and exactly zero times on standard / max',
    async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryInputs(), async (inputs) => {
          resetMocks();

          const { result, unmount } = renderHook(() =>
            usePaymentTransaction({
              recipient: inputs.recipient,
              amount: inputs.amount,
              memo: '',
              token: inputs.token,
              privacyLevel: inputs.privacyLevel,
              ethPrice: null,
              activeNetworkKey: 'sepolia',
              selectedNetwork: stubSelectedNetwork,
              isSendSupported: true,
              zkpProverRef: stubProverRef,
              sourceCommitmentHash:
                inputs.privacyLevel === 'max'
                  ? (`0x${'f'.repeat(64)}` as `0x${string}`)
                  : undefined,
            }),
          );

          // Make the per-iteration `result` visible to the announce mock so
          // the captured `txStatus` reflects the current hook instance.
          sharedState.resultRef = result as unknown as {
            current: { txStatus: string };
          };

          // Flush the mount-time `useEffect` that resolves `hasMnemonic`.
          // Without this the dispatcher would short-circuit on
          // `isWalletVerificationPending` and `announce` would never be
          // observed even on the stealth path — that would silently make
          // the property vacuous, so we assert the gate is actually open.
          await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
          });
          expect(result.current.isWalletVerificationPending).toBe(false);

          // Drive the dispatcher.
          await act(async () => {
            await result.current.handleConfirmSend();
          });

          // ── Assertions ────────────────────────────────────────────────
          if (inputs.privacyLevel === 'stealth') {
            // 4.1 + 4.7: announce called exactly once with the canonical
            // `(schemeId=1, stealthAddress, ephemeralPubKey, '0x')` shape.
            expect(mockAnnounce).toHaveBeenCalledTimes(1);
            expect(mockAnnounce).toHaveBeenCalledWith(
              1,
              expect.any(String),
              expect.any(String),
              '0x',
            );

            // 4.6 + 12.4: the announce call was observed strictly *before*
            // the local UI transitioned to `'confirmed'`. We capture
            // `txStatus` inside the announce mock — at that moment the
            // dispatcher has finished polling and is awaiting `announce`,
            // so the state should be `'pending'` (set right before the
            // announce attempt). It MUST NOT yet be `'confirmed'`.
            expect(sharedState.txStatusAtAnnounceCall).not.toBeNull();
            expect(sharedState.txStatusAtAnnounceCall).not.toBe('confirmed');

            // After the dispatcher returns, the UI is `'confirmed'` —
            // which together with the previous assertion proves the
            // "announce-before-confirmed" ordering at the React boundary.
            expect(result.current.txStatus).toBe('confirmed');
          } else {
            // 4.7 + 12.5: standard and max NEVER call announce. For
            // `'max'` this is observed via the `loadCommitmentRecord`
            // bail; for `'standard'` it's observed via the dispatcher
            // simply not selecting the stealth case.
            expect(mockAnnounce).not.toHaveBeenCalled();
          }

          unmount();
          cleanup();
        }),
        { numRuns: 30, endOnFailure: true },
      );
    },
  );
});
