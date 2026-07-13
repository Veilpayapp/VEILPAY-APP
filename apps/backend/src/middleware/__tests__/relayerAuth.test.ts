import type { Request, Response, NextFunction } from 'express';
import { relayerCallerAuth } from '../relayerAuth';

function mockRes() {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

describe('relayerCallerAuth (SEC-006 residual)', () => {
  const prevSecret = process.env.RELAYER_SHARED_SECRET;
  const prevEnv = process.env.NODE_ENV;
  const prevAllow = process.env.RELAYER_ALLOW_UNAUTHENTICATED;

  afterEach(() => {
    if (prevSecret !== undefined) process.env.RELAYER_SHARED_SECRET = prevSecret;
    else delete process.env.RELAYER_SHARED_SECRET;
    if (prevEnv !== undefined) process.env.NODE_ENV = prevEnv;
    else delete process.env.NODE_ENV;
    if (prevAllow !== undefined) process.env.RELAYER_ALLOW_UNAUTHENTICATED = prevAllow;
    else delete process.env.RELAYER_ALLOW_UNAUTHENTICATED;
  });

  it('passes through in development when no secret is configured', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.RELAYER_SHARED_SECRET;
    const next = jest.fn() as NextFunction;
    relayerCallerAuth({ headers: {} } as Request, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects in production when secret is not configured', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.RELAYER_SHARED_SECRET;
    delete process.env.RELAYER_ALLOW_UNAUTHENTICATED;
    const res = mockRes();
    const next = jest.fn() as NextFunction;
    relayerCallerAuth({ headers: {} } as Request, res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects missing secret header when secret is configured', () => {
    process.env.RELAYER_SHARED_SECRET = 's3cret';
    const res = mockRes();
    const next = jest.fn() as NextFunction;
    relayerCallerAuth({ headers: {} } as Request, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts matching X-Relayer-Secret', () => {
    process.env.RELAYER_SHARED_SECRET = 's3cret';
    const next = jest.fn() as NextFunction;
    relayerCallerAuth(
      { headers: { 'x-relayer-secret': 's3cret' } } as unknown as Request,
      mockRes(),
      next
    );
    expect(next).toHaveBeenCalled();
  });

  it('rejects wrong secret', () => {
    process.env.RELAYER_SHARED_SECRET = 's3cret';
    const res = mockRes();
    const next = jest.fn() as NextFunction;
    relayerCallerAuth(
      { headers: { 'x-relayer-secret': 'nope' } } as unknown as Request,
      res,
      next
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
