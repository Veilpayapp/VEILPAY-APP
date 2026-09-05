import type { Request, Response, NextFunction } from 'express';
import { playIntegrityAuth } from '../playIntegrityAuth';

// Mock the config singleton and the playIntegrity lib so we can drive each
// gate (enabled/disabled, production/dev, configured/unconfigured) without
// real crypto or Google I/O.
jest.mock('../../config', () => ({
  config: {
    nodeEnv: 'test',
    playIntegrity: {
      enabled: false,
      packageName: 'com.veilpay.app',
      appCertSha256: 'AA:BB:CC',
      serviceAccountB64: 'c2VydmljZS1hY2NvdW50',
      minDeviceVerdict: 'MEETS_DEVICE_INTEGRITY',
      maxAgeMs: 300_000,
    },
  },
}));

const mockVerify = jest.fn();
const mockIsConfigured = jest.fn();
jest.mock('../../lib/playIntegrity', () => ({
  verifyAttestation: (...args: unknown[]) => mockVerify(...args),
  isPlayIntegrityConfigured: () => mockIsConfigured(),
  errorToHttp: jest.requireActual('../../lib/playIntegrity').errorToHttp,
}));

// Re-import after mocking to get the stubbed config.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { config } = jest.requireMock('../../config') as {
  config: {
    nodeEnv: string;
    playIntegrity: {
      enabled: boolean;
      minDeviceVerdict: string;
      maxAgeMs: number;
    };
  };
};

function mockRes() {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

function reqWith(headers: Record<string, string>): Request {
  return {
    get: (name: string) => headers[name.toLowerCase()] ?? undefined,
  } as unknown as Request;
}

describe('playIntegrityAuth', () => {
  const prevEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsConfigured.mockReturnValue(true);
  });

  afterEach(() => {
    if (prevEnv !== undefined) process.env.NODE_ENV = prevEnv;
    else delete process.env.NODE_ENV;
  });

  it('passes through in dev/test when attestation is disabled (rollout)', () => {
    config.playIntegrity.enabled = false;
    process.env.NODE_ENV = 'development';
    const next = jest.fn() as NextFunction;
    playIntegrityAuth(reqWith({}), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('fails closed when NODE_ENV is unset and attestation is disabled', () => {
    config.playIntegrity.enabled = false;
    delete process.env.NODE_ENV;
    const res = mockRes();
    const next = jest.fn() as NextFunction;
    playIntegrityAuth(reqWith({}), res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('fails closed in production when attestation is disabled', () => {
    config.playIntegrity.enabled = false;
    process.env.NODE_ENV = 'production';
    const res = mockRes();
    const next = jest.fn() as NextFunction;
    playIntegrityAuth(reqWith({}), res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('refuses when enabled but config is incomplete', () => {
    config.playIntegrity.enabled = true;
    config.nodeEnv = 'production';
    mockIsConfigured.mockReturnValue(false);
    const res = mockRes();
    const next = jest.fn() as NextFunction;
    playIntegrityAuth(reqWith({}), res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a missing token when enabled', () => {
    config.playIntegrity.enabled = true;
    config.nodeEnv = 'production';
    const res = mockRes();
    const next = jest.fn() as NextFunction;
    playIntegrityAuth(reqWith({}), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts the request when attestation verifies', async () => {
    config.playIntegrity.enabled = true;
    config.nodeEnv = 'production';
    mockVerify.mockResolvedValue({ ok: true });
    const next = jest.fn() as NextFunction;
    const res = mockRes();
    playIntegrityAuth(
      reqWith({ 'x-play-integrity': 'token', 'x-veilpay-nonce': 'nonce' }),
      res,
      next
    );
    // allow the async verify promise to settle
    await new Promise((r) => setImmediate(r));
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects when attestation fails, mapping the denial code', async () => {
    config.playIntegrity.enabled = true;
    config.nodeEnv = 'production';
    mockVerify.mockResolvedValue({
      ok: false,
      code: 'DEVICE_INTEGRITY_FAILED',
      detail: 'MEETS_BASIC_INTEGRITY',
    });
    const next = jest.fn() as NextFunction;
    const res = mockRes();
    playIntegrityAuth(
      reqWith({ 'x-play-integrity': 'token', 'x-veilpay-nonce': 'nonce' }),
      res,
      next
    );
    await new Promise((r) => setImmediate(r));
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'DEVICE_INTEGRITY_FAILED',
        detail: 'MEETS_BASIC_INTEGRITY',
      })
    );
    expect(next).not.toHaveBeenCalled();
  });
});
