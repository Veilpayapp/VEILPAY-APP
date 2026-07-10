import {
  deposit,
  getSppStatus,
  prepareSppOp,
  transfer,
  withdraw,
  ensureAspMembership,
  setSppNativeBackend,
  SppClientError,
} from '../index';

jest.mock('../sppOnboard', () => {
  const actual = jest.requireActual('../sppOnboard') as typeof import('../sppOnboard');
  return {
    ...actual,
    probeAspMembershipRoot: jest.fn(async () => ({
      ok: true,
      rootHint: 'mock RPC ok',
    })),
  };
});

const OWNER = 'GBU4T3ZUDWDCD3XQ2E7DNQ7V6A5FPR24LW7B5XH7LY4TMJXMITXG7ZME';

describe('stellarSpp/sppClient', () => {
  afterEach(() => {
    // reset to default js stub by re-importing is hard; inject a fresh stub
    setSppNativeBackend({
      version: () => '0.1.0-js-stub',
      ping: (input) => (input ? `pong:${input}` : 'pong'),
      capabilities: () => ({
        version: '0.1.0-js-stub',
        ping: true,
        poolOps: false,
        aspLeaf: false,
        backend: 'js-stub',
      }),
      deposit: async () => ({
        ok: false,
        code: 'SPP_OPS_NOT_READY',
        op: 'deposit',
        message: 'not ready',
      }),
      transfer: async () => ({
        ok: false,
        code: 'SPP_OPS_NOT_READY',
        op: 'transfer',
        message: 'not ready',
      }),
      withdraw: async () => ({
        ok: false,
        code: 'SPP_OPS_NOT_READY',
        op: 'withdraw',
        message: 'not ready',
      }),
      ensureAsp: async () => ({
        ok: false,
        code: 'SPP_ASP_NOT_READY',
        op: 'ensure_asp',
        message: 'asp not ready',
      }),
    });
  });

  it('reports enabled status on testnet with js-stub native', () => {
    const status = getSppStatus('stellar-testnet');
    expect(status.enabled).toBe(true);
    expect(status.native.poolOps).toBe(false);
    expect(status.native.backend).toBe('js-stub');
    expect(status.ping).toBe('pong:veilpay');
    expect(status.version).toContain('stub');
  });

  it('reports disabled on mainnet', () => {
    expect(getSppStatus('stellar').enabled).toBe(false);
  });

  it('prepareSppOp lists blockers when poolOps false', async () => {
    const prep = await prepareSppOp('stellar-testnet', OWNER);
    expect(prep.chainEnabled).toBe(true);
    expect(prep.poolOps).toBe(false);
    expect(prep.keysSigned).toBe(false);
    expect(prep.readyForProve).toBe(false);
    expect(prep.blockers.some((b) => /poolOps|native/i.test(b))).toBe(true);
    expect(prep.blockers.some((b) => /pXLM|Privacy|key/i.test(b))).toBe(true);
    expect(prep.asp.cliHint).toMatch(/insert_leaf/);
  });

  it('ensureAspMembership returns not_ready with cli hint', async () => {
    const asp = await ensureAspMembership('stellar-testnet', OWNER);
    expect(asp.status).toBe('not_ready');
    expect(asp.cliHint).toContain('onboard');
  });

  it('deposit fails closed when pool ops not ready (auto-onboard best-effort)', async () => {
    // Without a real wallet mnemonic, ensureSppAccountReady fails softly and
    // deposit still fails closed on native poolOps.
    await expect(deposit('stellar-testnet', OWNER, '1')).rejects.toMatchObject({
      code: 'SPP_OPS_NOT_READY',
    } satisfies Partial<SppClientError>);
  });

  it('deposit rejects mainnet', async () => {
    await expect(deposit('stellar', OWNER, '1')).rejects.toMatchObject({
      code: 'SPP_NOT_ENABLED',
    });
  });

  it('transfer validates recipient', async () => {
    await expect(
      transfer('stellar-testnet', OWNER, '0.5', {
        kind: 'address',
        stellarAddress: 'not-an-address',
      })
    ).rejects.toMatchObject({ code: 'SPP_INVALID_RECIPIENT' });
  });

  it('withdraw rejects non-positive amount', async () => {
    await expect(withdraw('stellar-testnet', OWNER, '0')).rejects.toMatchObject({
      code: 'SPP_INVALID_AMOUNT',
    });
  });
});
