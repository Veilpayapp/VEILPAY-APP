/**
 * TEST-001 — consumer gates for former blockers / dogfood bar.
 */

import fs from 'fs';
import path from 'path';
import { EVM_MAX_PRIVACY_WITHDRAW_READY } from '../constants/contracts';
import {
  getPrivacyOptionsForChain,
  isMaxPrivacyWithdrawReady,
  isSppPoolOpsReady,
} from '../hooks/usePrivacyOptions';
import { isSppEnabledForChain } from '../constants/spp';

jest.mock('../utils/stellarSpp/sppNativeBridge', () => ({
  sppNativeCapabilities: jest.fn(() => ({
    backend: 'stub',
    poolOps: false,
    aspLeaf: false,
    version: 'test',
  })),
}));

import { sppNativeCapabilities } from '../utils/stellarSpp/sppNativeBridge';

describe('TEST-001 blocker gates (consumer)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (sppNativeCapabilities as jest.Mock).mockReturnValue({
      backend: 'stub',
      poolOps: false,
      aspLeaf: false,
      version: 'test',
    });
  });

  it('DATA-002: max privacy withdraw stays gated off', () => {
    expect(EVM_MAX_PRIVACY_WITHDRAW_READY).toBe(false);
    expect(isMaxPrivacyWithdrawReady()).toBe(false);
  });

  it('DATA-002: max option disabled in privacy options', () => {
    const opts = getPrivacyOptionsForChain('sepolia', 11155111, {
      poolOpsReady: true,
    });
    expect(opts.find((o) => o.id === 'max')?.enabled).toBe(false);
  });

  it('SPP-001: private disabled when poolOps false', () => {
    const opts = getPrivacyOptionsForChain('stellar-testnet', 'stellar-testnet', {
      poolOpsReady: false,
    });
    expect(opts.find((o) => o.id === 'private')?.enabled).toBe(false);
    expect(isSppPoolOpsReady()).toBe(false);
  });

  it('SPP-001: private enabled only with poolOps on testnet', () => {
    (sppNativeCapabilities as jest.Mock).mockReturnValue({ poolOps: true });
    expect(isSppEnabledForChain('stellar-testnet')).toBe(true);
    const opts = getPrivacyOptionsForChain('stellar-testnet', 'stellar-testnet', {
      poolOpsReady: true,
    });
    expect(opts.find((o) => o.id === 'private')?.enabled).toBe(true);
  });

  it('mainnet Stellar private remains fail-closed', () => {
    expect(isSppEnabledForChain('stellar')).toBe(false);
    const opts = getPrivacyOptionsForChain('stellar', 'stellar', {
      poolOpsReady: true,
    });
    expect(opts.find((o) => o.id === 'private')?.enabled).toBe(false);
  });

  it('SEC-003 residual: SSL pin init fail-closed in release (source gate)', () => {
    const security = fs.readFileSync(
      path.join(__dirname, '..', 'utils', 'security.ts'),
      'utf8'
    );
    // Empty pins throw outside __DEV__; pin-init errors rethrow outside __DEV__.
    expect(security).toMatch(/EXPO_PUBLIC_SSL_PINS/);
    expect(security).toMatch(/Configure production SPKI hashes/);
    expect(security).toMatch(/if \(__DEV__\)/);
    expect(security).toMatch(/throw error/);
  });

  it('SEC-008/011: mainnet privacy remains process-gated (max flag false)', () => {
    // Ceremony/audit are operator gates; product must not flip max ready until then.
    expect(EVM_MAX_PRIVACY_WITHDRAW_READY).toBe(false);
  });
});
