/**
 * D3: the error handler must honor err.status / err.statusCode — body-parser
 * errors (400 entity.parse.failed, 413 PayloadTooLargeError with the "1mb"
 * express.json limit) previously surfaced as blanket 500s.
 */

import express from 'express';
import request from 'supertest';
import { errorHandler } from '../errorHandler';

function buildApp(): express.Express {
  const app = express();
  // Same body-parser setup as src/index.ts.
  app.use(
    express.json({
      limit: '1mb',
      verify: (req: import('http').IncomingMessage & { rawBody?: string }, _res, buffer) => {
        req.rawBody = buffer.toString('utf8');
      },
    })
  );
  app.post('/echo', (req, res) => {
    res.json({ ok: true, body: req.body });
  });
  app.get('/boom', () => {
    // Plain Error — no status — must stay a 500.
    throw new Error('plain failure');
  });
  app.use(errorHandler);
  return app;
}

describe('errorHandler honors err.status (D3)', () => {
  it('maps malformed JSON bodies to 400 (entity.parse.failed)', async () => {
    const app = buildApp();
    const response = await request(app)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Bad Request');
  });

  it('maps bodies over the 1mb limit to 413 (PayloadTooLargeError)', async () => {
    const app = buildApp();
    const oversized = `{"pad":"${'x'.repeat(1024 * 1024 + 1024)}"}`;

    const response = await request(app)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send(oversized);

    expect(response.status).toBe(413);
    expect(response.body.error).toBe('Payload Too Large');
  }, 15_000);

  it('keeps plain Errors at 500', async () => {
    const app = buildApp();
    const response = await request(app).get('/boom');

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('Internal server error');
  });

  it('honors any valid 4xx/5xx status carried by the error', () => {
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    const serviceUnavailable = new Error('upstream drained');
    (serviceUnavailable as { status?: number }).status = 503;
    errorHandler(serviceUnavailable, {} as never, mockRes as never, jest.fn());
    expect(mockRes.status).toHaveBeenCalledWith(503);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Service Unavailable' })
    );

    const tooMany = new Error('slow down');
    (tooMany as { statusCode?: number }).statusCode = 429;
    errorHandler(tooMany, {} as never, mockRes as never, jest.fn());
    expect(mockRes.status).toHaveBeenCalledWith(429);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Too Many Requests' })
    );
  });

  it('ignores invalid status values and stays at 500', () => {
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    const notAStatus = new Error('weird');
    (notAStatus as { status?: unknown }).status = 200; // 2xx is not an error status
    errorHandler(notAStatus, {} as never, mockRes as never, jest.fn());
    expect(mockRes.status).toHaveBeenCalledWith(500);

    const stringStatus = new Error('weirder');
    (stringStatus as { status?: unknown }).status = '418';
    errorHandler(stringStatus, {} as never, mockRes as never, jest.fn());
    expect(mockRes.status).toHaveBeenCalledWith(500);
  });
});

// console.error is intentionally noisy on these negative paths.
beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterAll(() => {
  jest.restoreAllMocks();
});
