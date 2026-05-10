import { Linking } from 'react-native';
import { openExternalUrl } from '../externalLink';

describe('openExternalUrl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('opens supported URLs and returns true', async () => {
    const result = await openExternalUrl('https://veilpay.app/terms');

    expect(result).toBe(true);
    expect(Linking.canOpenURL).toHaveBeenCalledWith('https://veilpay.app/terms');
    expect(Linking.openURL).toHaveBeenCalledWith('https://veilpay.app/terms');
  });

  it('returns false when the URL cannot be opened', async () => {
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(false);

    const result = await openExternalUrl('https://veilpay.app/privacy');

    expect(result).toBe(false);
    expect(Linking.openURL).not.toHaveBeenCalled();
  });
});