// Feature: veilpay-privacy-stack, Property 16: Relayer maps on-chain reverts to HTTP 422
//
// Validates: Requirements 6.6
//
// Property 16 (see design.md §Correctness Properties):
//
//   *For any* relayer request that reaches `VeilPool.withdraw` and triggers a
//   revert with reason string `r` (including the empty reason), the relayer
//   SHALL respond with HTTP 422 and a body of `{ success: false, error: <reason> }`
//   where `<reason>` equals `r` if `r` is non-empty and equals
//   `"transaction reverted"` if `r` is empty; AND the relayer SHALL NOT retry
//   the request.
//
// Why we test the boundary, not the underlying ethers wiring
// ----------------------------------------------------------
// `handleWithdraw` owns the mapping from "the on-chain call rejected" to the
// HTTP 422 response shape. The two paths it must handle are:
//
//   1. *Custom-error revert.* The pool reverts with one of the four
//      Solidity custom errors declared in `VEILPOOL_ABI`
//      (`InvalidMerkleRoot`, `InvalidProof`, `NullifierAlreadySpent`,
//      `TreeFull`). ethers surfaces these as an error whose `.data` is the
//      4-byte selector hex; the relayer's `parseRevertReason` decodes the
//      selector via `Interface.parseError` and surfaces the error *name*.
//
//   2. *String-revert / unknown revert.* The pool reverts with a Solidity
//      `revert("...")` (or any other shape). ethers surfaces the reason as
//      `.reason`; if the reason is the empty string the relayer falls back
//      to the literal string `"transaction reverted"`.
//
// We pin both paths down with a single property by `oneof`-ing over the
// revert spec and checking the response body carries the right reason. The
// "no retry" half of the property is observed locally: only `staticCall`
// is invoked when simulation rejects, and the broadcast mock
// (`contractMock.withdraw`) is asserted to never have been called.
//
// Mocking strategy
// ----------------
//   1. Configure relayer env (`RELAYER_PRIVATE_KEY`, `RELAYER_RPC_URL`,
//      `RELAYER_VEILPOOL_ALLOWLIST`) *before* the controller module is
//      required. The controller captures the allowlist + key flag at
//      module-load time (`loadAllowlist()` / `RELAYER_KEY_CONFIGURED`),
//      so a plain assignment after `import` would be too late. We set
//      the env up top and use `jest.isolateModules` inside `beforeAll`
//      to require a fresh controller and routes module.
//   2. Mock `ethers` so that `new ethers.Contract(...)` returns a stub
//      whose `.withdraw` is a jest fn and whose `.withdraw.staticCall`
//      is a jest fn we can stage to reject with the spec'd error
//      shape. We keep `ethers.Interface`, `ethers.id`, and other
//      utilities actual via `jest.requireActual` so the controller's
//      revert decoder runs the *real* ABI logic against the same
//      bytes any real revert would carry.
//   3. Mount the freshly-required `relayerRoutes` on a fresh express
//      app and drive requests with `supertest`.

const ORIGINAL_ENV = process.env;

process.env = {
  ...ORIGINAL_ENV,
  NODE_ENV: 'test',
  // JWT_SECRET, API_KEY_SALT, WEBHOOK_SIGNING_SECRET are required by the
  // backend config loader but irrelevant to the relayer path.
  JWT_SECRET: 'x'.repeat(32),
  API_KEY_SALT: 'y'.repeat(32),
  WEBHOOK_SIGNING_SECRET: 'z'.repeat(32),
  DATABASE_URL: 'postgresql://veilpay:veilpay_dev_password@localhost:5432/veilpay',
  CORS_ORIGINS: '*',
  // ---- Relayer config ----
  // Random valid 32-byte private key. Real bytes; ethers.Wallet constructs
  // successfully against it. The provider is mocked, so no network I/O.
  RELAYER_PRIVATE_KEY:
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  RELAYER_RPC_URL: 'http://127.0.0.1:8545',
  // The allowlist must include the contract address used in generated
  // request bodies; `ALLOWLISTED_POOL` (below) is reused by the generator.
  RELAYER_VEILPOOL_ALLOWLIST: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  // Clear host Doppler/shell pollution that would short-circuit the handler
  // (SEC-006 shared secret, SEC-013 amount cap) before simulation runs.
  RELAYER_SHARED_SECRET: '',
  RELAYER_MAX_WITHDRAW_AMOUNT: '',
  RELAYER_ALLOW_UNAUTHENTICATED: 'true',
};

const ALLOWLISTED_POOL = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

// ---------------------------------------------------------------------------
// ethers mock — replace `Contract`, `JsonRpcProvider`, and `Wallet` while
// keeping the rest (`Interface`, `id`, `getAddress`, etc.) actual. The
// controller's revert decoder relies on the real `Interface.parseError`
// to map selector hex to error names.
// ---------------------------------------------------------------------------

const realEthers = jest.requireActual('ethers') as typeof import('ethers');

// Singleton mock so each test can stage staticCall rejections and observe
// broadcast (non-)calls without re-grabbing references after every reset.
const contractMock: {
  withdraw: jest.Mock & { staticCall: jest.Mock };
} = {
  withdraw: Object.assign(jest.fn(), { staticCall: jest.fn() }) as jest.Mock & {
    staticCall: jest.Mock;
  },
};

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers') as typeof import('ethers');
  const mocked = {
    ...actual,
    // Constructor returns the singleton; its `withdraw` is the jest fn
    // and `withdraw.staticCall` is its sub-fn. Argument shape is
    // `(address, abi, signerOrProvider)`.
    Contract: jest.fn().mockImplementation(() => contractMock),
    // Provider/Wallet are constructed inside `buildSigner()`; we just
    // need them to not throw. Real Wallet construction would also work,
    // but mocking sidesteps the real provider's network probe.
    JsonRpcProvider: jest.fn().mockImplementation(() => ({})),
    Wallet: jest.fn().mockImplementation(() => ({})),
  };
  mocked.ethers = mocked as any;
  return mocked;
});

import * as fc from 'fast-check';
import express, { type Express } from 'express';
import request from 'supertest';

import type { WithdrawRequest } from '../../schemas/withdrawRequest';

// ---------------------------------------------------------------------------
// Lazy-loaded handles to the freshly-required controller / routes.
// ---------------------------------------------------------------------------
let app: Express;

beforeAll(() => {
  // jest.resetModules + jest.doMock is the reliable way to load a fresh module
  // with a custom mock. isolateModules + doMock does not reliably apply.
  jest.resetModules();
  jest.doMock('ethers', () => {
    const actual = jest.requireActual('ethers') as typeof import('ethers');
    const mocked = {
      ...actual,
      Contract: jest.fn().mockImplementation(() => contractMock),
      JsonRpcProvider: jest.fn().mockImplementation(() => ({})),
      Wallet: jest.fn().mockImplementation(() => ({})),
    };
    mocked.ethers = mocked as any;
    return mocked;
  });

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { withdraw } = require('../relayerController') as {
    withdraw: (
      req: import('express').Request,
      res: import('express').Response,
      next: import('express').NextFunction
    ) => Promise<void>;
  };

  // Mount directly to bypass the auth rate limiter.
  app = express();
  app.use(express.json());
  app.post('/api/v1/relayer/withdraw', (req, res, next) => {
    Promise.resolve(withdraw(req, res, next)).catch(next);
  });
});


afterAll(() => {
  process.env = ORIGINAL_ENV;
});

beforeEach(() => {
  contractMock.withdraw.mockReset();
  contractMock.withdraw.staticCall.mockReset();
  // SEC-006 circuit breaker trips after ~20 consecutive simulation failures;
  // property tests run 30 iterations so we must clear state between runs.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { __test } = require('../../utils/relayerQuota') as {
      __test: { reset: () => void };
    };
    __test.reset();
  } catch {
    // ignore if module shape changes
  }
});

// ---------------------------------------------------------------------------
// Custom-error selectors. Computed via real ethers.id keccak256 so they
// stay in lockstep with the relayer's `VEILPOOL_INTERFACE.parseError`.
// ---------------------------------------------------------------------------
const SELECTORS = {
  InvalidMerkleRoot: realEthers.id('InvalidMerkleRoot()').slice(0, 10),
  InvalidProof: realEthers.id('InvalidProof()').slice(0, 10),
  NullifierAlreadySpent: realEthers.id('NullifierAlreadySpent()').slice(0, 10),
  TreeFull: realEthers.id('TreeFull()').slice(0, 10),
} as const;

// ---------------------------------------------------------------------------
// Smart generators — produce WithdrawRequest bodies that satisfy the
// strict schema regexes verbatim. The schema rejects mixed casing in
// `recipient`/`token`/`contractAddress` checksums (it accepts any
// 0x-prefixed 40-char hex in either case), so we use lowercase. The
// `contractAddress` is pinned to ALLOWLISTED_POOL because non-allowlisted
// addresses short-circuit at HTTP 400 before the simulate-broadcast path
// we want to exercise.
// ---------------------------------------------------------------------------

const HEX_CHARS = '0123456789abcdef';

const hexStringOfLength = (n: number): fc.Arbitrary<string> =>
  fc
    .array(fc.constantFrom(...HEX_CHARS.split('')), { minLength: n, maxLength: n })
    .map((chars) => chars.join(''));

const arbitraryBytes32Hex = (): fc.Arbitrary<string> =>
  hexStringOfLength(64).map((h) => `0x${h}`);

const arbitraryAddress = (): fc.Arbitrary<string> =>
  hexStringOfLength(40).map((h) => `0x${h}`);

// Even-length non-empty hex satisfying `^0x[0-9a-fA-F]+$`. 256 bytes is
// well above a real Groth16 proof (~256 bytes encoded) and keeps
// generation fast.
const arbitraryHexBlob = (): fc.Arbitrary<string> =>
  fc
    .integer({ min: 1, max: 256 })
    .chain((nBytes) => hexStringOfLength(nBytes * 2))
    .map((h) => `0x${h}`);

const arbitraryPositiveDecimal = (): fc.Arbitrary<string> =>
  fc
    .tuple(
      fc.integer({ min: 1, max: 9 }),
      fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 0, maxLength: 32 })
    )
    .map(([head, rest]) => `${head}${rest.join('')}`);

const arbitraryWithdrawRequest = (): fc.Arbitrary<WithdrawRequest> =>
  fc.record({
    nullifierHash: arbitraryBytes32Hex(),
    proof: arbitraryHexBlob(),
    publicSignals: fc.tuple(
      arbitraryHexBlob(),
      arbitraryHexBlob(),
      arbitraryHexBlob(),
      arbitraryHexBlob()
    ),
    merkleRoot: arbitraryBytes32Hex(),
    recipient: arbitraryAddress(),
    token: arbitraryAddress(),
    amount: arbitraryPositiveDecimal(),
    chainKey: fc.constant('evm-sepolia' as const),
    contractAddress: fc.constant(ALLOWLISTED_POOL),
  }) as fc.Arbitrary<WithdrawRequest>;

// ---------------------------------------------------------------------------
// Revert-spec generator. Five classes:
//   - one constant per custom-error selector (decoded via parseError →
//     error name)
//   - a string-revert path with arbitrary `reason`, including the
//     empty string (decoded via the `reason` field → falls back to
//     "transaction reverted" when empty)
// `expected` is what the response body's `error` must equal.
// ---------------------------------------------------------------------------

interface RevertSpec {
  /** If set, the mocked rejection has `.data = data`. */
  data?: string;
  /** If set, the mocked rejection has `.reason = reason`. */
  reason?: string;
  /** The `error` string the controller must return in the 422 body. */
  expected: string;
}

const arbitraryRevertSpec = (): fc.Arbitrary<RevertSpec> =>
  fc.oneof(
    fc.constant<RevertSpec>({
      data: SELECTORS.InvalidMerkleRoot,
      expected: 'InvalidMerkleRoot',
    }),
    fc.constant<RevertSpec>({
      data: SELECTORS.InvalidProof,
      expected: 'InvalidProof',
    }),
    fc.constant<RevertSpec>({
      data: SELECTORS.NullifierAlreadySpent,
      expected: 'NullifierAlreadySpent',
    }),
    fc.constant<RevertSpec>({
      data: SELECTORS.TreeFull,
      expected: 'TreeFull',
    }),
    fc.string().map<RevertSpec>((s) => ({
      reason: s,
      expected: s.length > 0 ? s : 'transaction reverted',
    }))
  );

// ---------------------------------------------------------------------------
// The property.
// ---------------------------------------------------------------------------

describe('Property 16 — relayer maps on-chain reverts to HTTP 422', () => {
  it(
    'returns 422 with { success: false, error: <reason | "transaction reverted"> } and never broadcasts',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryRevertSpec(),
          arbitraryWithdrawRequest(),
          async (revertSpec, body) => {
            // Reset between iterations so call counts and staged
            // rejections don't leak across runs.
            contractMock.withdraw.mockReset();
            contractMock.withdraw.staticCall.mockReset();
            try {
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const { __test } = require('../../utils/relayerQuota') as {
                __test: { reset: () => void };
              };
              __test.reset();
            } catch {
              /* ignore */
            }

            // Build the rejection shape exactly as ethers v6 surfaces
            // it. The controller's `extractRevertData` probes `.data`
            // first, then falls back to `.reason` / `.shortMessage`,
            // so populating the right field is enough to drive each
            // branch of `parseRevertReason`.
            const err =
              revertSpec.data !== undefined
                ? { data: revertSpec.data }
                : { reason: revertSpec.reason };
            contractMock.withdraw.staticCall.mockRejectedValueOnce(err);

            const res = await request(app)
              .post('/api/v1/relayer/withdraw')
              .send(body);

            // HTTP status: 422 for every revert path.
            expect(res.status).toBe(422);

            // Body shape: { success: false, error: string }.
            expect(res.body).toEqual({
              success: false,
              error: revertSpec.expected,
            });

            // No retry: the broadcast (the bare `withdraw(...)` call,
            // distinct from the staticCall simulation) was never
            // invoked. This pins down the second half of the property
            // — Requirement 6.9, "no gas consumed for an invalid
            // proof".
            expect(contractMock.withdraw).not.toHaveBeenCalled();

            // Sanity: simulation was attempted exactly once.
            expect(contractMock.withdraw.staticCall).toHaveBeenCalledTimes(1);
          }
        ),
        { numRuns: 30 }
      );
    },
    30_000
  );
});
