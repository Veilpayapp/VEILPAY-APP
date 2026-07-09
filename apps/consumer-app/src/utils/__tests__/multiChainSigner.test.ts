/**
 * Multi-Chain Signer Tests
 *
 * Covers address validation and signer routing for Solana (SVM) and Stellar (XLM).
 */

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock('tweetnacl', () => ({
  sign: {
    keyPair: {
      fromSeed: () => ({
        publicKey: new Uint8Array(32).fill(0xaa),
        secretKey: new Uint8Array(64).fill(0xbb),
      }),
    },
  },
}));

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  return {
    ...actual,
    keccak256: () => '0x' + Array(64).fill('a').join(''),
    toUtf8Bytes: (str: string) => new TextEncoder().encode(str),
    getBytes: () => new Uint8Array(32).fill(0xcc),
    Mnemonic: {
      fromPhrase: () => ({
        computeSeed: () => 'mockSeed',
      }),
    },
  };
});

jest.mock('@solana/web3.js', () => ({
  PublicKey: class {
    constructor(val: string) {
      return { toBase58: () => val };
    }
  },
  Transaction: class {
    recentBlockhash: string = '';
    feePayer: any;
    add() {
      return this;
    }
    sign() {}
    serialize() {
      return Buffer.from('mock_raw_tx');
    }
  },
  SystemProgram: { transfer: jest.fn() },
  Connection: class {
    getLatestBlockhash() {
      return Promise.resolve({ blockhash: 'mock_blockhash', lastValidBlockHeight: 1234 });
    }
    sendRawTransaction() {
      return Promise.resolve('mock_solana_signature');
    }
  },
  Keypair: {
    fromSeed: () => ({
      publicKey: 'mock_pubkey',
      secretKey: 'mock_secret',
    }),
  },
}));

jest.mock('stellar-sdk', () => ({
  Keypair: {
    fromRawEd25519Seed: () => ({ publicKey: () => 'Gmock_pubkey', sign: () => {} }),
  },
  TransactionBuilder: class {
    constructor() {}
    addOperation() {
      return this;
    }
    addMemo() {
      return this;
    }
    setTimeout() {
      return this;
    }
    build() {
      return { sign: () => {} };
    }
  },
  Operation: { payment: jest.fn() },
  Networks: { PUBLIC: 'public', TESTNET: 'testnet' },
  Asset: { native: () => 'native' },
  Memo: { text: () => 'memo' },
  Account: class {},
  Horizon: {
    Server: class {
      loadAccount() {
        return Promise.resolve({ balances: [{ asset_type: 'native', balance: '10' }] });
      }
      submitTransaction() {
        return Promise.resolve({ hash: 'mock_stellar_hash' });
      }
    },
  },
}));

jest.mock('../transactions', () => ({
  TransactionError: class extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'TransactionError';
      this.code = code;
    }
  },
  getStoredMnemonic: jest.fn(() =>
    Promise.resolve([
      'abandon',
      'abandon',
      'abandon',
      'abandon',
      'abandon',
      'abandon',
      'abandon',
      'abandon',
      'abandon',
      'abandon',
      'abandon',
      'about',
    ])
  ),
}));
jest.mock('../rpc', () => ({ getRpcUrl: (key: string) => `https://mock-rpc-${key}.com` }));

import { isNonEvmChain, signAndSendNonEvmTransaction } from '../multiChainSigner';

describe('multiChainSigner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
  });

  describe('isNonEvmChain', () => {
    it('returns true for Solana', () => {
      expect(isNonEvmChain('solana')).toBe(true);
      expect(isNonEvmChain('solana-devnet')).toBe(true);
    });
    it('returns true for Stellar', () => {
      expect(isNonEvmChain('stellar')).toBe(true);
      expect(isNonEvmChain('stellar-testnet')).toBe(true);
    });
    it('returns false for Aptos (removed) and EVM chains', () => {
      expect(isNonEvmChain('aptos')).toBe(false);
      expect(isNonEvmChain('ethereum')).toBe(false);
      expect(isNonEvmChain('polygon')).toBe(false);
      expect(isNonEvmChain('unknown')).toBe(false);
    });
  });

  describe('signAndSendNonEvmTransaction', () => {
    it('rejects invalid Solana address format', async () => {
      await expect(
        signAndSendNonEvmTransaction({ to: 'not-solana', value: '0.01' }, 'solana')
      ).rejects.toMatchObject({ code: 'INVALID_ADDRESS' });
    });

    it('rejects invalid Stellar address format', async () => {
      await expect(
        signAndSendNonEvmTransaction({ to: 'not-stellar', value: '0.01' }, 'stellar')
      ).rejects.toMatchObject({ code: 'INVALID_ADDRESS' });
    });

    it('throws for unsupported chain (including removed aptos)', async () => {
      await expect(
        signAndSendNonEvmTransaction({ to: '0x1234', value: '0.01' }, 'bitcoin')
      ).rejects.toMatchObject({ code: 'UNKNOWN' });
      await expect(
        signAndSendNonEvmTransaction({ to: '0x1234567890abcdef', value: '0.01' }, 'aptos')
      ).rejects.toMatchObject({ code: 'UNKNOWN' });
    });

    it('throws if no wallet is stored', async () => {
      const { getStoredMnemonic } = require('../transactions');
      (getStoredMnemonic as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        signAndSendNonEvmTransaction(
          { to: '11111111111111111111111111111111', value: '0.01' },
          'solana'
        )
      ).rejects.toMatchObject({ code: 'UNKNOWN' });
    });

    it('rejects invalid amount format on Solana', async () => {
      await expect(
        signAndSendNonEvmTransaction(
          { to: '11111111111111111111111111111111', value: 'invalid' },
          'solana'
        )
      ).rejects.toMatchObject({ code: 'UNKNOWN' });
    });
  });

  describe('Solana transaction flow', () => {
    it('submits a transfer via Solana Web3', async () => {
      const result = await signAndSendNonEvmTransaction(
        { to: '11111111111111111111111111111111', value: '0.01' },
        'solana'
      );
      expect(result.hash).toBe('mock_solana_signature');
    });
  });

  describe('Stellar transaction flow', () => {
    it('submits a transfer via Stellar SDK', async () => {
      const result = await signAndSendNonEvmTransaction(
        { to: 'G' + 'A'.repeat(55), value: '0.01' },
        'stellar'
      );
      expect(result.hash).toBe('mock_stellar_hash');
    });

    it('throws for Stellar with proper error message on network failure', async () => {
      const { Horizon } = require('stellar-sdk');
      jest
        .spyOn(Horizon.Server.prototype, 'loadAccount')
        .mockRejectedValueOnce(new Error('Network error'));

      await expect(
        signAndSendNonEvmTransaction({ to: 'G' + 'A'.repeat(55), value: '0.01' }, 'stellar')
      ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    });

    it('throws for Stellar insufficient funds', async () => {
      const { Horizon } = require('stellar-sdk');
      jest.spyOn(Horizon.Server.prototype, 'loadAccount').mockResolvedValueOnce({
        balances: [{ asset_type: 'native', balance: '0.5' }],
      });

      await expect(
        signAndSendNonEvmTransaction({ to: 'G' + 'A'.repeat(55), value: '1.0' }, 'stellar')
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    });

    it('rejects a send that passes a flat-1-XLM check but violates subentry reserve', async () => {
      const { Horizon } = require('stellar-sdk');
      jest.spyOn(Horizon.Server.prototype, 'loadAccount').mockResolvedValueOnce({
        balances: [{ asset_type: 'native', balance: '3.0' }],
        subentry_count: 4,
      });

      await expect(
        signAndSendNonEvmTransaction({ to: 'G' + 'A'.repeat(55), value: '1.5' }, 'stellar')
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    });
  });
});
