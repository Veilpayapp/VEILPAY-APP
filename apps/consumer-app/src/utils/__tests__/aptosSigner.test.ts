import {
  signAndSendAptosTransaction,
  parseAptosAmountToOctas,
  APTOS_DERIVATION_PATH,
} from '../aptosSigner';
import { getStoredMnemonic } from '../transactions';

jest.mock('../transactions', () => ({
  getStoredMnemonic: jest.fn(),
  TransactionError: class extends Error {
    code: string;
    constructor(m: string, c: string) {
      super(m);
      this.name = 'TransactionError';
      this.code = c;
    }
  },
  NETWORKS: { aptos: { symbol: 'APT', chainId: 1 } },
}));

const mockGetAccountAPTAmount = jest.fn();
const mockFromDerivationPath = jest.fn();

jest.mock('@aptos-labs/ts-sdk', () => ({
  Aptos: class {
    getAccountAPTAmount = mockGetAccountAPTAmount;
    transaction = {
      build: { simple: jest.fn().mockResolvedValue({}) },
      sign: jest.fn().mockReturnValue({}),
      submit: { simple: jest.fn().mockResolvedValue({ hash: 'txHash' }) },
    };
    waitForTransaction = jest.fn().mockResolvedValue({});
  },
  AptosConfig: class {},
  Account: {
    fromDerivationPath: (...args: unknown[]) => mockFromDerivationPath(...args),
  },
  Network: { MAINNET: 'mainnet', TESTNET: 'testnet', DEVNET: 'devnet' },
}));

jest.mock('../rpc', () => ({
  getRpcUrl: jest.fn().mockReturnValue('https://fullnode.mainnet.aptoslabs.com'),
}));

jest.mock('../sentry', () => ({
  captureError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

const VALID_APTOS = '0x' + 'ab'.repeat(32); // 0x + 64 hex

describe('aptosSigner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFromDerivationPath.mockReturnValue({
      accountAddress: { toString: () => '0xsender' },
    });
    mockGetAccountAPTAmount.mockResolvedValue(10_000_00000); // 10 APT in octas
  });

  describe('APTOS_DERIVATION_PATH', () => {
    it('uses BIP-44 coin type 637 (Aptos), matching multiChainDerivation', () => {
      // Regression: a prior typo used 634, which signed from a different key
      // than the address shown for receive — funds on-screen were unspendable.
      expect(APTOS_DERIVATION_PATH).toBe("m/44'/637'/0'/0'/0'");
      expect(APTOS_DERIVATION_PATH).not.toContain("634");
    });
  });

  describe('parseAptosAmountToOctas', () => {
    it('parses whole and fractional APT amounts', () => {
      expect(parseAptosAmountToOctas('1')).toBe(100_000_000n);
      expect(parseAptosAmountToOctas('0.5')).toBe(50_000_000n);
      expect(parseAptosAmountToOctas('1.00000001')).toBe(100_000_001n);
    });

    it('rejects scientific notation, commas, zero, and junk', () => {
      expect(() => parseAptosAmountToOctas('1e8')).toThrow(/Invalid APT amount/);
      expect(() => parseAptosAmountToOctas('1,5')).toThrow(/Invalid APT amount/);
      expect(() => parseAptosAmountToOctas('0')).toThrow(/greater than zero/);
      expect(() => parseAptosAmountToOctas('-1')).toThrow(/Invalid APT amount/);
      expect(() => parseAptosAmountToOctas('abc')).toThrow(/Invalid APT amount/);
    });
  });

  it('rejects invalid Aptos address', async () => {
    await expect(
      signAndSendAptosTransaction({ to: 'not-an-address', value: '1' } as any, 'aptos')
    ).rejects.toMatchObject({ code: 'INVALID_ADDRESS' });
  });

  it('rejects unsupported network', async () => {
    await expect(
      signAndSendAptosTransaction({ to: VALID_APTOS, value: '1' } as any, 'ethereum')
    ).rejects.toThrow(/Unsupported Aptos network/);
  });

  it('throws error if value is zero', async () => {
    await expect(
      signAndSendAptosTransaction({ to: VALID_APTOS, value: '0' } as any, 'aptos')
    ).rejects.toThrow('Transaction value must be greater than zero');
  });

  it('throws error if no mnemonic', async () => {
    (getStoredMnemonic as jest.Mock).mockResolvedValue(null);
    await expect(
      signAndSendAptosTransaction({ to: VALID_APTOS, value: '1' } as any, 'aptos')
    ).rejects.toThrow('No wallet found');
  });

  it('throws INSUFFICIENT_FUNDS when balance cannot cover amount + gas', async () => {
    (getStoredMnemonic as jest.Mock).mockResolvedValue(['test', 'seed']);
    // 0.5 APT balance, try to send 1 APT
    mockGetAccountAPTAmount.mockResolvedValue(50_000_000);

    await expect(
      signAndSendAptosTransaction({ to: VALID_APTOS, value: '1' } as any, 'aptos')
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
  });

  it('signs and sends aptos transaction with the 637 derivation path', async () => {
    (getStoredMnemonic as jest.Mock).mockResolvedValue(['test', 'seed']);

    const res = await signAndSendAptosTransaction(
      { to: VALID_APTOS, value: '1' } as any,
      'aptos'
    );

    expect(res.hash).toBe('txHash');
    expect(res.chainId).toBe(1);
    expect(mockFromDerivationPath).toHaveBeenCalledWith({
      path: "m/44'/637'/0'/0'/0'",
      mnemonic: 'test seed',
    });
  });
});
