import {
  SPP_TESTNET,
  assertSppEnabled,
  getSppConfigForChain,
  isSppEnabledForChain,
  sppConfigFromMainnetManifest,
  sppTxExplorerUrl,
  validateSppDeploymentManifest,
} from '../spp';

const MAINNET_MANIFEST = {
  network: 'mainnet' as const,
  deployer: 'GDJYRJWVGHYCTG2ZXIQWPAVRTC6N73S5F622H7TASGRTR22U3R5YZB2P',
  admin: 'GDJYRJWVGHYCTG2ZXIQWPAVRTC6N73S5F622H7TASGRTR22U3R5YZB2P',
  asp_membership: 'CCQDYFXMIMXHPNFFRM4TYHV55O6ESDTYKM3DYXBIUOFYRKWZV6W2XLUU',
  asp_non_membership: 'CDHJFGLFHAAUSYAWOXAQMFKPRLOLF64L264AC2425YXXLRSYAE2S4ET6',
  verifier: 'CBTS2RQHYUVFLEHPS6VEIDV25UPV3QGDNQIEUANSDNGTPJGS252FUMY5',
  public_key_registry: 'CAXFEOJDAUFWMOARB5X77HHVNA22XM2ATL2SYT6LUQL5FXSUFUJ6ABHD',
  pools: [{
    poolContractId: 'CDHNPXQNXKTUOWNMA3IQP3KUI4C7OKOUZF4OAMEJ24QLHUPE6NEDLJMA',
    tokenContractId: 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA',
    deploymentLedger: 63798643,
    enabled: true,
    asset: { kind: 'native' },
  }],
  maxDepositStroops: '1000000000',
};

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

  it('builds the repaired Mainnet deployment without losing public source accounts', () => {
    expect(validateSppDeploymentManifest(MAINNET_MANIFEST)).toBe(true);
    const config = sppConfigFromMainnetManifest(MAINNET_MANIFEST, {
      sorobanRpcUrl: 'https://rpc.example.test',
    });
    expect(config).toMatchObject({
      network: 'mainnet',
      deployer: MAINNET_MANIFEST.deployer,
      admin: MAINNET_MANIFEST.admin,
      poolId: MAINNET_MANIFEST.pools[0].poolContractId,
      aspMembershipId: MAINNET_MANIFEST.asp_membership,
      deploymentLedger: 63798643,
    });
  });

  it('rejects a manifest with missing simulation source accounts', () => {
    const { deployer: _deployer, ...missingDeployer } = MAINNET_MANIFEST;
    expect(validateSppDeploymentManifest(missingDeployer)).toBe(false);
  });

  it('builds explorer tx urls', () => {
    const url = sppTxExplorerUrl(SPP_TESTNET, 'abc123');
    expect(url).toBe(`${SPP_TESTNET.explorerBaseUrl}/tx/abc123`);
  });
});
