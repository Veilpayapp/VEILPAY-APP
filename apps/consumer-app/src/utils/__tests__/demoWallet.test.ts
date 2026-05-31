import { createDemoEvmAddress } from '../demoWallet';

const mockCreateRandom = jest.fn(() => ({
  address: '0x2222222222222222222222222222222222222222',
}));

jest.mock('viem/accounts', () => ({
  generatePrivateKey: () => '0x123',
  privateKeyToAccount: () => mockCreateRandom(),
}));

describe('createDemoEvmAddress', () => {
  beforeEach(() => {
    mockCreateRandom.mockReset();
    mockCreateRandom.mockReturnValue({
      address: '0x2222222222222222222222222222222222222222',
    });
  });

  it('uses viem random generation for demo addresses', () => {
    expect(createDemoEvmAddress()).toBe('0x2222222222222222222222222222222222222222');
    expect(mockCreateRandom).toHaveBeenCalledTimes(1);
  });
});