import { publicClient, walletClient, account } from '../chain';
import { createPublicClient, createWalletClient } from 'viem';

jest.mock('viem', () => ({
  createPublicClient: jest.fn(() => 'public-client'),
  createWalletClient: jest.fn(() => 'wallet-client'),
  http: jest.fn(() => 'http-transport')
}));

jest.mock('viem/accounts', () => ({
  privateKeyToAccount: jest.fn(() => 'mocked-account')
}));

jest.mock('../../config', () => ({
  config: {
    nodeEnv: 'test',
    rpc: { alchemyApiKey: 'test-key' },
    relayerPrivateKey: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  }
}));

describe('chain', () => {
  it('should create public and wallet clients based on config', () => {
    expect(createPublicClient).toHaveBeenCalled();
    expect(createWalletClient).toHaveBeenCalled();
    expect(publicClient).toBe('public-client');
    expect(walletClient).toBe('wallet-client');
    expect(account).toBe('mocked-account');
  });
});
