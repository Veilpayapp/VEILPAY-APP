import { syncPoolWithRpcFailover, isSppNetworkConnectionError } from '../sppRpcFailover';
import * as sppConstants from '../../../constants/spp';
import * as bridge from '../sppNativeBridge';
import * as poolSession from '../sppPoolSession';

jest.mock('../sppNativeBridge', () => ({
  sppNativePoolSync: jest.fn(),
  sppNativePoolClose: jest.fn(async () => ({ ok: true })),
  sppNativeCapabilities: jest.fn(() => ({ poolOps: true, ping: true })),
}));

jest.mock('../sppPoolSession', () => ({
  ensurePoolSession: jest.fn(async () => ({ ok: true })),
}));

jest.mock('../../../constants/spp', () => ({
  assertSppEnabled: jest.fn(),
  getSppFallbackRpcUrl: jest.fn(),
}));

jest.mock('../sppDiagnostics', () => ({
  recordSppDiagnostic: jest.fn(() => Promise.resolve()),
}));

describe('isSppNetworkConnectionError', () => {
  it.each([
    ['dns error: failed to lookup address', true],
    ['failed to lookup address information', true],
    ['client error (Connect)', true],
    ['error sending request', true],
    ['connect timed out', true],
    ['connection refused', true],
    ['network error: failed to connect', true],
    // The native indexer's own bounded catch-up deadline is NOT a network
    // error — it means a legitimate large sync exceeded the native limit, so a
    // fallback re-sync would be wasteful.
    ['sync: pool sync timed out (phase=catch_up, limit=90s, elapsed=90s)', false],
    ['indexer catch_up round timed out after 15s', false],
    // A generic connect timeout (no native phase/catch_up marker) is still a
    // retryable network failure.
    ['connect timed out', true],
    ['startLedger must be within retention', false],
    ['RPC sync gap', false],
    ['Bad union switch', false],
    ['Could not load account', false],
    ['ASP leaf ready', false],
    ['', false],
    [null, false],
    [undefined, false],
  ])('detects "%s" as %s', (msg, expected) => {
    expect(isSppNetworkConnectionError(msg)).toBe(expected);
  });
});

describe('syncPoolWithRpcFailover', () => {
  const ownerAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

  beforeEach(() => {
    jest.clearAllMocks();
    // The RPC preflight in syncPoolWithRpcFailover uses global fetch to probe
    // getLatestLedger. Without a mock, tests do real DNS lookups to
    // example.com. Default: primary RPC responds with a valid latest ledger.
    global.fetch = jest.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ jsonrpc: '2.0', result: { id: '12345' } }),
    })) as unknown as typeof fetch;
    (sppConstants.assertSppEnabled as jest.Mock).mockReturnValue({
      chainKey: 'stellar',
      network: 'mainnet',
      sorobanRpcUrl: 'https://primary.example.com',
      poolId: 'CPOOL',
      aspMembershipId: 'CASP',
      deploymentLedger: 1,
      maxDepositStroops: '1000000000',
    });
    (sppConstants.getSppFallbackRpcUrl as jest.Mock).mockReturnValue(
      'https://fallback.example.com'
    );
    (bridge.sppNativePoolSync as jest.Mock).mockResolvedValue({ ok: true });
    (poolSession.ensurePoolSession as jest.Mock).mockResolvedValue({ ok: true });
  });

  it('returns ok when primary sync succeeds', async () => {
    const result = await syncPoolWithRpcFailover('stellar', ownerAddress);
    expect(result.ok).toBe(true);
    // Primary RPC preflight succeeded, so usedFallback is false (not undefined).
    expect(result.usedFallback).toBe(false);
    expect(poolSession.ensurePoolSession).toHaveBeenCalledTimes(1);
    expect(bridge.sppNativePoolSync).toHaveBeenCalledTimes(1);
  });

  it('returns ok:false on non-network error (no fallback attempt)', async () => {
    (bridge.sppNativePoolSync as jest.Mock).mockResolvedValue({
      ok: false,
      message: 'startLedger must be within retention',
    });

    const result = await syncPoolWithRpcFailover('stellar', ownerAddress);
    expect(result.ok).toBe(false);
    expect(result.usedFallback).toBe(false);
    // message is humanized via formatSppSyncUserMessage.
    expect(result.message).toMatch(/history gap/i);
    // rawError preserves the original.
    expect(result.rawError).toBe('startLedger must be within retention');
    // Fallback should NOT be attempted for non-network errors.
    expect(bridge.sppNativePoolClose).not.toHaveBeenCalled();
  });

  it('does not fall back on testnet network error', async () => {
    (sppConstants.assertSppEnabled as jest.Mock).mockReturnValue({
      chainKey: 'stellar-testnet',
      network: 'testnet',
      sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
      poolId: 'CPOOL',
      aspMembershipId: 'CASP',
      deploymentLedger: 1,
      maxDepositStroops: '1000000000',
    });
    (bridge.sppNativePoolSync as jest.Mock).mockResolvedValue({
      ok: false,
      message: 'dns error: failed to lookup address',
    });

    const result = await syncPoolWithRpcFailover('stellar-testnet', ownerAddress);
    expect(result.ok).toBe(false);
    expect(result.usedFallback).toBe(false);
    expect(bridge.sppNativePoolClose).not.toHaveBeenCalled();
  });

  it('fails over to fallback RPC on mainnet DNS error and succeeds', async () => {
    // First sync fails with DNS error.
    (bridge.sppNativePoolSync as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        message: 'dns error: failed to lookup address information',
      })
      // Second sync (after reopen) succeeds.
      .mockResolvedValueOnce({ ok: true });

    const result = await syncPoolWithRpcFailover('stellar', ownerAddress);
    expect(result.ok).toBe(true);
    expect(result.usedFallback).toBe(true);
    // Should have: open → sync(fail) → close → reopen(fallback) → sync(ok)
    expect(poolSession.ensurePoolSession).toHaveBeenCalledTimes(2);
    expect(bridge.sppNativePoolClose).toHaveBeenCalledTimes(1);
    // Verify the second open used the fallback RPC.
    expect(poolSession.ensurePoolSession).toHaveBeenLastCalledWith(
      'stellar',
      ownerAddress,
      { rpcUrl: 'https://fallback.example.com' }
    );
  });

  it('does not fail over on the native catch-up deadline (not a network error)', async () => {
    // The native's own bounded catch-up deadline means a large-but-legitimate
    // sync exceeded the native time limit — not an RPC network failure. It must
    // NOT trigger a wasteful fallback re-sync.
    (bridge.sppNativePoolSync as jest.Mock).mockResolvedValue({
      ok: false,
      code: 'SPP_SYNC_FAILED',
      message: 'sync: pool sync timed out (phase=catch_up, limit=90s, elapsed=90s)',
    });

    const result = await syncPoolWithRpcFailover('stellar', ownerAddress);
    expect(result.ok).toBe(false);
    expect(result.usedFallback).toBe(false);
    expect(poolSession.ensurePoolSession).toHaveBeenCalledTimes(1);
    expect(bridge.sppNativePoolClose).not.toHaveBeenCalled();
    expect(bridge.sppNativePoolSync).toHaveBeenCalledTimes(1);
  });

  it('reports original error when fallback also fails', async () => {
    const primaryError = 'dns error: failed to lookup address information';
    const fallbackError = 'error sending request: connection reset';
    (bridge.sppNativePoolSync as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        message: primaryError,
      })
      .mockResolvedValueOnce({
        ok: false,
        message: fallbackError,
      });

    const result = await syncPoolWithRpcFailover('stellar', ownerAddress);
    expect(result.ok).toBe(false);
    // Must report the ORIGINAL error (humanized), not the fallback error.
    expect(result.message).toMatch(/Network temporarily unavailable/i);
    expect(result.primaryError).toBe(primaryError);
    expect(result.rawError).toBe(primaryError);
    expect(result.fallbackError).toBe(fallbackError);
    expect(result.usedFallback).toBe(true);
  });

  it('returns ok:false when pool open fails', async () => {
    (poolSession.ensurePoolSession as jest.Mock).mockResolvedValue({
      ok: false,
      message: 'Could not open pool session',
    });

    const result = await syncPoolWithRpcFailover('stellar', ownerAddress);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Could not open/);
    expect(result.syncResult).toBeUndefined();
    expect(bridge.sppNativePoolSync).not.toHaveBeenCalled();
  });

  it('does not fall back when no fallback URL is configured', async () => {
    (sppConstants.getSppFallbackRpcUrl as jest.Mock).mockReturnValue(null);
    (bridge.sppNativePoolSync as jest.Mock).mockResolvedValue({
      ok: false,
      message: 'dns error: failed to lookup address',
    });

    const result = await syncPoolWithRpcFailover('stellar', ownerAddress);
    expect(result.ok).toBe(false);
    // The preflight selected the primary RPC (usedFallback=false), but the
    // sync failed with a DNS error. Since no fallback URL is configured, the
    // function returns the sync error without attempting a close/reopen.
    expect(result.usedFallback).toBe(false);
    expect(bridge.sppNativePoolClose).not.toHaveBeenCalled();
  });
});
