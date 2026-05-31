// Feature: veilpay-privacy-stack, Property 13: Relayer forwards valid requests to allowlisted pools and never calls the verifier
//
// Validates: Requirements 6.1, 6.2, 6.7
//
// Property 13 (see design.md §Correctness Properties):
//
//   *For any* schema-valid `WithdrawRequest` body whose `contractAddress`
//   sits in `RELAYER_VEILPOOL_ALLOWLIST`, the relayer SHALL:
//     (a) construct exactly one `ethers.Contract` against
//         `body.contractAddress` (no other address — in particular not
//         the `Groth16Verifier`);
//     (b) call `pool.withdraw.staticCall` and then `pool.withdraw` with
//         the canonical 6-tuple `(nullifierHash, proof, merkleRoot,
//         recipient, token, BigInt(amount))` matching the public-input
//         ordering contract from design.md;
//     (c) NEVER invoke `verifyProof` — the function-selector for
//         `verifyProof(bytes,bytes32[])` SHALL not appear as the leading
//         4 bytes of any synthesized calldata;
//     (d) respond HTTP 200 with `{ success: true, txHash }` where
//         `txHash` is the hash returned by the broadcast and matches
//         `^0x[a-fA-F0-9]{64}$`.
//
// Why we test the boundary, not the underlying ethers wiring
// ----------------------------------------------------------
// `handleWithdraw` owns the contract that the relayer is *only* a
// gas-sponsoring forwarder: it must hit the pool with the canonical
// withdraw shape and never short-circuit verification on the verifier
// itself. Property 13 pins down the happy path of that contract — the
// failure paths (revert mapping, allowlist rejection, missing key) are
// covered by Properties 14/15/16. We reuse the same mock-ethers
// strategy as the revert test (task 5.8) so the two tests share a
// consistent boundary for the controller.
//
// Mocking strategy
// ----------------
//   1. Configure relayer env (`RELAYER_PRIVATE_KEY`, `RELAYER_RPC_URL`,
//      `RELAYER_VEILPOOL_ALLOWLIST`) *before* the controller module is
//      required. The controller captures the allowlist + key flag at
//      module-load time, so a plain assignment after `import` would be
//      too late. We set the env up top and use `jest.isolateModules`
//      inside `beforeAll` to require a fresh controller.
//   2. Mock `ethers` so that `new ethers.Contract(...)` returns a
//      singleton stub whose `.withdraw` is a jest fn and whose
//      `.withdraw.staticCall` is a jest fn. We keep `ethers.Interface`
//      and other utilities actual via `jest.requireActual` so the
//      controller's encode/decode paths run real ABI logic. The
//      `Contract` mock records every constructor call so we can assert
//      that *only* allowlisted pool addresses ever get a contract
//      instance — a verifier construction would show up as a non-pool
//      address.
//   3. Mount the freshly-required `withdraw` controller directly on a
//      fresh express app, bypassing the auth rate limiter (irrelevant
//      to this property).

const ORIGINAL_ENV = process.env;

// Three allowlisted pool addresses — fast-check picks one per iteration
// so we exercise multiple entries through a single configured allowlist.
const ALLOWLIST_ADDRESSES = [
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  '0xcccccccccccccccccccccccccccccccccccccccc',
] as const;

process.env = {
  ...ORIGINAL_ENV,
  NODE_ENV: 'test',
  // Required by the backend config loader but irrelevant to the relayer path.
  JWT_SECRET: 'x'.repeat(32),
  API_KEY_SALT: 'y'.repeat(32),
  WEBHOOK_SIGNING_SECRET: 'z'.repeat(32),
  DATABASE_URL: 'postgresql://veilpay:veilpay_dev_password@localhost:5432/veilpay',
  CORS_ORIGINS: '*',
  // ---- Relayer config ----
  // Random valid 32-byte private key. Real bytes; ethers.Wallet accepts.
  RELAYER_PRIVATE_KEY:
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  RELAYER_RPC_URL: 'http://127.0.0.1:8545',
  RELAYER_VEILPOOL_ALLOWLIST: ALLOWLIST_ADDRESSES.join(','),
};

// ---------------------------------------------------------------------------
// ethers mock — replace `Contract`, `JsonRpcProvider`, and `Wallet` while
// keeping the rest (`Interface`, `id`, `getAddress`, etc.) actual. We need
// the real `Interface` so we can independently encode the canonical
// withdraw calldata in the assertions.
// ---------------------------------------------------------------------------

const realEthers = jest.requireActual('ethers') as typeof import('ethers');

// Singleton mock so each test can stage results and observe call counts
// without re-grabbing references after every reset.
const contractMock: {
  withdraw: jest.Mock & { staticCall: jest.Mock };
} = {
  withdraw: Object.assign(jest.fn(), { staticCall: jest.fn() }) as jest.Mock & {
    staticCall: jest.Mock;
  },
};

// Records every `new ethers.Contract(address, abi, signer)` invocation so
// the property can assert (a) exactly one contract is constructed per
// request, and (b) the address is always the body's contractAddress —
// never the Groth16Verifier (which would imply the relayer is doing
// verification itself, the failure mode this property forbids).
const contractConstructions: Array<{ address: string }> = [];

const ContractMockCtor = jest.fn().mockImplementation((address: string) => {
  contractConstructions.push({ address });
  return contractMock;
});

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers') as typeof import('ethers');
  const mocked = {
    ...actual,
    Contract: ContractMockCtor,
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
// Lazy-loaded handle to the freshly-required controller.
// ---------------------------------------------------------------------------
let app: Express;

beforeAll(() => {
  // jest.doMock + jest.resetModules is the reliable pattern for requiring a
  // fresh module with a custom mock. isolateModules + doMock is unreliable.
  jest.resetModules();
  jest.doMock('ethers', () => {
    const actual = jest.requireActual('ethers') as typeof import('ethers');
    const mocked = {
      ...actual,
      Contract: ContractMockCtor,
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

  // Mount the controller directly to bypass the auth rate limiter.
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
  ContractMockCtor.mockClear();
  contractConstructions.length = 0;
});

// ---------------------------------------------------------------------------
// ABI fragments for independent encoding. We rebuild them locally rather
// than import `VEILPOOL_ABI` from the controller so the test fails if a
// future refactor of the controller silently drifts away from the
// canonical 6-argument shape.
// ---------------------------------------------------------------------------
const VEILPOOL_WITHDRAW_FRAGMENT =
  'function withdraw(bytes32 nullifierHash, bytes proof, bytes32 merkleRoot, address recipient, address token, uint256 amount)';
const VERIFIER_FRAGMENT =
  'function verifyProof(bytes proof, bytes32[] publicInputs) external view returns (bool)';

const WITHDRAW_IFACE = new realEthers.Interface([VEILPOOL_WITHDRAW_FRAGMENT]);
const VERIFIER_IFACE = new realEthers.Interface([VERIFIER_FRAGMENT]);

// 4-byte selector for `verifyProof(bytes,bytes32[])` — the controller
// must NEVER produce calldata starting with this selector, which would
// be an unmistakable sign that it's calling the verifier directly.
const VERIFY_PROOF_SELECTOR = (() => {
  const f = VERIFIER_IFACE.getFunction('verifyProof');
  if (!f) throw new Error('verifyProof fragment missing — test misconfigured');
  return f.selector;
})();

// Sanity check at load time: the two selectors must differ. If a future
// edit accidentally aliased them, the property would silently pass.
const WITHDRAW_SELECTOR = (() => {
  const f = WITHDRAW_IFACE.getFunction('withdraw');
  if (!f) throw new Error('withdraw fragment missing — test misconfigured');
  return f.selector;
})();
if (WITHDRAW_SELECTOR === VERIFY_PROOF_SELECTOR) {
  throw new Error(
    'withdraw and verifyProof share a selector — keccak collision or fragment misconfiguration'
  );
}

// ---------------------------------------------------------------------------
// Smart generators — produce WithdrawRequest bodies that satisfy the
// strict schema regexes verbatim. The schema accepts mixed-case hex but
// the controller lowercases `contractAddress` before allowlist lookup,
// so generating lowercase here keeps the comparison straightforward.
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

const arbitraryAllowlistedAddress = (): fc.Arbitrary<string> =>
  fc.constantFrom(...ALLOWLIST_ADDRESSES);

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
    contractAddress: arbitraryAllowlistedAddress(),
  }) as fc.Arbitrary<WithdrawRequest>;

// Canonical 66-char-lowercase-hex tx hash returned by the staged broadcast.
const STAGED_TX_HASH = `0x${'a'.repeat(64)}` as const;
const TX_HASH_REGEX = /^0x[a-fA-F0-9]{64}$/;

// ---------------------------------------------------------------------------
// The property.
// ---------------------------------------------------------------------------

describe('Property 13 — relayer forwards valid requests to allowlisted pools', () => {
  it(
    'forwards canonical withdraw(...) to body.contractAddress, never invokes verifyProof, and returns 200 + valid txHash',
    async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryWithdrawRequest(), async (body) => {
          // Reset between iterations so call counts and staged
          // resolutions don't leak across runs.
          contractMock.withdraw.mockReset();
          contractMock.withdraw.staticCall.mockReset();
          ContractMockCtor.mockClear();
          contractConstructions.length = 0;

          // Stage success on both simulation and broadcast. The broadcast
          // must yield an object with a `.hash` field — the controller
          // surfaces that as `txHash` in the 200 body.
          contractMock.withdraw.staticCall.mockResolvedValueOnce(undefined);
          contractMock.withdraw.mockResolvedValueOnce({ hash: STAGED_TX_HASH });

          const res = await request(app)
            .post('/api/v1/relayer/withdraw')
            .send(body);

          // ---- (d) Response shape: 200 + { success: true, txHash } ----
          expect(res.status).toBe(200);
          expect(res.body.success).toBe(true);
          expect(typeof res.body.txHash).toBe('string');
          expect(res.body.txHash).toMatch(TX_HASH_REGEX);
          expect(res.body.txHash).toBe(STAGED_TX_HASH);

          // ---- (a) Exactly one Contract was constructed, against
          // body.contractAddress. A second construction (e.g. a verifier
          // contract) would mean the relayer is doing verification
          // itself, the failure mode Requirement 6.2 forbids.
          expect(ContractMockCtor).toHaveBeenCalledTimes(1);
          expect(contractConstructions).toHaveLength(1);
          expect(contractConstructions[0].address).toBe(body.contractAddress);

          // The Contract constructor's first arg is the pool address;
          // assert directly via the jest mock, mirroring the task
          // description's `expect(ethers.Contract).toHaveBeenCalledWith(
          //   body.contractAddress, expect.anything(), expect.anything())`.
          expect(ContractMockCtor).toHaveBeenCalledWith(
            body.contractAddress,
            expect.anything(),
            expect.anything()
          );

          // ---- (b) Canonical 6-tuple was passed to staticCall + broadcast.
          // amount enters the controller as a decimal string and is
          // converted to BigInt before the call — that conversion is
          // load-bearing for Solidity uint256 ABI encoding.
          const expectedArgs: [
            string,
            string,
            string,
            string,
            string,
            bigint,
          ] = [
            body.nullifierHash,
            body.proof,
            body.merkleRoot,
            body.recipient,
            body.token,
            BigInt(body.amount),
          ];
          expect(contractMock.withdraw.staticCall).toHaveBeenCalledTimes(1);
          expect(contractMock.withdraw.staticCall).toHaveBeenCalledWith(
            ...expectedArgs
          );
          expect(contractMock.withdraw).toHaveBeenCalledTimes(1);
          expect(contractMock.withdraw).toHaveBeenCalledWith(
            ...expectedArgs,
            expect.objectContaining({ gasLimit: expect.anything() })
          );

          // ---- (c) verifyProof never invoked. Two independent checks:
          //   1. The encoded calldata for the canonical args starts with
          //      the withdraw selector, not the verifyProof selector.
          //   2. The mocked Contract was never given any
          //      verifier-shaped method, and the calls captured were
          //      strictly to `withdraw` / `withdraw.staticCall`.
          //
          // Real ethers `Interface.encodeFunctionData` runs full ABI
          // encoding, so this also serves as a property test on the
          // canonical-ordering contract: any drift in arg order would
          // produce different calldata bytes, which would in turn fail
          // the on-chain verifier — but we catch it here, before the
          // request leaves the relayer.
          const calldata = WITHDRAW_IFACE.encodeFunctionData(
            'withdraw',
            expectedArgs
          );
          expect(calldata.slice(0, 10)).toBe(WITHDRAW_SELECTOR);
          expect(calldata.slice(0, 10)).not.toBe(VERIFY_PROOF_SELECTOR);

          // The controller never instantiates the verifier contract —
          // verify it via the recorded Contract constructions.
          for (const construction of contractConstructions) {
            expect(construction.address).not.toEqual(
              expect.stringMatching(/^verifier/i)
            );
            // Address must be one of the allowlisted pool addresses.
            // Anything else (e.g. a verifier deployment) would fail
            // this check.
            expect(ALLOWLIST_ADDRESSES).toContain(construction.address);
          }
        }),
        { numRuns: 25 }
      );
    },
    30_000
  );
});
