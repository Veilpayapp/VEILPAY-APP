import { signAndSendSolanaTransaction } from '../solanaSigner';
import { getStoredMnemonic, TransactionError } from '../transactions';
import { poolCallSolana } from '../solanaRpcPool';

jest.mock('../transactions', () => ({
  getStoredMnemonic: jest.fn(),
  TransactionError: class extends Error {
    code: string;
    constructor(m: string, c: string) { super(m); this.name = 'TransactionError'; this.code = c; }
  },
  NETWORKS: { solana: { symbol: 'SOL', chainId: 900 } }
}));

jest.mock('../solanaRpcPool', () => ({
  poolCallSolana: jest.fn()
}));

jest.mock('@solana/web3.js', () => ({
  PublicKey: class {
    val: string;
    constructor(val: string) { 
      this.val = val;
      if (val === 'invalid') throw new Error(); 
    }
    static isOnCurve() { return true; }
    toBytes() { return new Uint8Array(32); }
  },
  Keypair: { fromSeed: jest.fn().mockReturnValue({ publicKey: {} }) },
  Transaction: class {
    add() {}
    sign() {}
    serialize() { return Buffer.from('tx'); }
  },
  SystemProgram: { transfer: jest.fn() },
  LAMPORTS_PER_SOL: 1000000000
}));

jest.mock('@solana/spl-token', () => ({
  getAssociatedTokenAddress: jest.fn().mockResolvedValue({}),
  createAssociatedTokenAccountInstruction: jest.fn(),
  createTransferInstruction: jest.fn(),
  TOKEN_PROGRAM_ID: {}
}));

jest.mock('@scure/bip39', () => ({
  mnemonicToSeed: jest.fn().mockResolvedValue(new Uint8Array(64))
}));

jest.mock('ed25519-hd-key', () => ({
  derivePath: jest.fn().mockReturnValue({ key: new Uint8Array(32) })
}));

describe('solanaSigner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws error for invalid address', async () => {
    await expect(signAndSendSolanaTransaction({ to: 'invalid', value: '1' } as any, 'solana'))
      .rejects.toThrow('Invalid Solana address');
  });

  it('throws error if network is not supported', async () => {
    await expect(signAndSendSolanaTransaction({ to: 'valid', value: '1' } as any, 'unsupported'))
      .rejects.toThrow('Unsupported Solana network');
  });

  it('throws error if value is zero', async () => {
    await expect(signAndSendSolanaTransaction({ to: 'valid', value: '0' } as any, 'solana'))
      .rejects.toThrow('Transaction value must be greater than zero');
  });

  it('throws error if no mnemonic', async () => {
    (getStoredMnemonic as jest.Mock).mockResolvedValue(null);
    await expect(signAndSendSolanaTransaction({ to: 'valid', value: '1' } as any, 'solana'))
      .rejects.toThrow('No wallet found');
  });

  it('signs and sends native SOL transaction', async () => {
    (getStoredMnemonic as jest.Mock).mockResolvedValue(['test', 'seed']);
    (poolCallSolana as jest.Mock).mockImplementation(async (chain, fn) => {
      // Mocking getBalance
      if (fn.toString().includes('getBalance')) return 2000000000n; // 2 SOL
      if (fn.toString().includes('getLatestBlockhash')) return { blockhash: 'bh', lastValidBlockHeight: 1 };
      if (fn.toString().includes('sendRawTransaction')) return 'txHash';
    });

    const res = await signAndSendSolanaTransaction({ to: 'valid', value: '1' } as any, 'solana');
    expect(res.hash).toBe('txHash');
    expect(res.chainId).toBe(900);
  });

  it('signs and sends SPL token transaction', async () => {
    (getStoredMnemonic as jest.Mock).mockResolvedValue(['test', 'seed']);
    (poolCallSolana as jest.Mock).mockImplementation(async (chain, fn) => {
      if (fn.toString().includes('getBalance')) return 2000000000n;
      if (fn.toString().includes('getLatestBlockhash')) return { blockhash: 'bh', lastValidBlockHeight: 1 };
      if (fn.toString().includes('getAccountInfo')) return null; // forces creation instruction
      if (fn.toString().includes('sendRawTransaction')) return 'txHash2';
    });

    const res = await signAndSendSolanaTransaction({ to: 'valid', value: '1', tokenAddress: 'token123' } as any, 'solana');
    expect(res.hash).toBe('txHash2');
  });
});
