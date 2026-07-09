import {
  signAndSendStellarTransaction,
  computeStellarMinReserveXlm,
} from '../stellarSigner';
import { getStoredMnemonic, TransactionError } from '../transactions';

jest.mock('../transactions', () => ({
  getStoredMnemonic: jest.fn(),
  TransactionError: class extends Error {
    code: string;
    constructor(m: string, c: string) { super(m); this.name = 'TransactionError'; this.code = c; }
  },
  NETWORKS: { stellar: { symbol: 'XLM', chainId: 'public' } }
}));

jest.mock('stellar-sdk', () => ({
  Keypair: {
    fromRawEd25519Seed: jest.fn().mockReturnValue({ publicKey: () => 'PUBKEY', secret: () => 'SECRET' })
  },
  Server: class {
    loadAccount = jest.fn().mockResolvedValue({ 
      sequence: '1',
      balances: [{ asset_type: 'native', balance: '10.0' }]
    });
    submitTransaction = jest.fn().mockResolvedValue({ hash: 'txHash' });
  },
  Account: class {
    constructor() {}
  },
  TransactionBuilder: class {
    constructor() {}
    addOperation() { return this; }
    setTimeout() { return this; }
    addMemo() { return this; }
    build() { return { sign: jest.fn(), toXDR: jest.fn().mockReturnValue('mock-xdr') }; }
  },
  Operation: {
    payment: jest.fn(),
    createAccount: jest.fn()
  },
  Asset: { native: jest.fn() },
  Networks: { PUBLIC: 'PUBLIC' }
}));

jest.mock('@scure/bip39', () => ({
  mnemonicToSeed: jest.fn().mockResolvedValue(new Uint8Array(64))
}));

jest.mock('ed25519-hd-key', () => ({
  derivePath: jest.fn().mockReturnValue({ key: new Uint8Array(32) })
}));

describe('stellarSigner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const VALID_STELLAR_ADDRESS = 'G' + 'A'.repeat(55);

  describe('computeStellarMinReserveXlm', () => {
    it('is 1 XLM for a bare account (0 subentries)', () => {
      expect(computeStellarMinReserveXlm(0)).toBe(1);
    });

    it('scales by 0.5 XLM per subentry', () => {
      expect(computeStellarMinReserveXlm(1)).toBe(1.5); // one trustline
      expect(computeStellarMinReserveXlm(4)).toBe(3); // e.g. 4 trustlines
    });

    it('falls back to the bare-account reserve for missing/malformed counts', () => {
      expect(computeStellarMinReserveXlm(undefined)).toBe(1);
      expect(computeStellarMinReserveXlm(null)).toBe(1);
      expect(computeStellarMinReserveXlm(NaN)).toBe(1);
      expect(computeStellarMinReserveXlm('3' as unknown)).toBe(1);
      expect(computeStellarMinReserveXlm(-5)).toBe(1); // clamps negatives to 0
    });
  });

  it('rejects a send that clears a flat-1-XLM check but violates the subentry reserve', async () => {
    // Account holds 3 XLM with 4 subentries → real reserve = (2+4)*0.5 = 3 XLM.
    // Sending 1.5 XLM would leave 1.5 XLM, which is < 3 XLM reserve and would be
    // rejected by Horizon. The old flat reserveXlm=1 check would have let it pass.
    (getStoredMnemonic as jest.Mock).mockResolvedValue(['test', 'seed']);
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('/accounts/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            sequence: '1',
            subentry_count: 4,
            balances: [{ asset_type: 'native', balance: '3.0' }],
          }),
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    await expect(
      signAndSendStellarTransaction(
        { to: VALID_STELLAR_ADDRESS, value: '1.5' } as any,
        'stellar'
      )
    ).rejects.toThrow(/Insufficient XLM/);
  });

  it('throws error if value is zero', async () => {
    await expect(signAndSendStellarTransaction({ to: VALID_STELLAR_ADDRESS, value: '0' } as any, 'stellar'))
      .rejects.toThrow('Amount must be greater than zero');
  });

  it('throws error if no mnemonic', async () => {
    (getStoredMnemonic as jest.Mock).mockResolvedValue(null);
    await expect(signAndSendStellarTransaction({ to: VALID_STELLAR_ADDRESS, value: '1' } as any, 'stellar'))
      .rejects.toThrow('No wallet found');
  });

  it('signs and sends stellar transaction', async () => {
    (getStoredMnemonic as jest.Mock).mockResolvedValue(['test', 'seed']);
    
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('/accounts/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            sequence: '1',
            balances: [{ asset_type: 'native', balance: '10.0' }]
          })
        });
      }
      if (url.includes('/transactions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ hash: 'txHash' })
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    const res = await signAndSendStellarTransaction({ to: VALID_STELLAR_ADDRESS, value: '1' } as any, 'stellar');
    expect(res.hash).toBe('txHash');
    expect(res.chainId).toBe(1);
  });
});
