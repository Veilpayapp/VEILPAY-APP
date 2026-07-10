import {
  SPP_TESTNET,
  assertSppEnabled,
  getSppConfigForChain,
  isSppEnabledForChain,
  sppTxExplorerUrl,
} from '../spp';

describe('constants/spp', () => {
  it('enables SPP only on stellar-testnet', () => {
    expect(isSppEnabledForChain('stellar-testnet')).toBe(true);
    expect(isSppEnabledForChain('stellar')).toBe(false);
    expect(isSppEnabledForChain('ethereum')).toBe(false);
    expect(isSppEnabledForChain(null)).toBe(false);
  });

  it('returns testnet deployment with known pool id', () => {
    const cfg = getSppConfigForChain('stellar-testnet');
    expect(cfg).toEqual(SPP_TESTNET);
    expect(cfg?.poolId).toMatch(/^C[A-Z0-9]{55}$/);
    expect(cfg?.verifierId).toMatch(/^C[A-Z0-9]{55}$/);
  });

  it('mainnet fail-closed via assertSppEnabled', () => {
    expect(() => assertSppEnabled('stellar')).toThrow(/mainnet/i);
    try {
      assertSppEnabled('stellar');
    } catch (e) {
      expect((e as Error & { code?: string }).code).toBe('SPP_NOT_ENABLED');
    }
  });

  it('assertSppEnabled returns config for testnet', () => {
    expect(assertSppEnabled('stellar-testnet').network).toBe('testnet');
  });

  it('builds explorer tx urls', () => {
    const url = sppTxExplorerUrl(SPP_TESTNET, 'abc123');
    expect(url).toBe(`${SPP_TESTNET.explorerBaseUrl}/tx/abc123`);
  });
});
