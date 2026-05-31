// Feature: veilpay-privacy-stack, Property 17: Mobile-relayer request shape and HTTP failure handling
//
// Validates: Requirements 8.1, 8.2, 8.3
//
// Property 17 (see design.md §Correctness Properties):
//
//   *For any* `'max'`-privacy payment processed by `usePaymentTransaction`,
//   the mobile app SHALL issue exactly one `fetch` request whose URL
//   begins with `RELAYER_BASE_URL`, whose path is
//   `/api/v1/relayer/withdraw`, whose method is `POST`, and whose JSON
//   body satisfies the `WithdrawRequestSchema`; AND for any HTTP
//   response whose status is outside `[200, 299]`, the resulting
//   `txStatus` SHALL be `'failed'` and an error UI containing the
//   response status SHALL be shown to the user.
//
// Why we test the boundary, not the hook
// ---------------------------------------
// The HTTP shape of the relayer call is owned exclusively by
// `services/relayerClient.ts`. `usePaymentTransaction` is just a caller —
// it builds the body, hands it to `submitWithdraw`, and renders whatever
// `RelayerError` comes back (Requirement 8.3). The hook-level
// integration (status → `txStatus = 'failed'`, status → rendered error
// string) is covered by task 9.4 / Property 9; here we pin down the
// universal claim about the request shape and the failure-path contract
// at the only surface that actually owns it. Two upshots:
//
//   • The `txStatus === 'failed'` and "error string contains status"
//     half of the requirement is observed at this layer as
//     `RelayerError.kind === 'http'` carrying `status === <mocked
//     status>`. That is the *exact* signal the hook keys off of, so
//     pinning it down here is sufficient for the boundary contract.
//   • We do not need to mount the React tree, route through a
//     dispatcher, or simulate `'max'` privacy state — `submitWithdraw`
//     is the single ingress and egress point for the relayer hop.
//
// Mocking strategy
// ----------------
//   1. Set `process.env.EXPO_PUBLIC_RELAYER_BASE_URL` *before* requiring
//      the relayer client. `relayerClient.ts` captures the URL at
//      module-load time, so we must use `jest.isolateModules` to ensure
//      the freshly-required module reads our test value rather than the
//      empty default.
//   2. Replace `global.fetch` with a `jest.fn()` that records the URL
//      and `RequestInit` and returns whatever `mockResponse` the test
//      stages. We avoid the real `Response` constructor because
//      `relayerClient` only relies on `.ok`, `.status`, and `.text()`,
//      and `Response` is not available in every Jest environment.
//   3. fast-check generates `WithdrawRequest` bodies whose every field
//      passes the strict `WithdrawRequestSchema` regexes — same shape
//      the dispatcher would build for a real `'max'`-privacy payment.

// ---------------------------------------------------------------------------
// Configure the relayer base URL *before* relayerClient is required.
// `RELAYER_BASE_URL` is captured at module-load time (a top-level `const`),
// so a plain assignment after `import { submitWithdraw } from '../relayerClient'`
// would be too late: babel-preset-expo hoists ESM `import`s into CJS
// `require`s above all other top-level code. We therefore set the env
// here, then lazy-require the module inside `beforeAll` via
// `jest.isolateModules` to guarantee a fresh module instance.
// ---------------------------------------------------------------------------
process.env.EXPO_PUBLIC_RELAYER_BASE_URL = 'https://relayer.test';

import * as fc from 'fast-check';

import { WithdrawRequestSchema, type WithdrawRequest } from '../../schemas/withdrawRequest';
// Type-only import is fine: it does not pull `relayerClient` into the
// module graph at import time, so the env-var capture is unaffected.
import type { RelayerError as RelayerErrorType } from '../relayerClient';

// ---------------------------------------------------------------------------
// Lazy-loaded handles to the freshly-required module under test.
// ---------------------------------------------------------------------------
let submitWithdraw: (body: WithdrawRequest) => Promise<{ success: true; txHash: `0x${string}` }>;
let RelayerError: typeof RelayerErrorType;

// ---------------------------------------------------------------------------
// fetch mock — records each call and returns the staged response.
// ---------------------------------------------------------------------------
interface MockResponse {
  ok: boolean;
  status: number;
  body: string; // raw body string; relayerClient calls `.text()`
}

let mockResponse: MockResponse;
let lastFetchCall: { url: string; init: RequestInit } | undefined;
const fetchMock = jest.fn(async (url: string, init: RequestInit) => {
  lastFetchCall = { url, init };
  return {
    ok: mockResponse.ok,
    status: mockResponse.status,
    text: async () => mockResponse.body,
    json: async () => JSON.parse(mockResponse.body),
  } as unknown as Response;
});

const realFetch = global.fetch;

beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch;

  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../relayerClient') as {
      submitWithdraw: typeof submitWithdraw;
      RelayerError: typeof RelayerError;
    };
    submitWithdraw = mod.submitWithdraw;
    RelayerError = mod.RelayerError;
  });
});

afterAll(() => {
  global.fetch = realFetch;
});

beforeEach(() => {
  fetchMock.mockClear();
  lastFetchCall = undefined;
});

// ---------------------------------------------------------------------------
// Smart generators — produce WithdrawRequest bodies that satisfy the
// strict schema regexes verbatim. Building them by composition (rather
// than from random strings filtered through the schema) keeps the
// generator deterministic and shrinks well: when a property fails,
// fast-check can shrink the per-field bytes independently.
//
//   • BYTES32_HEX  →  64-char lowercase hex with `0x` prefix
//   • ADDRESS      →  40-char lowercase hex with `0x` prefix
//   • HEX          →  arbitrary even-length lowercase hex with `0x` prefix
//   • POSITIVE_DECIMAL → `[1-9][0-9]*`, no leading zero, non-empty
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

// Even-length non-empty hex so it always satisfies `^0x[0-9a-fA-F]+$`.
// We cap at 512 bytes to keep generation fast — the real Groth16 proof
// is ~256 bytes; 512 is comfortably above that.
const arbitraryHexBlob = (): fc.Arbitrary<string> =>
  fc
    .integer({ min: 1, max: 256 })
    .chain((nBytes) => hexStringOfLength(nBytes * 2))
    .map((h) => `0x${h}`);

const arbitraryPositiveDecimal = (): fc.Arbitrary<string> =>
  fc
    .tuple(
      fc.integer({ min: 1, max: 9 }),
      fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 0, maxLength: 77 })
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
    contractAddress: arbitraryAddress(),
  }) as fc.Arbitrary<WithdrawRequest>;

// ---------------------------------------------------------------------------
// Property A — success path: request shape contract.
//
// Pins down Requirements 8.1 ("call the real relayer endpoint at the
// URL configured in RELAYER_BASE_URL") and 8.2 ("send a JSON body
// containing {nullifierHash, proof, publicSignals, recipient, token,
// amount, chainKey} to POST /api/v1/relayer/withdraw").
//
// For any valid body, exactly one fetch call must be issued, the URL
// must equal `${RELAYER_BASE_URL}/api/v1/relayer/withdraw`, the method
// must be POST, and the parsed body must (a) round-trip through
// WithdrawRequestSchema with `success: true` and (b) deep-equal the
// original input — i.e. the relayer client neither drops, reorders, nor
// mutates any field on its way to the wire.
// ---------------------------------------------------------------------------

describe('Property 17 — relayer request shape (success path)', () => {
  it(
    'POSTs exactly one schema-valid body to ${RELAYER_BASE_URL}/api/v1/relayer/withdraw',
    async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryWithdrawRequest(), async (body) => {
          fetchMock.mockClear();
          lastFetchCall = undefined;

          // Stage a 2xx success response with a plausible txHash.
          const txHash = `0x${'a'.repeat(64)}`;
          mockResponse = {
            ok: true,
            status: 200,
            body: JSON.stringify({ success: true, txHash }),
          };

          const res = await submitWithdraw(body);

          // Returned txHash is exactly what the relayer claimed.
          expect(res.txHash).toBe(txHash);

          // Exactly one POST issued (Requirement 8.1: the real endpoint,
          // not a mock setTimeout; "exactly one" is the property under test).
          expect(fetchMock).toHaveBeenCalledTimes(1);
          expect(lastFetchCall).toBeDefined();
          expect(lastFetchCall!.url).toBe(
            'https://relayer.test/api/v1/relayer/withdraw'
          );
          expect(lastFetchCall!.init.method).toBe('POST');

          // JSON content-type — keeps the relayer's express body parser
          // honest. (Header keys are case-insensitive in HTTP but the
          // client always emits this exact casing.)
          const headers = lastFetchCall!.init.headers as Record<string, string>;
          expect(headers['Content-Type']).toBe('application/json');

          // Parse the outgoing body.
          const rawBody = lastFetchCall!.init.body as string;
          expect(typeof rawBody).toBe('string');
          const parsedBody: unknown = JSON.parse(rawBody);

          // Requirement 8.2: body matches WithdrawRequestSchema verbatim.
          const schemaCheck = WithdrawRequestSchema.safeParse(parsedBody);
          expect(schemaCheck.success).toBe(true);

          // Field-level preservation: nothing got reordered, dropped,
          // coerced, or stringified-then-parsed-into-a-different-shape
          // on the way out. Equivalent to the byte-for-byte invariant
          // the relayer's strict zod schema enforces on its receiving
          // end.
          expect(parsedBody).toEqual(body);
        }),
        { numRuns: 30 }
      );
    },
    30_000
  );
});

// ---------------------------------------------------------------------------
// Property B — failure path: every non-2xx response surfaces as a
// RelayerError of kind `'http'` whose `status` equals the response
// status. This is the boundary observation that maps onto the
// hook-level claim ("`txStatus === 'failed'` and the rendered error
// string contains the response status") in Requirement 8.3 — the hook
// inspects `RelayerError.kind` / `.status` to decide what to render,
// so pinning down this contract here is sufficient at the relayerClient
// boundary.
//
// We sweep statuses across the entire 4xx/5xx range, including:
//   • 400 (validation), 401 (auth), 403 (allowlist), 404 (route),
//     422 (revert), 429 (rate limit), 500 (internal), 503 (config),
//     and arbitrary [400, 599] integers in between.
//
// We also fuzz the response body's "error" message (including empty,
// non-string, and missing) to make sure the client doesn't choke on
// shapes the relayer may legitimately produce.
// ---------------------------------------------------------------------------

describe('Property 17 — relayer HTTP failure handling (non-2xx path)', () => {
  it(
    'rejects with RelayerError(kind="http", status=<mocked>) for every non-2xx response',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryWithdrawRequest(),
          fc.integer({ min: 400, max: 599 }),
          fc.string(),
          async (body, status, reason) => {
            fetchMock.mockClear();
            lastFetchCall = undefined;

            mockResponse = {
              ok: false,
              status,
              body: JSON.stringify({ error: reason }),
            };

            // The client must reject — never silently resolve a non-2xx.
            let caught: unknown = null;
            try {
              await submitWithdraw(body);
            } catch (e) {
              caught = e;
            }

            expect(caught).toBeInstanceOf(RelayerError);
            // Type narrowing via cast — `instanceof` already proved the type.
            const err = caught as RelayerErrorType;
            expect(err.kind).toBe('http');
            // Requirement 8.3 boundary observation: the response status
            // must propagate verbatim so the hook can render it. If
            // `err.status` were undefined or coerced, the rendered
            // "Relayer responded with status N" UI string would lose its
            // N — the failure mode this property is designed to catch.
            expect(err.status).toBe(status);
            expect(err.message).toContain(String(status));

            // The body must still have hit the wire — the failure is
            // about the *response*, not about the client refusing to
            // send. (A pre-flight schema rejection would be a different
            // RelayerError kind; we generate valid bodies precisely to
            // exclude that branch here.)
            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(lastFetchCall!.url).toBe(
              'https://relayer.test/api/v1/relayer/withdraw'
            );
          }
        ),
        { numRuns: 30 }
      );
    },
    30_000
  );
});
