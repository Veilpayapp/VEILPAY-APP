import { fetchEvmHistory, fetchSolanaHistory, fetchStellarHistory } from '../publicIndexers';

// Mock dependencies
jest.mock('@solana/web3.js', () => ({
  Connection: class {
    getSignaturesForAddress = jest.fn().mockResolvedValue([{ signature: 'sig1' }]);
    getParsedTransactions = jest.fn().mockResolvedValue([
      {
        meta: { preBalances: [1000000], postBalances: [500000], err: null, fee: 5000 },
        transaction: { message: { accountKeys: [{ pubkey: { toBase58: () => 'address1' } }, { pubkey: { toBase58: () => 'address2' } }] } },
        blockTime: 1600000000
      }
    ]);
  },
  PublicKey: class {
    val: string;
    constructor(val: string) { this.val = val; }
    toBase58() { return this.val; }
  }
}));

describe('publicIndexers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchEvmHistory', () => {
    it('fetches and formats EVM history successfully', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        json: jest.fn().mockResolvedValue({
          status: '1',
          message: 'OK',
          result: [
            {
              hash: '0x123',
              from: '0xabc',
              to: '0xdef',
              value: '1000000000000000000', // 1 ETH
              timeStamp: '1600000000',
              isError: '0',
              gasUsed: '21000',
              gasPrice: '1000000000'
            }
          ]
        })
      });

      const res = await fetchEvmHistory('0xabc', 'ethereum', undefined, 10);
      expect(res.transactions.length).toBe(1);
      expect(res.transactions[0].type).toBe('sent');
      expect(res.transactions[0].amount).toBe('1');
    });

    it('returns empty array if API errors', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('API Down'));
      const res = await fetchEvmHistory('0xabc', 'ethereum', undefined, 10);
      expect(res.transactions).toEqual([]);
    });
  });

  describe('fetchSolanaHistory', () => {
    it('fetches and formats Solana history successfully', async () => {
      const res = await fetchSolanaHistory('address1', 'solana', undefined, 10);
      expect(res.transactions.length).toBe(1);
      expect(res.transactions[0].type).toBe('sent');
      expect(res.transactions[0].amount).toBe('0.0005'); // 500000 lamports = 0.0005 SOL
    });
  });

  describe('fetchStellarHistory', () => {
    it('fetches and formats Stellar history successfully', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          _embedded: {
            records: [
              {
                id: '123',
                type: 'payment',
                from: 'GABC',
                to: 'GDEF',
                amount: '10.5',
                asset_type: 'native',
                created_at: '2023-01-01T00:00:00Z',
                transaction_hash: 'hash123'
              }
            ]
          }
        })
      });

      const res = await fetchStellarHistory('GABC', 'stellar', undefined, 10);
      expect(res.transactions.length).toBe(1);
      expect(res.transactions[0].type).toBe('sent');
      expect(res.transactions[0].amount).toBe('10.5');
    });

    it('returns empty array on error', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
      const res = await fetchStellarHistory('GABC', 'stellar', undefined, 10);
      expect(res.transactions).toEqual([]);
    });
  });
});
