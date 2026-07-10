import {
  clampPrivacyLevel,
  getPrivacyOptionsForChain,
  isPrivacyLevelEnabled,
} from '../usePrivacyOptions';

jest.mock('../../constants/contracts', () => ({
  SEPOLIA_CHAIN_ID: 11155111,
  isPrivacyStackConfigured: () => false,
}));

describe('usePrivacyOptions / getPrivacyOptionsForChain', () => {
  it('stellar-testnet offers Standard + enabled Private', () => {
    const opts = getPrivacyOptionsForChain('stellar-testnet', 'stellar-testnet');
    expect(opts.map((o) => o.id)).toEqual(['standard', 'private']);
    expect(opts.find((o) => o.id === 'private')?.enabled).toBe(true);
    expect(opts.find((o) => o.id === 'standard')?.enabled).toBe(true);
  });

  it('stellar mainnet shows Private disabled (fail-closed)', () => {
    const opts = getPrivacyOptionsForChain('stellar', 'stellar-mainnet');
    const priv = opts.find((o) => o.id === 'private');
    expect(priv?.enabled).toBe(false);
    expect(priv?.disabledReason).toMatch(/mainnet|audit/i);
  });

  it('ethereum without sepolia stack: only standard enabled', () => {
    const opts = getPrivacyOptionsForChain('ethereum', 1);
    expect(opts.find((o) => o.id === 'standard')?.enabled).toBe(true);
    expect(opts.find((o) => o.id === 'stealth')?.enabled).toBe(false);
    expect(opts.find((o) => o.id === 'max')?.enabled).toBe(false);
  });

  it('clamps max → private on stellar-testnet', () => {
    expect(clampPrivacyLevel('max', 'stellar-testnet', 'stellar-testnet')).toBe(
      'private'
    );
  });

  it('clamps private → standard on ethereum', () => {
    expect(clampPrivacyLevel('private', 'ethereum', 1)).toBe('standard');
  });

  it('isPrivacyLevelEnabled for private on testnet only', () => {
    expect(isPrivacyLevelEnabled('private', 'stellar-testnet', null)).toBe(true);
    expect(isPrivacyLevelEnabled('private', 'stellar', null)).toBe(false);
  });
});
