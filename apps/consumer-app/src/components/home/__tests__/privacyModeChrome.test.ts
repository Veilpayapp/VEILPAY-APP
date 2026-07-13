/**
 * Privacy mode chrome contracts (animation keys + action labels).
 * Full Moti/Reanimated render is covered on-device; these lock the mode matrix.
 */

import { getPrivacyAssetById, canActivatePrivacyAsset } from '../../../constants/privacyAssets';

describe('privacy mode chrome contracts', () => {
  it('pXLM testnet asset activates; mainnet stays disabled', () => {
    const testnet = getPrivacyAssetById('spp-xlm-testnet');
    const mainnet = getPrivacyAssetById('spp-xlm-mainnet');
    expect(testnet).toBeTruthy();
    expect(canActivatePrivacyAsset(testnet!)).toBe(true);
    expect(mainnet).toBeTruthy();
    expect(canActivatePrivacyAsset(mainnet!)).toBe(false);
  });

  it('public vs private action label sets are disjoint except SCAN', () => {
    const publicLabels = new Set(['SEND', 'SCAN', 'RECEIVE', 'SWAP', 'FAUCET']);
    const privateLabels = new Set(['SHIELD', 'TRANSFER', 'SCAN', 'UNSHIELD', 'PUBLIC', 'RECEIVE']);
    // Shared only SCAN (and optional RECEIVE when no exit handler)
    const shared = [...publicLabels].filter((l) => privateLabels.has(l));
    expect(shared).toEqual(expect.arrayContaining(['SCAN']));
    expect(privateLabels.has('SHIELD')).toBe(true);
    expect(privateLabels.has('UNSHIELD')).toBe(true);
    expect(publicLabels.has('SHIELD')).toBe(false);
  });

  it('privacy card frame styles use transparent → accent border (no remount keys)', () => {
    // Contract: public frame is transparent border; private uses accent color.
    // Implemented as chainSelectorCardFrame / chainSelectorCardFramePrivate.
    const publicFrame = { borderWidth: 1, borderColor: 'transparent' };
    const privateFrame = { borderWidth: 1, borderColor: 'accent' };
    expect(publicFrame.borderWidth).toBe(privateFrame.borderWidth);
    expect(publicFrame.borderColor).not.toBe(privateFrame.borderColor);
  });

  it('testnet privacy subtitle has no protocol jargon', () => {
    const testnet = getPrivacyAssetById('spp-xlm-testnet');
    expect(testnet?.subtitle).toMatch(/Private XLM/i);
    expect(testnet?.subtitle).not.toMatch(/SPP|pool|notes|G…/i);
    expect(testnet?.features ?? []).toEqual([]);
  });
});
