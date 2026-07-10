import {
  reloadSppNativeBackend,
  setSppNativeBackend,
  sppNativeCapabilities,
  sppNativeDeposit,
  sppNativePing,
  sppNativePoolReadiness,
  sppNativeVersion,
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

  it('reloadSppNativeBackend returns a module', () => {
    const m = reloadSppNativeBackend();
    expect(typeof m.version).toBe('function');
    expect(typeof m.capabilities).toBe('function');
  });
});
