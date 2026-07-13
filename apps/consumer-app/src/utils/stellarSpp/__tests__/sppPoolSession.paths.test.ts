import { toNativeFsPath } from '../sppPoolSession';

describe('toNativeFsPath', () => {
  it('strips file:// for Android document URIs', () => {
    expect(toNativeFsPath('file:///data/user/0/com.veilpay.consumer/files/')).toBe(
      '/data/user/0/com.veilpay.consumer/files'
    );
  });

  it('leaves absolute paths alone (trim trailing slash)', () => {
    expect(
      toNativeFsPath('/storage/emulated/0/Android/data/com.veilpay.consumer/files/')
    ).toBe('/storage/emulated/0/Android/data/com.veilpay.consumer/files');
  });

  it('decodes percent-encoding', () => {
    expect(toNativeFsPath('file:///data/user/0/app/files/my%20dir')).toBe(
      '/data/user/0/app/files/my dir'
    );
  });
});
