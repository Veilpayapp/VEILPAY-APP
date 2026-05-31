// Feature: veilpay-privacy-stack, Property 14: Relayer rejects malformed and non-allowlisted requests with 400 and zero pool calls

/**
 * Property 14 — Relayer validation and allowlist enforcement.
 *
 * Statement (verbatim from design.md §Correctness Properties → Property 14):
 *
 *   For any request body that either fails `WithdrawRequestSchema` validation
 *   (missing field, wrong type, malformed hex, non-positive amount) or whose
 *   `contractAddress` is not a member of `RELAYER_VEILPOOL_ALLOWLIST`, the
 *   relayer SHALL respond with HTTP 400 and SHALL make zero calls to any
 *   `VeilPool` contract.
 *
 * Validates: Requirements 6.4, 6.8
 *
 * --------------------------------------------------------------------------
 * Test architecture
 * --------------------------------------------------------------------------
 *
 * 1. Environment is configured BEFORE the controller module is imported so
 *    that the module-load-time `RELAYER_VEILPOOL_ALLOWLIST` set and
 *    `RELAYER_KEY_CONFIGURED` flag are populated. With the key set we
 *    eliminate the 503 path so any non-200 response is attributable to the
 *    400 logic this property targets.
 *
 * 2. The `ethers` module is partially mocked: the real `ethers.Interface`
 *    constructor is preserved (so the controller's module-load-time
 *    `VEILPOOL_INTERFACE` build succeeds), while `ethers.Contract`,
 *    `ethers.Wallet`, and `ethers.JsonRpcProvider` are stubbed. Every
 *    `Contract` constructed by the controller hands out the same observable
 *    `contractMock`, on which the test asserts that `withdraw` and
 *    `withdraw.staticCall` are never invoked.
 *
 * 3. A minimal Express app mounts ONLY `handleWithdraw` at the same path
 *    used in production (`POST /api/v1/relayer/withdraw`). We bypass the
 *    auth rate limiter that the production router stacks on top — the
 *    rate limiter would start returning 429 after 10 requests in 15 min,
 *    which would corrupt the property's 400 expectation.
 *
 * 4. Two arbitraries cover the failure modes the property is named after:
 *
 *    - `corruptedBodyArb`: starts from a fully valid `WithdrawRequestSchema`
 *      body and applies one of four mutation kinds (missing field,
 *      malformed hex, non-positive amount, extra unknown field) so the
 *      schema's `safeParse` returns `success: false`.
 *
 *    - `nonAllowlistedBodyArb`: keeps a fully valid body but replaces
 *      `contractAddress` with a random 40-char hex address that is, by
 *      construction (filter), not equal (case-insensitively) to the single
 *      configured allowlist entry, so the controller's allowlist check
 *      rejects with 400.
 *
 * 5. fast-check drives 50 iterations through `fc.oneof(corruptedBodyArb,
 *    nonAllowlistedBodyArb)` and for each body asserts both halves of the
 *    property: HTTP 400 status and zero pool calls observed by the mock.
 *
 * Anti-patterns avoided:
 *   - Importing `apps/backend/src/index.ts` (would fire Sentry init,
 *     attach the auth rate limiter, and load Redis/Prisma).
 *   - Spying on `relayerController.handleWithdraw` (would test the test).
 *   - Asserting via the mock signer's send-transaction observable (the
 *     controller never reaches signer construction on the 400 path, so
 *     the relevant observable is the `Contract` method mocks).
 */

// ---------------------------------------------------------------------------
// 1. ethers mock. `mock`-prefixed bindings are the only out-of-scope
//    references babel-jest / ts-jest allow inside `jest.mock` factories.
//    The `jest.mock` call is hoisted above all `import` statements; the
//    factory runs at `require('ethers')` time, but the inner arrow returned
//    by `Contract:` only reads `mockContractWithdraw` when later invoked
//    (i.e., when the controller constructs a Contract), at which point the
//    module-scope binding is fully initialised.
// ---------------------------------------------------------------------------

type WithdrawMock = jest.Mock & { staticCall: jest.Mock };

const mockContractWithdraw = jest.fn(async () => ({
  hash: '0x' + 'cc'.repeat(32),
})) as WithdrawMock;
mockContractWithdraw.staticCall = jest.fn(async () => undefined);

jest.mock('ethers', () => {
  const real = jest.requireActual('ethers');
  return {
    ...real,
    ethers: {
      ...real.ethers,
      JsonRpcProvider: jest.fn(() => ({})),
      Wallet: jest.fn(() => ({})),
      Contract: jest.fn(() => ({ withdraw: mockContractWithdraw })),
    },
  };
});

// ---------------------------------------------------------------------------
// 2. Imports — `import` statements are hoisted above non-import top-level
//    code, so any module read at the consuming side's top level runs BEFORE
//    our env setup. None of these three modules read RELAYER_* env vars at
//    load time, so the order is safe.
// ---------------------------------------------------------------------------

import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import fc from 'fast-check';

// ---------------------------------------------------------------------------
// 3. Env vars MUST be set before the controller module is loaded, since
//    `RELAYER_VEILPOOL_ALLOWLIST` and `RELAYER_KEY_CONFIGURED` are
//    evaluated once at module load. Lowercase the allowlist entry so it
//    matches the controller's case-insensitive comparison without further
//    normalization.
// ---------------------------------------------------------------------------

const ALLOWLISTED_POOL = '0x' + 'aa'.repeat(20); // lowercase by construction
process.env.RELAYER_VEILPOOL_ALLOWLIST = ALLOWLISTED_POOL;
process.env.RELAYER_PRIVATE_KEY = '0x' + '11'.repeat(32);
process.env.RELAYER_RPC_URL = 'http://localhost:8545';

// ---------------------------------------------------------------------------
// 4. Dynamic require so the controller's module-load side effects observe
//    the env values set in step 3 (using `import` would hoist this above
//    the env setup).
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { handleWithdraw } = require('../relayerController') as typeof import('../relayerController');

// Surface the mock in the form the test assertions expect.
const contractMock = { withdraw: mockContractWithdraw };

// ---------------------------------------------------------------------------
// 4. Minimal app: ONLY the handler under test, plus json parsing. We
//    intentionally skip the production rate limiter (`authRateLimiter`)
//    because at `max: 10 / 15-min` it would start returning 429 after the
//    tenth iteration and silently invalidate the rest of the property run.
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.post(
  '/api/v1/relayer/withdraw',
  (req: Request, res: Response, next: NextFunction) => {
    handleWithdraw(req, res, next).catch(next);
  }
);

// ---------------------------------------------------------------------------
// 5. Arbitraries.
// ---------------------------------------------------------------------------

const toHex = (bytes: Uint8Array): string =>
  '0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** 32-byte hex string (66 chars including `0x` prefix). Matches schema BYTES32_HEX. */
const bytes32HexArb: fc.Arbitrary<string> = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map(toHex);

/** 20-byte address hex (42 chars). Matches schema ADDRESS regex. */
const addressHexArb: fc.Arbitrary<string> = fc
  .uint8Array({ minLength: 20, maxLength: 20 })
  .map(toHex);

/**
 * Encoded Groth16 proof bytes — the schema places no length cap (any
 * `^0x[0-9a-fA-F]+$` is acceptable), so we generate a representative
 * non-empty payload.
 */
const proofHexArb: fc.Arbitrary<string> = fc
  .uint8Array({ minLength: 32, maxLength: 256 })
  .map(toHex);

/** Decimal string of a positive bigint (matches `^[1-9][0-9]*$`). */
const positiveDecimalArb: fc.Arbitrary<string> = fc
  .bigUintN(64)
  .filter((n) => n > 0n)
  .map((n) => n.toString());

interface ValidBody {
  nullifierHash: string;
  proof: string;
  publicSignals: [string, string, string, string];
  merkleRoot: string;
  recipient: string;
  token: string;
  amount: string;
  chainKey: 'evm-sepolia';
  contractAddress: string;
}

/**
 * A fully valid body, contract address fixed to the allowlist. Both
 * mutation arbs and the non-allowlist arb branch off this base.
 */
const validBodyArb = fc.record({
  nullifierHash: bytes32HexArb,
  proof: proofHexArb,
  publicSignals: fc.tuple(
    bytes32HexArb,
    bytes32HexArb,
    addressHexArb,
    bytes32HexArb
  ),
  merkleRoot: bytes32HexArb,
  recipient: addressHexArb,
  token: addressHexArb,
  amount: positiveDecimalArb,
  chainKey: fc.constant('evm-sepolia' as const),
  contractAddress: fc.constant(ALLOWLISTED_POOL),
}) as fc.Arbitrary<ValidBody>;

// ---- Mutation values ------------------------------------------------------
// Every value generated here, when substituted into the corresponding field
// of a valid body (or absent), guarantees Zod validation failure across
// EVERY hex-typed field — including the variable-length `proof` field. We
// deliberately avoid borderline cases like `'0x' + 'a'.repeat(63)` that pass
// `proof`'s `^0x[0-9a-fA-F]+$` regex while failing the {64}/{40} regexes.

const malformedHexArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(''), // missing 0x prefix
  fc.constant('0x'), // zero hex chars after 0x — fails all hex regexes (each requires at least one hex pair)
  fc.constant('0xZZ'), // Z is not hex
  fc.constant('not-hex'),
  fc.constant('0x' + 'g'.repeat(50)), // 'g' is non-hex regardless of length
  fc.constant('hello world'),
  fc.integer(), // wrong type
  fc.constant(null), // wrong type
  fc.boolean(), // wrong type
  fc.array(fc.integer(), { minLength: 1, maxLength: 5 }) // wrong type (also covers publicSignals replacement)
);

/**
 * `amount` field: schema is `string` matching `^[1-9][0-9]*$`. Any
 * non-string fails the type check; '0', '-1', '01', '1.5', 'abc', '' fail
 * the regex. Each option covers a distinct branch of the property
 * statement's "non-positive amount" clause.
 */
const malformedAmountArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(''),
  fc.constant('0'),
  fc.constant('00'),
  fc.constant('01'), // leading zero
  fc.constant('-1'),
  fc.constant('-100'),
  fc.constant('1.5'),
  fc.constant('+1'),
  fc.constant('abc'),
  fc.integer({ min: -1_000_000, max: 0 }), // wrong type AND non-positive
  fc.float(), // wrong type
  fc.constant(null)
);

/** `chainKey`: schema is the literal `'evm-sepolia'`. Anything else fails. */
const malformedChainKeyArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(''),
  fc.constant('eth-mainnet'),
  fc.constant('evm-mainnet'),
  fc.constant('EVM-SEPOLIA'), // case-mismatch fails literal
  fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s !== 'evm-sepolia'),
  fc.constant(null),
  fc.integer()
);

function malformedValueArbFor(field: string): fc.Arbitrary<unknown> {
  if (field === 'amount') return malformedAmountArb;
  if (field === 'chainKey') return malformedChainKeyArb;
  return malformedHexArb;
}

const requiredFields = [
  'nullifierHash',
  'proof',
  'publicSignals',
  'merkleRoot',
  'recipient',
  'token',
  'amount',
  'chainKey',
  'contractAddress',
] as const;

/** Mutation kind 1 — delete a single required field. */
const deleteFieldArb = fc
  .tuple(validBodyArb, fc.constantFrom(...requiredFields))
  .map(([base, field]) => {
    const out: Record<string, unknown> = { ...base };
    delete out[field];
    return out;
  });

/** Mutation kind 2 — replace a single required field with a malformed value. */
const malformedFieldArb = fc
  .tuple(validBodyArb, fc.constantFrom(...requiredFields))
  .chain(([base, field]) =>
    malformedValueArbFor(field).map((value) => ({ ...base, [field]: value }))
  );

/**
 * Mutation kind 3 — `amount` specifically replaced with a non-positive /
 * non-integer value. Subsumed by mutation kind 2 but materialised
 * explicitly to ensure the "non-positive amount" branch from the property
 * statement is exercised densely across the run.
 */
const nonPositiveAmountBodyArb = fc
  .tuple(validBodyArb, malformedAmountArb)
  .map(([base, badAmount]) => ({ ...base, amount: badAmount }));

/**
 * Mutation kind 4 — extra unknown field. The schema is `.strict()` so any
 * extra key triggers `safeParse` failure independent of the value.
 */
const extraFieldArb = fc
  .tuple(
    validBodyArb,
    fc
      .string({ minLength: 1, maxLength: 16 })
      .filter((k) => !(requiredFields as readonly string[]).includes(k)),
    fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null))
  )
  .map(([base, key, value]) => ({ ...base, [key]: value }));

const corruptedBodyArb = fc.oneof(
  deleteFieldArb,
  malformedFieldArb,
  nonPositiveAmountBodyArb,
  extraFieldArb
);

/**
 * `nonAllowlistedBodyArb`: a fully valid body whose `contractAddress` is by
 * construction not in the allowlist. The address comparator inside
 * `RELAYER_VEILPOOL_ALLOWLIST` is case-insensitive, so we filter on the
 * lowercased form to guarantee disjointness.
 */
const nonAllowlistedAddressArb: fc.Arbitrary<string> = addressHexArb.filter(
  (addr) => addr.toLowerCase() !== ALLOWLISTED_POOL.toLowerCase()
);

const nonAllowlistedBodyArb = fc
  .tuple(validBodyArb, nonAllowlistedAddressArb)
  .map(([base, badAddr]) => ({ ...base, contractAddress: badAddr }));

// ---------------------------------------------------------------------------
// 6. The property.
// ---------------------------------------------------------------------------

describe('Property 14: Relayer rejects malformed and non-allowlisted requests', () => {
  beforeEach(() => {
    contractMock.withdraw.mockClear();
    contractMock.withdraw.staticCall.mockClear();
  });

  it('returns HTTP 400 with zero pool calls for any corrupted or non-allowlisted body', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(corruptedBodyArb, nonAllowlistedBodyArb),
        async (body) => {
          contractMock.withdraw.mockClear();
          contractMock.withdraw.staticCall.mockClear();

          const res = await request(app).post('/api/v1/relayer/withdraw').send(body);

          expect(res.status).toBe(400);
          expect(contractMock.withdraw.staticCall).not.toHaveBeenCalled();
          expect(contractMock.withdraw).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 50 }
    );
  });
});
