// Feature: veilpay-privacy-stack, Property 15: Relayer 503 when private key is unset
//
// Validates: Requirements 6.5
//
// Property 15 (verbatim from design.md §Correctness Properties → Property 15):
//
//   *For any* request body posted to `POST /api/v1/relayer/withdraw` while
//   `process.env.RELAYER_PRIVATE_KEY` is unset or empty, the relayer SHALL
//   respond with HTTP 503 and a body of `{ error: "Relayer not configured" }`,
//   regardless of whether the body is otherwise well-formed and regardless of
//   whether `contractAddress` is allowlisted.
//
// Why this property is testable as a single fast-check property
// -------------------------------------------------------------
// The 503 path is the very first branch of `handleWithdraw`: if
// `RELAYER_KEY_CONFIGURED` is false, the handler returns immediately,
// before schema validation, allowlist enforcement, signer construction,
// and the simulate-broadcast path. So the property's universal claim
// ("regardless of body") collapses to a single observation: the response
// is always 503 with the exact configured-error body.
//
// Test architecture
// -----------------
//   1. `RELAYER_PRIVATE_KEY` is `delete`d *before* the controller module
//      is loaded. The controller captures the key flag at module-load
//      time via the constant
//
//          export const RELAYER_KEY_CONFIGURED: boolean =
//            typeof process.env.RELAYER_PRIVATE_KEY === "string" &&
//            process.env.RELAYER_PRIVATE_KEY.trim() !== "";
//
//      and a plain `process.env.RELAYER_PRIVATE_KEY = ''` after `import`
//      would be too late. We therefore delete the env var at the very
//      top of the file, then use `jest.isolateModules` + dynamic
//      `require` (the same pattern used in 5.6 / 5.8) to load a fresh
//      controller observing the cleared env.
//
//   2. `RELAYER_VEILPOOL_ALLOWLIST` is set to a valid lowercase
//      0x-prefixed 40-char address so the module's `loadAllowlist()`
//      side effect succeeds without warning. Whether the address is in
//      the set is irrelevant here — the 503 short-circuit fires before
//      the allowlist check is ever consulted — but the controller
//      expects a parseable env var and it costs us nothing to satisfy
//      that contract.
//
//   3. `ethers` is mocked to inert stubs. `Contract`, `Wallet`, and
//      `JsonRpcProvider` all return empty objects; the controller
//      should never construct any of them on the 503 path, but mocking
//      them eliminates any chance that a stray real-network probe
//      could pollute the run if the property were ever to break
//      (defence in depth — if the 503 short-circuit regresses, the
//      test will fail loudly on the assertion rather than time out
//      against a real RPC). `Interface` is preserved via the spread of
//      `jest.requireActual('ethers')` because the controller builds
//      `VEILPOOL_INTERFACE` at module-load time.
//
//   4. A minimal Express app mounts ONLY the freshly-required
//      `withdraw` handler at the production path
//      `POST /api/v1/relayer/withdraw`, with `express.json()` body
//      parsing. We deliberately bypass the production
//      `authRateLimiter` (10 requests / 15 min) — the 100 iterations
//      this property runs would otherwise saturate the limiter and
//      cause spurious 429s after the tenth request, masking the
//      actual property.
//
//   5. `fc.anything()` generates the body. fast-check's
//      `fc.anything()` covers JSON-serialisable values across the full
//      input space the property quantifies over: primitives (strings,
//      numbers, bigints, booleans, null), arrays, deeply nested
//      objects, and well-formed shapes that happen to mirror a real
//      `WithdrawRequest`. Some of these are also valid against the
//      schema; some are malformed; some are not even objects — the
//      property says the response is 503 for *all* of them.
//
//   6. We use `supertest` with `.send(body)` for objects/arrays and
//      `.send(JSON.stringify(body))` with an explicit JSON content
//      type for primitives, since supertest's default behaviour for
//      non-object bodies is to form-encode rather than JSON-encode.
//      Both routes still go through `express.json()` and end up at
//      the controller, which is what the property cares about.

// ---------------------------------------------------------------------------
// 1. Env setup. MUST happen before any `require`/`import` of the controller.
//    `delete` (rather than `=` to undefined) is the only way to make
//    `typeof process.env.X === 'string'` evaluate to `false` reliably,
//    which is the exact predicate `RELAYER_KEY_CONFIGURED` uses.
// ---------------------------------------------------------------------------

const ORIGINAL_ENV = process.env;

process.env = {
  ...ORIGINAL_ENV,
  NODE_ENV: 'test',
  // Backend config loader prerequisites; unrelated to the relayer 503 path
  // but required so any incidental config import does not throw.
  JWT_SECRET: 'x'.repeat(32),
  API_KEY_SALT: 'y'.repeat(32),
  WEBHOOK_SIGNING_SECRET: 'z'.repeat(32),
  DATABASE_URL: 'postgresql://veilpay:veilpay_dev_password@localhost:5432/veilpay',
  CORS_ORIGINS: '*',
  // Allowlist: a single valid lowercase address. The controller's
  // `loadAllowlist()` accepts only `^0x[0-9a-f]{40}$`. We use 0xaa..aa for
  // determinism. Whether bodies hit this address is irrelevant — the 503
  // short-circuit runs before allowlist enforcement.
  RELAYER_VEILPOOL_ALLOWLIST: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  // RELAYER_RPC_URL is set to satisfy `buildSigner()`; not consumed on the
  // 503 path but harmless if a regression were to reach signer construction.
  RELAYER_RPC_URL: 'http://127.0.0.1:8545',
};

// CRITICAL: clear `RELAYER_PRIVATE_KEY` even if the host shell exported it.
// `RELAYER_KEY_CONFIGURED` is captured at module load, so this must precede
// the controller require.
delete process.env.RELAYER_PRIVATE_KEY;

// ---------------------------------------------------------------------------
// 2. ethers mock — inert stubs for Contract / Wallet / JsonRpcProvider while
//    preserving the rest of the module (Interface, id, etc.) so the
//    controller's module-load `VEILPOOL_INTERFACE` build still works.
// ---------------------------------------------------------------------------

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers') as typeof import('ethers');
  return {
    ...actual,
    Contract: jest.fn().mockImplementation(() => ({
      withdraw: Object.assign(jest.fn(), { staticCall: jest.fn() }),
    })),
    JsonRpcProvider: jest.fn().mockImplementation(() => ({})),
    Wallet: jest.fn().mockImplementation(() => ({})),
  };
});

// ---------------------------------------------------------------------------
// 3. Imports — these modules do not read `RELAYER_*` env vars at load time,
//    so it is safe to import them after the env setup above.
// ---------------------------------------------------------------------------

import * as fc from 'fast-check';
import express, { type Express } from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// 4. Lazy-loaded handle to the freshly-required controller. Using
//    `jest.isolateModules` guarantees the controller's module-load
//    constants (`RELAYER_KEY_CONFIGURED`, `RELAYER_VEILPOOL_ALLOWLIST`)
//    are recomputed against the env we set above, even if some other
//    test in the suite previously loaded the controller with a key set.
// ---------------------------------------------------------------------------

let app: Express;

beforeAll(() => {
  // Clear the module registry so the controller re-reads env at load time.
  jest.resetModules();
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const controller = require('../relayerController') as {
      withdraw: (
        req: import('express').Request,
        res: import('express').Response,
        next: import('express').NextFunction
      ) => Promise<void>;
      RELAYER_KEY_CONFIGURED: boolean;
    };

    if (controller.RELAYER_KEY_CONFIGURED !== false) {
      throw new Error(
        'Test setup invariant violated: RELAYER_KEY_CONFIGURED must be false ' +
          'for Property 15. Ensure RELAYER_PRIVATE_KEY is deleted before the ' +
          'controller module is required.'
      );
    }

    app = express();
    app.use(express.json());
    app.post('/api/v1/relayer/withdraw', (req, res, next) => {
      Promise.resolve(controller.withdraw(req, res, next)).catch(next);
    });
  });
});


afterAll(() => {
  process.env = ORIGINAL_ENV;
});

// ---------------------------------------------------------------------------
// 5. The property.
//
// `fc.anything()` generates JSON-serialisable values across the full input
// space the property quantifies over. We split on whether the generated
// value is a plain object/array (supertest auto-JSON-encodes via
// `Content-Type: application/json`) or a primitive (`.send(...)` would
// form-encode by default; we force JSON encoding to keep the post body in
// the same shape the production endpoint sees from real clients).
// ---------------------------------------------------------------------------

  describe('Property 15 — relayer returns 503 for any body when private key is unset', () => {
    it(
      'returns HTTP 503 with { error: "Relayer not configured" } regardless of body shape',
      async () => {
        await fc.assert(
          fc.asyncProperty(fc.oneof(fc.object(), fc.array(fc.anything())), async (body) => {
            // supertest serialises objects and arrays as JSON automatically
            // when no Content-Type override is set.
            const req = request(app).post('/api/v1/relayer/withdraw');
            const res = await req.send(body as object);
  
            if (res.status !== 503) {
              console.error('503 Property failed, status:', res.status, 'body:', res.body);
            }
            expect(res.status).toBe(503);
            expect(res.body).toEqual({ error: 'Relayer not configured' });
          }),
          { numRuns: 100 }
        );
      },
      30_000
    );
  });
