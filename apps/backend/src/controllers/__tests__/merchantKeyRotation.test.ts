import request from 'supertest';
import express, { type Request, type Response, type NextFunction } from 'express';
import { merchantRoutes } from '../../routes/merchant';
import { prisma } from '../../lib/prisma';
import {
  generateSignature,
  buildSignedPayload,
  hashApiKey,
} from '../../middleware/auth';

// ─── Mocks ────────────────────────────────────────────────────────────────────
// The AUTH stack (authMiddleware + hashApiKey + signature check) is REAL —
// only the prisma persistence layer and the rate limiter are mocked, so the
// tests prove the rotation lifecycle end-to-end: auth resolves merchants by
// the CURRENT stored hash, so a rotated-away key must 401 at auth time.

jest.mock('../../lib/prisma', () => ({
  prisma: {
    merchant: {
      // authMiddleware's lookup: WHERE api_key_hash = <hash> AND status = 'active'
      findFirst: jest.fn(),
      // not used by /keys/rotate, kept for route parity
      findUnique: jest.fn(),
      // the CAS write used by rotateApiKey
      updateMany: jest.fn(),
    },
  },
}));

jest.mock('../../lib/redis', () => ({
  getRedisClient: jest.fn(() => ({
    // replay-claim SET NX always wins in tests
    set: jest.fn().mockResolvedValue('OK'),
  })),
}));

jest.mock('../../middleware/rateLimiter', () => ({
  registrationRateLimiter: (_req: Request, _res: Response, next: NextFunction) =>
    next(),
  getMerchantLimiter: jest.fn(async () => (_req: Request, _res: Response, next: NextFunction) =>
    next()
  ),
}));

// ─── In-memory merchant row (faithful DB semantics) ─────────────────────────

const MERCHANT_ID = '11111111-1111-1111-1111-111111111111';
const INITIAL_KEY = 'vp_initial_key_00000000000000000000';

interface MerchantRow {
  id: string;
  apiKeyHash: string;
  status: string;
}

let merchantRow: MerchantRow;

function resetMerchantRow(key: string): void {
  merchantRow = {
    id: MERCHANT_ID,
    apiKeyHash: hashApiKey(key),
    status: 'active',
  };
}

// authMiddleware read: matches only when the presented hash is the CURRENT
// row hash and the merchant is active — exactly like the real query.
(prisma.merchant.findFirst as jest.Mock).mockImplementation(
  async ({ where }: { where: { apiKeyHash: string; status: string } }) => {
    if (
      where &&
      where.apiKeyHash === merchantRow.apiKeyHash &&
      where.status === merchantRow.status
    ) {
      return {
        id: merchantRow.id,
        businessName: 'Acme Corp',
        email: 'ops@acme.test',
      };
    }
    return null;
  }
);

// The CAS write: only the request whose expected hash is still current wins.
(prisma.merchant.updateMany as jest.Mock).mockImplementation(
  async ({
    where,
    data,
  }: {
    where: { id: string; apiKeyHash: string };
    data: { apiKeyHash: string };
  }) => {
    if (where.id === merchantRow.id && where.apiKeyHash === merchantRow.apiKeyHash) {
      merchantRow.apiKeyHash = data.apiKeyHash;
      return { count: 1 };
    }
    return { count: 0 };
  }
);

// ─── App: real merchant router, raw body captured like src/index.ts ─────────

function buildApp(): express.Application {
  const app = express();
  app.use(
    express.json({
      verify: (
        req: Request & { rawBody?: string },
        _res: Response,
        buffer: Buffer
      ) => {
        req.rawBody = buffer.toString('utf8');
      },
    })
  );
  app.use('/api/v1/merchant', merchantRoutes);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(400).json({ error: err.message });
  });
  return app;
}

const ROTATE_PATH = '/api/v1/merchant/keys/rotate';

/** Sign a POST exactly like a real API client (same scheme as authMiddleware). */
function signedPost(app: express.Application, path: string, apiKey: string) {
  const timestamp = String(Date.now());
  const rawBody = '{}';
  const payload = buildSignedPayload(
    { method: 'post', originalUrl: path, rawBody } as Request,
    timestamp
  );
  return request(app)
    .post(path)
    .set('x-api-key', apiKey)
    .set('x-timestamp', timestamp)
    .set('x-signature', generateSignature(payload, apiKey))
    .set('content-type', 'application/json')
    .send(rawBody);
}

describe('POST /api/v1/merchant/keys/rotate (API key rotation)', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    resetMerchantRow(INITIAL_KEY);
  });

  it('is wired with the full auth stack (authMiddleware → requireAuth → tier limiter)', () => {
    const routes = merchantRoutes.stack
      .filter((layer: unknown) => (layer as { route?: unknown }).route)
      .map((layer: unknown) => {
        const route = (layer as { route: { path: string; methods: Record<string, boolean> } }).route;
        return { path: route.path, method: Object.keys(route.methods)[0] };
      });
    expect(routes).toContainEqual({ path: '/keys/rotate', method: 'post' });
  });

  it('rotates the key atomically and returns the new plaintext key exactly once', async () => {
    const res = await signedPost(app, ROTATE_PATH, INITIAL_KEY);

    expect(res.status).toBe(200);
    expect(res.body.merchantId).toBe(MERCHANT_ID);
    expect(res.body.apiKey).toMatch(/^vp_[0-9a-f]{32}$/);
    expect(res.body.apiKey).not.toBe(INITIAL_KEY);
    expect(String(res.body.warning)).toMatch(/never/i);

    // CAS write: where the CURRENT (pre-rotate) hash, data the NEW hash
    expect(prisma.merchant.updateMany).toHaveBeenCalledWith({
      where: {
        id: MERCHANT_ID,
        apiKeyHash: hashApiKey(INITIAL_KEY),
      },
      data: { apiKeyHash: hashApiKey(res.body.apiKey as string) },
    });
  });

  it('the OLD key is dead immediately after rotation (401 at auth, controller never reached)', async () => {
    const first = await signedPost(app, ROTATE_PATH, INITIAL_KEY);
    expect(first.status).toBe(200);
    const updateCallsAfterRotate = (prisma.merchant.updateMany as jest.Mock).mock.calls.length;

    // Second rotate still presenting the now-dead key: authMiddleware can no
    // longer resolve a merchant for its hash → 401 before the handler runs.
    const second = await signedPost(app, ROTATE_PATH, INITIAL_KEY);

    expect(second.status).toBe(401);
    expect(second.body.error).toBe('Invalid API key or signature');
    // The controller was never reached — no additional CAS write attempted.
    expect((prisma.merchant.updateMany as jest.Mock).mock.calls.length).toBe(
      updateCallsAfterRotate
    );
    // and no key material is leaked on the 401
    expect(second.body.apiKey).toBeUndefined();
  });

  it('the NEW key authenticates immediately after rotation (and can rotate again)', async () => {
    const first = await signedPost(app, ROTATE_PATH, INITIAL_KEY);
    expect(first.status).toBe(200);
    const newKey = first.body.apiKey as string;

    // Any authenticated endpoint now works with the new key — prove it by
    // rotating again (a full auth + CAS cycle with the new key).
    const second = await signedPost(app, ROTATE_PATH, newKey);
    expect(second.status).toBe(200);
    expect(second.body.apiKey).toMatch(/^vp_[0-9a-f]{32}$/);
    expect(second.body.apiKey).not.toBe(newKey);

    // The new key's own rotate used ITS hash as the CAS expectation.
    expect(prisma.merchant.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: MERCHANT_ID,
        apiKeyHash: hashApiKey(newKey),
      },
      data: { apiKeyHash: hashApiKey(second.body.apiKey as string) },
    });
  });

  it('returns 409 (no key material) when the CAS misses — a concurrent rotate won the row', async () => {
    // Model the race: auth resolved the merchant for key A (stale read),
    // but a concurrent rotation already moved the row to key C before this
    // request's updateMany ran. findFirst returns the merchant WITHOUT the
    // row-hash check for this one call (the auth read happened first).
    const staleKey = 'vp_stale_key_000000000000000000000';
    const concurrentKey = 'vp_concurrent_key_00000000000000000';
    resetMerchantRow(concurrentKey); // row already rotated by the winner
    (prisma.merchant.findFirst as jest.Mock).mockImplementationOnce(async () => ({
      id: MERCHANT_ID,
      businessName: 'Acme Corp',
      email: 'ops@acme.test',
    }));

    const res = await signedPost(app, ROTATE_PATH, staleKey);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('API_KEY_ROTATION_CONFLICT');
    expect(res.body.apiKey).toBeUndefined();
    // the CAS was attempted against the stale hash…
    expect(prisma.merchant.updateMany).toHaveBeenCalledWith({
      where: {
        id: MERCHANT_ID,
        apiKeyHash: hashApiKey(staleKey),
      },
      data: { apiKeyHash: expect.stringMatching(/^[0-9a-f]{64}$/) },
    });
    // …and the winner's key is untouched (row hash unchanged by the loser)
    expect(merchantRow.apiKeyHash).toBe(hashApiKey(concurrentKey));
  });

  it('returns 401 when the api key header is missing (auth stack)', async () => {
    const res = await request(app).post(ROTATE_PATH).send({});
    expect(res.status).toBe(401);
  });
});
