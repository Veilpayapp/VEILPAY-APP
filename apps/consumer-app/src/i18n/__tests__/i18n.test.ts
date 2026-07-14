import { t, setLocale, getLocale, listLocales, __resetI18nForTests, enUS } from '../index';

describe('LOC-001 i18n foundation', () => {
  afterEach(() => {
    __resetI18nForTests();
  });

  it('defaults to en-US', () => {
    expect(getLocale()).toBe('en-US');
    expect(listLocales()).toContain('en-US');
  });

  it('resolves known keys from the en-US catalog', () => {
    expect(t('app.name')).toBe(enUS['app.name']);
    expect(t('onboarding.getStarted')).toBe('GET STARTED');
    expect(t('settings.wipe.label')).toMatch(/Erase all local data/i);
  });

  it('rejects unknown locales without changing the active one', () => {
    expect(setLocale('xx-YY')).toBe(false);
    expect(getLocale()).toBe('en-US');
  });

  it('accepts registered locales', () => {
    expect(setLocale('en-US')).toBe(true);
    expect(getLocale()).toBe('en-US');
  });
});
