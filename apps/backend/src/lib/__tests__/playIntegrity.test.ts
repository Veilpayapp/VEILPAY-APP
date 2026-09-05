import {
  issueAttestationNonce,
  verifyAttestationNonce,
  consumeAttestationNonce,
  checkDecodedVerdict,
  errorToHttp,
  type DecodedIntegrityVerdict,
  __playIntegrityTest,
} from '../playIntegrity';
import { getRedisClient } from '../redis';

// Stub Redis out so the single-use nonce path is unit-testable without a
// running instance. verifyAttestationNonce / checkDecodedVerdict are pure and
// never touch Redis, so this mock only affects consumeAttestationNonce.
jest.mock('../redis', () => ({
  getRedisClient: jest.fn(),
}));

const EXPECTED = {
  requestPackageName: 'com.veilpay.app',
  appCertSha256: 'AA:BB:CC'.repeat(9),
  minDeviceVerdict: 'MEETS_DEVICE_INTEGRITY',
  maxAgeMs: 300_000,
};

function validVerdict(over: Partial<DecodedIntegrityVerdict> = {}): DecodedIntegrityVerdict {
  const requestDetails = {
    requestPackageName: EXPECTED.requestPackageName,
    nonce: 'nonce-X',
    timestampMillis: Date.now(),
    ...(over.requestDetails ?? {}),
  };
  const appIntegrity = {
    appRecognitionVerdict: 'PLAY_RECOGNIZED',
    packageName: EXPECTED.requestPackageName,
    appCertSha256: [EXPECTED.appCertSha256],
    ...(over.appIntegrity ?? {}),
  };
  const hasDevice = Object.prototype.hasOwnProperty.call(over, 'deviceIntegrity');
  const deviceIntegrity =
    hasDevice && over.deviceIntegrity === undefined
      ? undefined
      : {
          deviceRecognitionVerdict: 'MEETS_DEVICE_INTEGRITY',
          ...(over.deviceIntegrity ?? {}),
        };
  return { requestDetails, appIntegrity, deviceIntegrity } as DecodedIntegrityVerdict;
}

describe('playIntegrity nonce', () => {
  it('issues a nonce that verifies round-trip', () => {
    const nonce = issueAttestationNonce();
    const check = verifyAttestationNonce(nonce);
    expect(check.ok).toBe(true);
    if (check.ok) {
      // base64url URL-safe field, 16 bytes → 22 chars, no trailing '='
      expect(check.nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);
    }
  });

  it('rejects a tampered nonce signature', () => {
    const nonce = issueAttestationNonce();
    const [body] = nonce.split('.');
    const bad = `${body}.${'A'.repeat(43)}`;
    expect(verifyAttestationNonce(bad)).toEqual({
      ok: false,
      code: 'NONCE_INVALID',
    });
  });

  it('rejects a nonce signed with a different secret', () => {
    const claims = Buffer.from(
      JSON.stringify({ n: 'deadbeefdeadbeefdeadbeef', exp: Date.now() + 60000 }),
      'utf8'
    ).toString('base64url');
    const wrongSig = __playIntegrityTest
      .hmacSha256(claims, 'some-other-secret-0123456789012345')
      .toString('base64url');
    expect(verifyAttestationNonce(`${claims}.${wrongSig}`)).toEqual({
      ok: false,
      code: 'NONCE_INVALID',
    });
  });

  it('rejects an expired nonce', () => {
    const claims = Buffer.from(
      JSON.stringify({ n: 'deadbeefdeadbeefdeadbeef', exp: Date.now() - 1000 }),
      'utf8'
    ).toString('base64url');
    const sig = __playIntegrityTest
      .hmacSha256(claims, process.env.JWT_SECRET as string)
      .toString('base64url');
    expect(verifyAttestationNonce(`${claims}.${sig}`)).toEqual({
      ok: false,
      code: 'NONCE_EXPIRED',
    });
  });

  it('rejects missing / malformed nonces', () => {
    expect(verifyAttestationNonce(undefined)).toEqual({
      ok: false,
      code: 'NONCE_MISSING',
    });
    expect(verifyAttestationNonce('')).toEqual({
      ok: false,
      code: 'NONCE_MISSING',
    });
    expect(verifyAttestationNonce('no-separator')).toEqual({
      ok: false,
      code: 'NONCE_INVALID',
    });
    expect(verifyAttestationNonce('..')).toEqual({
      ok: false,
      code: 'NONCE_INVALID',
    });
  });
});

describe('playIntegrity checkDecodedVerdict (consensus)', () => {
  it('accepts a fully valid verdict', () => {
    expect(checkDecodedVerdict(validVerdict(), 'nonce-X', EXPECTED)).toEqual({
      ok: true,
    });
  });

  it('rejects a mismatched request package', () => {
    expect(
      checkDecodedVerdict(
        validVerdict({ requestDetails: { requestPackageName: 'evil.app' } }),
        'nonce-X',
        EXPECTED
      )
    ).toEqual({ ok: false, code: 'PACKAGE_MISMATCH' });
  });

  it('rejects a nonce mismatch inside the verdict', () => {
    expect(
      checkDecodedVerdict(
        validVerdict({ requestDetails: { nonce: 'other-nonce' } }),
        'nonce-X',
        EXPECTED
      )
    ).toEqual({ ok: false, code: 'NONCE_MISMATCH' });
  });

  it('rejects a stale attestation outside the freshness window', () => {
    expect(
      checkDecodedVerdict(
        validVerdict({
          requestDetails: { timestampMillis: Date.now() - 400_000 },
        }),
        'nonce-X',
        EXPECTED
      )
    ).toEqual({ ok: false, code: 'ATTESTATION_STALE' });
  });

  it('rejects an app not recognized by Play', () => {
    expect(
      checkDecodedVerdict(
        validVerdict({
          appIntegrity: {
            appRecognitionVerdict: 'UNRECOGNIZED_VERSION',
            packageName: EXPECTED.requestPackageName,
          },
        }),
        'nonce-X',
        EXPECTED
      )
    ).toEqual({ ok: false, code: 'PACKAGE_MISMATCH' });
  });

  it('rejects a mismatched app certificate digest', () => {
    expect(
      checkDecodedVerdict(
        validVerdict({
          appIntegrity: {
            appRecognitionVerdict: 'PLAY_RECOGNIZED',
            packageName: EXPECTED.requestPackageName,
            appCertSha256: ['FF:EE:DD'],
          },
        }),
        'nonce-X',
        EXPECTED
      )
    ).toEqual({ ok: false, code: 'CERT_MISMATCH' });
  });

  it('rejects a device verdict below the floor', () => {
    expect(
      checkDecodedVerdict(
        validVerdict({
          deviceIntegrity: { deviceRecognitionVerdict: 'MEETS_BASIC_INTEGRITY' },
        }),
        'nonce-X',
        EXPECTED
      )
    ).toEqual({
      ok: false,
      code: 'DEVICE_INTEGRITY_FAILED',
      detail: 'MEETS_BASIC_INTEGRITY',
    });
  });

  it('accepts a stronger device verdict than the floor', () => {
    expect(
      checkDecodedVerdict(
        validVerdict({
          deviceIntegrity: { deviceRecognitionVerdict: 'MEETS_STRONG_INTEGRITY' },
        }),
        'nonce-X',
        EXPECTED
      )
    ).toEqual({ ok: true });
  });

  it('rejects a missing deviceIntegrity block', () => {
    expect(
      checkDecodedVerdict(validVerdict({ deviceIntegrity: undefined }), 'nonce-X', EXPECTED)
    ).toEqual({ ok: false, code: 'DEVICE_INTEGRITY_FAILED' });
  });
});

describe('errorToHttp', () => {
  it('maps 503 for not-configured and 502 for upstream unavailable', () => {
    expect(errorToHttp('ATTESTATION_NOT_CONFIGURED').status).toBe(503);
    expect(errorToHttp('TOKEN_VERIFICATION_UNAVAILABLE').status).toBe(502);
  });
  it('maps all denial reasons to 401', () => {
    for (const code of [
      'NONCE_MISSING',
      'NONCE_INVALID',
      'NONCE_EXPIRED',
      'TOKEN_MISSING',
      'TOKEN_INVALID',
      'PACKAGE_MISMATCH',
      'CERT_MISMATCH',
      'NONCE_MISMATCH',
      'DEVICE_INTEGRITY_FAILED',
      'ATTESTATION_STALE',
    ]) {
      expect(errorToHttp(code as Parameters<typeof errorToHttp>[0]).status).toBe(401);
    }
  });
});

describe('playIntegrity nonce single-use (consumeAttestationNonce)', () => {
  const mockGetClient = getRedisClient as jest.Mock;

  it('consumes a nonce on first use (Redis NX set succeeds)', async () => {
    const set = jest.fn().mockResolvedValue('OK');
    mockGetClient.mockReturnValue({ set });
    await expect(consumeAttestationNonce('abc.signature')).resolves.toEqual({
      ok: true,
    });
    // keyed on the full raw nonce, same TTL as the nonce expiry, NX (single-use)
    expect(set).toHaveBeenCalledWith(
      'nonce:used:abc.signature',
      '1',
      'EX',
      expect.any(Number),
      'NX'
    );
  });

  it('rejects a replay when the nonce key already exists', async () => {
    // ioredis SET with NX returns null when the key is already present.
    mockGetClient.mockReturnValue({ set: jest.fn().mockResolvedValue(null) });
    await expect(consumeAttestationNonce('abc.signature')).resolves.toEqual({
      ok: false,
      replay: true,
    });
  });

  it('fails safe (still verifies) when Redis is unavailable', async () => {
    mockGetClient.mockReturnValue(null);
    await expect(consumeAttestationNonce('abc.signature')).resolves.toEqual({
      ok: true,
    });
  });

  it('fails safe (still verifies) on a Redis error', async () => {
    mockGetClient.mockReturnValue({
      set: jest.fn().mockRejectedValue(new Error('redis down')),
    });
    await expect(consumeAttestationNonce('abc.signature')).resolves.toEqual({
      ok: true,
    });
  });
});
