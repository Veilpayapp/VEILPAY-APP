import {
  PRIVACY_ASSETS,
  canActivatePrivacyAsset,
  getPrivacyAssetById,
  getPrivacyAssetsForChain,
  listPrivacyAssetsForSelector,
  privacyAssetToPaymentToken,
} from '../privacyAssets';

describe('privacyAssets', () => {
  it('lists enabled SPP on stellar-testnet only for activation', () => {
    const testnet = getPrivacyAssetsForChain('stellar-testnet');
    expect(testnet.some((a) => a.id === 'spp-xlm-testnet' && a.enabled)).toBe(true);
    expect(canActivatePrivacyAsset(testnet[0])).toBe(true);
  });

  it('shows mainnet private xlm as disabled fail-closed', () => {
    const mainnet = listPrivacyAssetsForSelector('stellar');
    expect(mainnet.length).toBeGreaterThan(0);
    expect(mainnet.every((a) => !a.enabled)).toBe(true);
    expect(canActivatePrivacyAsset(mainnet[0])).toBe(false);
  });

  it('maps privacy asset to PaymentToken with privacy flags', () => {
    const asset = getPrivacyAssetById('spp-xlm-testnet')!;
    const token = privacyAssetToPaymentToken(asset, '1.25', 0.1);
    expect(token.isPrivacyAsset).toBe(true);
    expect(token.privacyProtocol).toBe('spp');
    expect(token.balance).toBe('1.25');
    expect(token.symbol).toBe('pXLM');
  });

  it('has no privacy section on ethereum', () => {
    expect(listPrivacyAssetsForSelector('ethereum')).toEqual([]);
  });

  it('catalog includes both testnet and mainnet rows', () => {
    expect(PRIVACY_ASSETS.length).toBeGreaterThanOrEqual(2);
  });
});
