import { signAndSendAptosTransaction } from '../aptosSigner';
import { getStoredMnemonic, TransactionError } from '../transactions';

jest.mock('../transactions', () => ({
  getStoredMnemonic: jest.fn(),
  TransactionError: class extends Error {
    code: string;
    constructor(m: string, c: string) { super(m); this.name = 'TransactionError'; this.code = c; }
  },
  NETWORKS: { aptos: { symbol: 'APT', chainId: 1 } }
}));

jest.mock('@aptos-labs/ts-sdk', () => ({
  Aptos: class {
    getAccountInfo = jest.fn().mockResolvedValue({ sequence_number: '1' });
    transaction = {
      build: { simple: jest.fn().mockResolvedValue({}) },
      sign: jest.fn().mockReturnValue({}),
      submit: { simple: jest.fn().mockResolvedValue({ hash: 'txHash' }) }
    };
    waitForTransaction = jest.fn().mockResolvedValue({});
  },
  AptosConfig: class {},
  Account: class {
    static fromDerivationPath = jest.fn().mockReturnValue({ accountAddress: { toString: () => '0x123' } });
  },
  Network: { MAINNET: 'mainnet' }
}));

describe('aptosSigner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws error if value is zero', async () => {
    await expect(signAndSendAptosTransaction({ to: 'valid', value: '0' } as any, 'aptos'))
      .rejects.toThrow('Transaction value must be greater than zero');
  });

  it('throws error if no mnemonic', async () => {
    (getStoredMnemonic as jest.Mock).mockResolvedValue(null);
    await expect(signAndSendAptosTransaction({ to: 'valid', value: '1' } as any, 'aptos'))
      .rejects.toThrow('No wallet found');
  });

  it('signs and sends aptos transaction', async () => {
    (getStoredMnemonic as jest.Mock).mockResolvedValue(['test', 'seed']);
    const res = await signAndSendAptosTransaction({ to: 'valid', value: '1' } as any, 'aptos');
    expect(res.hash).toBe('txHash');
    expect(res.chainId).toBe(1);
  });
});
