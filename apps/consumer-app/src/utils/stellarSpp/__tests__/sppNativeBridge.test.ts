import {
  reloadSppNativeBackend,
  setSppNativeBackend,
  sppNativeCapabilities,
  sppNativeDeposit,
  sppNativeEnsureCircuitAssets,
  sppNativePing,
  sppNativePoolReadiness,
  sppNativeVersion,
  type SppNativeOpResult,
} from '../sppNativeBridge';
import { createMockPoolBackend } from '../testUtils/mockPoolBackend';

describe('sppNativeBridge', () => {
  afterEach(() => {
    // Restore fail-closed js-stub-like backend
    setSppNativeBackend({
      version: () => '0.1.0-js-stub',
      ping: (i) => (i ? `pong:${i}` : 'pong'),
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
        message: 'stub',
      }),
      poolReadiness: async () => ({
        ok: false,
        op: 'pool_readiness',
        message: 'stub',
      }),
      ensureCircuitAssets: async () => ({
        ok: false,
        code: 'SPP_OPS_NOT_READY',
        op: 'ensure_circuit_assets',
        message: 'stub',
      }),
    });
  });

  it('ping and version on injected backend', () => {
    setSppNativeBackend(createMockPoolBackend());
    expect(sppNativeVersion()).toBe('0.1.0-mock-pool');
    expect(sppNativePing('x')).toBe('pong:x');
    expect(sppNativeCapabilities().poolOps).toBe(true);
    expect(sppNativeCapabilities().aspLeaf).toBe(true);
  });

  it('deposit returns ok with mock pool', async () => {
    setSppNativeBackend(createMockPoolBackend());
    const r = await sppNativeDeposit('1');
    expect(r.ok).toBe(true);
    expect(r.txHash).toBeTruthy();
  });

  it('fails closed on malformed native result', async () => {
    setSppNativeBackend({
      ...createMockPoolBackend(),
      deposit: async () => ({ ok: 'true' }) as unknown as SppNativeOpResult,
    });
    const r = await sppNativeDeposit('1');
    expect(r).toMatchObject({
      ok: false,
      code: 'SPP_NATIVE_BAD_RESULT',
      op: 'deposit',
    });
  });

  it('fails closed when native call throws synchronously', async () => {
    setSppNativeBackend({
      ...createMockPoolBackend(),
      deposit: () => {
        throw new Error('boom from native');
      },
    });
    const r = await sppNativeDeposit('1');
    expect(r).toMatchObject({
      ok: false,
      code: 'SPP_NATIVE_EXCEPTION',
      op: 'deposit',
      message: 'boom from native',
    });
  });

  it('poolReadiness available on mock', async () => {
    setSppNativeBackend({
      ...createMockPoolBackend(),
      poolReadiness: async () => ({
        ok: false,
        op: 'pool_readiness',
        message: 'mock readiness',
      }),
    });
    const r = await sppNativePoolReadiness();
    expect(r.op).toBe('pool_readiness');
  });

  it('ensureCircuitAssets normalizes native result', async () => {
    setSppNativeBackend({
      ...createMockPoolBackend(),
      ensureCircuitAssets: async () => ({
        ok: true,
        op: 'ensure_circuit_assets',
        message: 'seeded',
      }),
    });
    const r = await sppNativeEnsureCircuitAssets();
    expect(r).toMatchObject({ ok: true, op: 'ensure_circuit_assets' });
  });

  it('reloadSppNativeBackend returns a module', () => {
    const m = reloadSppNativeBackend();
    expect(typeof m.version).toBe('function');
    expect(typeof m.capabilities).toBe('function');
  });
});
