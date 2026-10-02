// Feature: veilpay-privacy-stack, max-privacy withdraw proof-prep (SEC-004).
//
// Drives the REAL `usePaymentTransaction` dispatcher down the `'max'`
// branch (the DATA-002 feature gate is mocked OPEN for these cases only —
// the shipped `EVM_MAX_PRIVACY_WITHDRAW_READY` stays false in
// constants/contracts.ts) and pins down the SEC-004 + 5-signal wiring:
//
//   1. `validateNullifierHash(record.nullifier, record.nullifierHash)` —
//      the stored-vs-recomputed Poseidon nullifier hash check — runs
//      BEFORE `generateProof` (never prove against a corrupted commitment).
//   2. A mismatch throws `NullifierHashError`, which the dispatcher maps to
//      a proof-prep FAILURE (txStatus 'failed' + toast + analytics reason),
//      never a crash, and never reaches the prover or the relayer.
//   3. On the happy path, `generateProof` receives the full NINE-signal
//      input shape (incl. the public `token` signal), and the relayer body
//      carries `publicSignals` serialized from the prover's decimal output
//      into the schema's per-element wire formats.
//
// The mock harness mirrors usePaymentTransaction.dispatch.property.test.ts
// (the established pattern for loading the hook in the jest sandbox).
import React from 'react';
import { act, renderHook } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mocks — declared BEFORE the hook import (babel hoists jest.mock).
// ---------------------------------------------------------------------------

// The DATA-002 gate: open ONLY inside this test file so the 'max' branch is
// reachable. The real constant stays false (contracts.ts — not this file).
jest.mock('../../hooks/usePrivacyOptions', () => ({
  __esModule: true,
  isMaxPrivacyWithdrawReady: jest.fn(() => true),
  isSppPoolOpsReady: jest.fn(() => true),
}));

// SEC-004 seam: only `validateNullifierHash` is replaced. The REAL
// `NullifierHashError` class flows through from the actual module so the
// dispatcher's `instanceof` check observes genuine class identity (the
// real module loads fine in jest — circomlibjs is moduleNameMapped to its
// manual mock — and its own suite covers the cryptographic behavior).
const mockValidateNullifierHash = jest.fn();
jest.mock('../../utils/nullifierHashValidation', () => {
  const actual = jest.requireActual('../../utils/nullifierHashValidation');
  return {
    __esModule: true,
    ...actual,
    validateNullifierHash: (...args: unknown[]) =>
      mockValidateNullifierHash(...(args as [string, string])),
  };
});
// The real class from the (partially mocked) module — same instance the
// dispatcher imports, so instanceof holds.
import { NullifierHashError } from '../../utils/nullifierHashValidation';

const mockGenerateProof = jest.fn();
const mockSubmitWithdraw = jest.fn();
const mockMarkSpent = jest.fn();
const mockLoadCommitmentRecord = jest.fn();
const mockPollTransactionStatus = jest.fn();
const mockTrackEvent = jest.fn();
const mockToastShow = jest.fn();

jest.mock('../../utils/solanaSigner', () => ({
  signAndSendSolanaTransaction: jest.fn(),
}));
jest.mock('../../utils/stellarSigner', () => ({
  signAndSendStellarTransaction: jest.fn(),
}));
jest.mock('../../utils/secureSigner', () => ({
  signAndSendTransaction: jest.fn(),
  deriveAddressFromStoredMnemonic: jest.fn(async () => `0x${'9'.repeat(40)}`),
}));
jest.mock('../../utils/transactions', () => {
  const actual = jest.requireActual('../../utils/transactions');
  return {
    __esModule: true,
    ...actual,
    getStoredMnemonic: jest.fn(async () => ['word']),
  };
});
jest.mock('../../utils/txStatusPoller', () => ({
  pollTransactionStatus: (...args: unknown[]) =>
    mockPollTransactionStatus(...args),
}));
jest.mock('../../utils/analytics', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  ANALYTICS_EVENTS: {
    PAYMENT_SEND_ATTEMPTED: 'payment_send_attempted',
    PAYMENT_SEND_VALIDATION_FAILED: 'payment_send_validation_failed',
    PAYMENT_SEND_FAILED: 'payment_send_failed',
    PAYMENT_SEND_SUBMITTED: 'payment_send_submitted',
    PAYMENT_SEND_CONFIRMED: 'payment_send_confirmed',
  },
}));
jest.mock('../../utils/gasEstimator', () => ({
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
jest.mock('../../utils/directory', () => ({
  fetchRecipientPublicKey: jest.fn(),
}));
jest.mock('../../utils/stealthEngine', () => ({
  deriveStealthAddress: jest.fn(() => ({
    stealthAddress: `0x${'b'.repeat(40)}`,
    ephemeralPubKey: `0x${'02'.padEnd(66, 'c')}`,
  })),
}));
jest.mock('../../utils/encryption', () => ({
  encryptNote: jest.fn(),
  generateEphemeralKeyPair: jest.fn(() => ({
    publicKey: new Uint8Array(32),
    secretKey: new Uint8Array(32),
  })),
}));
jest.mock('../../utils/stellarSpp', () => {
  // The dispatcher's catch chain does `error instanceof SppClientError`, so
  // the mock must export a real class.
  class SppClientError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = 'SppClientError';
      this.code = code;
    }
  }
  return {
    __esModule: true,
    SppClientError,
    deposit: jest.fn(),
    transfer: jest.fn(),
    withdraw: jest.fn(),
    createSppActivityRecord: jest.fn(),
    getSppConfigForChain: jest.fn(() => null),
    isSppEnabledForChain: jest.fn(() => false),
    STELLAR_CLASSIC_FEE_STROOPS: 100,
    sppFeeCeilingStroops: jest.fn(() => 100000),
    stroopsToXlm: jest.fn(() => '0.01'),
  };
});
jest.mock('../../utils/rpc', () => ({
  getRpcUrl: jest.fn(() => 'https://mock-rpc.veilpay.test'),
}));

const MOCK_WALLET_STATE = {
  activeChain: { type: 'evm', key: 'sepolia' },
  address: `0x${'9'.repeat(40)}`,
};
jest.mock('../../stores/walletStore', () => ({
  __esModule: true,
  useWalletStore: jest.fn(() => MOCK_WALLET_STATE),
}));
jest.mock('../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: jest.fn(() => ({
    isConnected: true,
    isInternetReachable: true,
    type: 'wifi',
  })),
}));
jest.mock('../../components/Toast', () => ({
  useToast: jest.fn(() => ({
    visible: false,
    message: '',
    type: 'info',
    show: mockToastShow,
    hide: jest.fn(),
  })),
  default: () => null,
}));
jest.mock('../../stores/commitmentStore', () => ({
  __esModule: true,
  loadCommitmentRecord: (...args: unknown[]) =>
    mockLoadCommitmentRecord(...args),
  markSpent: (...args: unknown[]) => mockMarkSpent(...args),
}));
jest.mock('../../services/relayerClient', () => {
  class RelayerError extends Error {
    kind: string;
    constructor(kind: string, message: string) {
      super(message);
      this.name = 'RelayerError';
      this.kind = kind;
    }
  }
  return {
    __esModule: true,
    submitWithdraw: (...args: unknown[]) => mockSubmitWithdraw(...args),
    RelayerError,
  };
});
jest.mock('../../constants/contracts', () => ({
  __esModule: true,
  VEIL_POOL_ADDRESS: `0x${'1'.repeat(40)}`,
  STEALTH_ANNOUNCER_ADDRESS: `0x${'2'.repeat(40)}`,
  isPrivacyStackConfigured: jest.fn(() => true),
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('../../stores/transactionStore', () => ({
  __esModule: true,
  useTransactionStore: { getState: () => ({ addTransaction: jest.fn() }) },
}));

// ---------------------------------------------------------------------------
// Fixtures — a full forward-compat CommitmentRecord (paths + nullifierHash)
// ---------------------------------------------------------------------------

import { usePaymentTransaction } from '../usePaymentTransaction';
import type { ZkpProverRef } from '../../components/ZkpProver';

const RECORD = {
  nullifier: `0x${'1'.repeat(64)}` as `0x${string}`,
  secret: `0x${'2'.repeat(64)}` as `0x${string}`,
  commitmentHash: `0x${'3'.repeat(64)}` as `0x${string}`,
  leafIndex: 0,
  merkleRoot: `0x${'4'.repeat(64)}` as `0x${string}`,
  amount: '1000000',
  token: `0x${'6'.repeat(40)}` as `0x${string}`,
  chainKey: 'evm-sepolia',
  timestamp: 0,
  spent: false,
  pathElements: Array.from({ length: 20 }, () => `0x${'a'.repeat(64)}`) as `0x${string}`[],
  pathIndices: Array.from({ length: 20 }, () => 0),
  nullifierHash: `0x${'5'.repeat(64)}` as `0x${string}`,
};

const RECIPIENT = `0x${'9'.repeat(40)}`;

// snarkjs-style proof result: publicSignals as DECIMAL strings in the
// circuit's declaration order [merkleRoot, nullifierHash, recipient,
// amount, token].
const PROOF_RESULT = {
  proof: { pi_a: ['1'], pi_b: [['2']], pi_c: ['3'], protocol: 'groth16', curve: 'bn128' },
  publicSignals: [
    BigInt('0x' + '4'.repeat(64)).toString(),
    BigInt('0x' + '5'.repeat(64)).toString(),
    BigInt('0x' + '9'.repeat(40)).toString(),
    '1000000',
    BigInt('0x' + '6'.repeat(40)).toString(),
  ],
};

function buildHarness() {
  const proverRef: React.RefObject<ZkpProverRef | null> = {
    current: { generateProof: mockGenerateProof } as unknown as ZkpProverRef,
  };
  const { result, unmount } = renderHook(() =>
    usePaymentTransaction({
      recipient: RECIPIENT,
      amount: '1',
      memo: '',
      token: 'USDC',
      privacyLevel: 'max',
      ethPrice: null,
      activeNetworkKey: 'sepolia',
      selectedNetwork: { name: 'Sepolia' },
      isSendSupported: true,
      zkpProverRef: proverRef,
      sourceCommitmentHash: RECORD.commitmentHash,
    }),
  );
  return { result, unmount };
}

describe('usePaymentTransaction max withdraw: SEC-004 nullifier-hash gate + 5-signal wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadCommitmentRecord.mockResolvedValue(RECORD);
    mockValidateNullifierHash.mockResolvedValue(undefined);
    mockGenerateProof.mockResolvedValue(PROOF_RESULT);
    mockSubmitWithdraw.mockResolvedValue({
      success: true,
      txHash: `0x${'d'.repeat(64)}`,
    });
    mockPollTransactionStatus.mockResolvedValue({ status: 'completed' });
    mockMarkSpent.mockResolvedValue(undefined);
  });

  it(
    'validates the stored nullifierHash BEFORE proving, then proves with the 9-signal inputs and submits serialized publicSignals',
    async () => {
      const { result, unmount } = buildHarness();
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        await result.current.handleConfirmSend();
      });

      // SEC-004: the stored hash was checked against the recomputed
      // Poseidon(nullifier) before any proof work.
      expect(mockValidateNullifierHash).toHaveBeenCalledTimes(1);
      expect(mockValidateNullifierHash).toHaveBeenCalledWith(
        RECORD.nullifier,
        RECORD.nullifierHash,
      );

      // The prover ran after validation with the full 9-signal shape.
      expect(mockGenerateProof).toHaveBeenCalledTimes(1);
      const proveInputs = mockGenerateProof.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(Object.keys(proveInputs).sort()).toEqual([
        'amount',
        'merkleRoot',
        'nullifier',
        'nullifierHash',
        'pathElements',
        'pathIndices',
        'recipient',
        'secret',
        'token',
      ]);
      expect(proveInputs.token).toBe(RECORD.token);
      expect(proveInputs.recipient).toBe(RECIPIENT);
      expect(proveInputs.amount).toBe('1');

      // The relayer body carries the SERIALIZED publicSignals (decimal →
      // per-element wire formats), not the raw snarkjs decimals.
      expect(mockSubmitWithdraw).toHaveBeenCalledTimes(1);
      const body = mockSubmitWithdraw.mock.calls[0][0] as {
        publicSignals: string[];
        token: string;
        amount: string;
        recipient: string;
      };
      expect(body.publicSignals).toEqual([
        `0x${'4'.repeat(64)}`,
        `0x${'5'.repeat(64)}`,
        `0x${'9'.repeat(40)}`,
        '1000000',
        `0x${'6'.repeat(40)}`,
      ]);
      expect(body.token).toBe(RECORD.token);
      expect(body.amount).toBe(RECORD.amount);
      expect(body.recipient).toBe(RECIPIENT);

      expect(mockMarkSpent).toHaveBeenCalledWith(RECORD.commitmentHash);
      expect(result.current.txStatus).toBe('confirmed');
      unmount();
    },
    30_000,
  );

  it(
    'a nullifier-hash mismatch fails proof-prep (no proof, no relayer) with a typed failure surface',
    async () => {
      mockValidateNullifierHash.mockRejectedValue(
        new NullifierHashError(
          'Nullifier hash mismatch. Computed: 0xaa, Stored: 0xbb.',
          'NULLIFIER_HASH_MISMATCH',
        ),
      );

      const { result, unmount } = buildHarness();
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        await result.current.handleConfirmSend();
      });

      // The validation ran, but nothing downstream did.
      expect(mockValidateNullifierHash).toHaveBeenCalledTimes(1);
      expect(mockGenerateProof).not.toHaveBeenCalled();
      expect(mockSubmitWithdraw).not.toHaveBeenCalled();
      expect(mockMarkSpent).not.toHaveBeenCalled();

      // Proof-prep failure surface: failed status + user guidance toast +
      // analytics reason carried from the typed error code.
      expect(result.current.txStatus).toBe('failed');
      expect(result.current.txResult?.status).toBe('failed');
      expect(mockToastShow).toHaveBeenCalledWith(
        expect.stringContaining('Cannot verify this deposit note'),
        'error',
      );
      const reasons = mockTrackEvent.mock.calls
        .filter((c: unknown[]) => c[0] === 'payment_send_failed')
        .map((c: unknown[]) => (c[1] as Record<string, unknown>).reason);
      expect(reasons).toContain('nullifier_hash_mismatch');
      unmount();
    },
    30_000,
  );
});
