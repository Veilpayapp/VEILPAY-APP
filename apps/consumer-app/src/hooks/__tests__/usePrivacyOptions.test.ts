import {
  clampPrivacyLevel,
  getPrivacyOptionsForChain,
  isMaxPrivacyWithdrawReady,
  isPrivacyLevelEnabled,
  isSppPoolOpsReady,
} from '../usePrivacyOptions';

jest.mock('../../constants/contracts', () => ({
  SEPOLIA_CHAIN_ID: 11155111,
  isPrivacyStackConfigured: () => false,
  EVM_MAX_PRIVACY_WITHDRAW_READY: false,
}));

jest.mock('../../utils/stellarSpp/sppNativeBridge', () => ({
  sppNativeCapabilities: jest.fn(() => ({
    backend: 'stub',
    poolOps: false,
    aspLeaf: false,
    version: 'test',
  })),
}));

import { sppNativeCapabilities } from '../../utils/stellarSpp/sppNativeBridge';

describe('usePrivacyOptions / getPrivacyOptionsForChain', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (sppNativeCapabilities as jest.Mock).mockReturnValue({
      backend: 'stub',
      poolOps: false,
      aspLeaf: false,
      version: 'test',
    });
  });

  it('stellar-testnet: Private disabled when poolOps false (SPP-001)', () => {
    const opts = getPrivacyOptionsForChain('stellar-testnet', 'stellar-testnet');
    expect(opts.map((o) => o.id)).toEqual(['standard', 'private']);
    expect(opts.find((o) => o.id === 'private')?.enabled).toBe(false);
    expect(opts.find((o) => o.id === 'private')?.disabledReason).toMatch(
      /pool-ops/i
    );
    expect(opts.find((o) => o.id === 'standard')?.enabled).toBe(true);
  });

  it('stellar-testnet: Private enabled when poolOps true', () => {
    const opts = getPrivacyOptionsForChain('stellar-testnet', 'stellar-testnet', {
      poolOpsReady: true,
    });
    expect(opts.find((o) => o.id === 'private')?.enabled).toBe(true);
    expect(opts.find((o) => o.id === 'private')?.disabledReason).toBeUndefined();
  });

  it('stellar mainnet shows Private disabled (fail-closed)', () => {
    const opts = getPrivacyOptionsForChain('stellar', 'stellar-mainnet', {
      poolOpsReady: true,
    });
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

  it('DATA-002: max stays disabled even when poolOps/chain allow private', () => {
    const opts = getPrivacyOptionsForChain('sepolia', 11155111, {
      poolOpsReady: true,
    });
    // contracts mock has isPrivacyStackConfigured false → max still off
    expect(opts.find((o) => o.id === 'max')?.enabled).toBe(false);
    expect(isMaxPrivacyWithdrawReady()).toBe(false);
  });

  it('clamps max → private on stellar-testnet when poolOps ready', () => {
    expect(
      clampPrivacyLevel('max', 'stellar-testnet', 'stellar-testnet', {
        poolOpsReady: true,
      })
    ).toBe('private');
  });

  it('clamps private → standard when poolOps false', () => {
    expect(
      clampPrivacyLevel('private', 'stellar-testnet', 'stellar-testnet', {
        poolOpsReady: false,
      })
    ).toBe('standard');
  });

  it('clamps private → standard on ethereum', () => {
    expect(clampPrivacyLevel('private', 'ethereum', 1)).toBe('standard');
  });

  it('isPrivacyLevelEnabled for private requires poolOps on testnet', () => {
    expect(
      isPrivacyLevelEnabled('private', 'stellar-testnet', null, {
        poolOpsReady: true,
      })
    ).toBe(true);
    expect(
      isPrivacyLevelEnabled('private', 'stellar-testnet', null, {
        poolOpsReady: false,
      })
    ).toBe(false);
    expect(isPrivacyLevelEnabled('private', 'stellar', null)).toBe(false);
  });

  it('isSppPoolOpsReady reads native capabilities', () => {
    (sppNativeCapabilities as jest.Mock).mockReturnValue({ poolOps: true });
    expect(isSppPoolOpsReady()).toBe(true);
    (sppNativeCapabilities as jest.Mock).mockReturnValue({ poolOps: false });
    expect(isSppPoolOpsReady()).toBe(false);
  });
});
