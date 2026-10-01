/**
 * D2: /api/v1/health must respond even while the global rate limiter is
 * unavailable (Redis down → every rate-limit command used to queue forever).
 *
 * The global limiter is replaced with a middleware that NEVER calls next()
 * — the exact hang a Redis outage caused pre-D1/D2. If the health mount
 * still sat below `app.use("/api/", globalRateLimiter)`, the requests below
 * would never settle and the race would reject.
 */

import request from 'supertest';
import type { RequestHandler } from 'express';

// Must start with "mock" — jest hoists jest.mock() above these declarations.
// Simulates the limiter's store hanging on a dead Redis connection.
const mockHangingGlobalLimiter: RequestHandler = () => {
  /* intentionally never calls next() */
};
const mockPassThrough: RequestHandler = (_req, _res, next) => {
  next();
};

jest.mock('../middleware/rateLimiter', () => ({
  globalRateLimiter: mockHangingGlobalLimiter,
  authRateLimiter: mockPassThrough,
  webhookRateLimiter: mockPassThrough,
  webhookVerifyRateLimiter: mockPassThrough,
  rpcRateLimiter: mockPassThrough,
  onrampCreateLimiter: mockPassThrough,
  onrampQuotesLimiter: mockPassThrough,
  attestationNonceLimiter: mockPassThrough,
  invoiceStatusRateLimiter: mockPassThrough,
  registrationRateLimiter: mockPassThrough,
  getMerchantLimiter: async () => mockPassThrough,
  getMerchantTierLimit: () => ({ windowMs: 60_000, max: 100 }),
  invalidateMerchantLimiter: () => undefined,
}));

// Sentry import cost/side effects are irrelevant to this test.
jest.mock('@sentry/node', () => ({
  init: jest.fn(),
  setupExpressErrorHandler: () => mockPassThrough,
}));
jest.mock('@sentry/profiling-node', () => ({
  nodeProfilingIntegration: () => ({}),
}));

const { app } = require('../index');
const { prisma } = require('../lib/prisma');

// The root health probe runs a real prisma.$queryRaw against the dummy test
// DATABASE_URL — close the pool so jest doesn't linger on an open handle.
afterAll(async () => {
  await prisma.$disconnect();
});

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
  onTimeout: () => void
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        onTimeout();
        reject(new Error(message));
      }, ms);
    }),
  ]);
}

describe('health routes bypass the global rate limiter (D2)', () => {
  it('answers /api/v1/health/live while the global limiter hangs', async () => {
    const probe = request(app).get('/api/v1/health/live');
    const response = await withTimeout(
      probe,
      2000,
      '/api/v1/health/live did not respond within 2s — the global rate limiter is blocking health probes (mount order regression)',
      () => probe.abort()
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ alive: true });
  });

  it('answers /api/v1/health (root) while the global limiter hangs', async () => {
    // The root probe reports degraded under the dummy test DATABASE_URL —
    // the point is that it RESPONDS at all while the limiter hangs.
    const probe = request(app).get('/api/v1/health');
    const response = await withTimeout(
      probe,
      9000,
      '/api/v1/health did not respond within 9s — the global rate limiter is blocking health probes (mount order regression)',
      () => probe.abort()
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: expect.stringMatching(/^ok|degraded$/),
      services: {
        database: expect.stringMatching(/^connected|disconnected$/),
        redis: expect.stringMatching(/^connected|disconnected$/),
      },
    });
  });
});
