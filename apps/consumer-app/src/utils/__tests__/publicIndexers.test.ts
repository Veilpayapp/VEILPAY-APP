import {
  fetchEvmHistory,
  fetchSolanaHistory,
  fetchStellarHistory,
  getSppPublicContractRole,
  isAspMembershipOperation,
  isSppAspTreeOperation,
  isSppInfrastructureOperation,
  mapStellarOperationToTransaction,
} from '../publicIndexers';
import { SPP_TESTNET } from '../../constants/spp';

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
                transaction_hash: 'hash123',
                paging_token: '123',
              },
            ],
          },
        }),
      });

      const res = await fetchStellarHistory('GABC', 'stellar', undefined, 10);
      expect(res.transactions.length).toBe(1);
      expect(res.transactions[0].type).toBe('sent');
      expect(res.transactions[0].amount).toBe('10.5');
    });

    it('skips noise + ASP trees; keeps Freighter-style SPP pool, valued contracts, payments', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          _embedded: {
            records: [
              {
                id: 'noise1',
                type: 'change_trust',
                source_account: 'GABC',
                created_at: '2023-01-03T00:00:00Z',
                transaction_hash: 'h0',
                paging_token: '1',
              },
              {
                id: 'asp-leaf',
                type: 'invoke_host_function',
                source_account: 'GABC',
                created_at: '2023-01-03T12:00:00Z',
                transaction_hash: 'hasp',
                paging_token: '1.5',
                contract_id: SPP_TESTNET.aspMembershipId,
              },
              {
                id: 'pool-inv',
                type: 'invoke_host_function',
                source_account: 'GABC',
                created_at: '2023-01-02T12:00:00Z',
                transaction_hash: 'hpool',
                paging_token: '1.7',
                // SPP pool — public Freighter-style contract row
                contract_id: SPP_TESTNET.poolId,
                asset_balance_changes: [{ amount: '50', asset_type: 'native', from: 'GABC' }],
              },
              {
                id: 'zero-inv',
                type: 'invoke_host_function',
                source_account: 'GABC',
                created_at: '2023-01-02T06:00:00Z',
                transaction_hash: 'hzero',
                paging_token: '1.8',
                // Non-SPP but no amount — hide "Contract / -0 XLM" spam
                contract_id: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHV4A',
              },
              {
                id: 'valued-inv',
                type: 'invoke_host_function',
                source_account: 'GABC',
                created_at: '2023-01-02T00:00:00Z',
                transaction_hash: 'h1',
                paging_token: '2',
                contract_id: 'CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXAAA',
                asset_balance_changes: [{ amount: '3', asset_type: 'native', from: 'GABC' }],
              },
              {
                id: 'path1',
                type: 'path_payment_strict_send',
                from: 'GABC',
                to: 'GDEF',
                amount: '5',
                asset_type: 'native',
                created_at: '2023-01-01T00:00:00Z',
                transaction_hash: 'h2',
                paging_token: '3',
              },
              {
                id: 'pay1',
                type: 'payment',
                from: 'GXYZ',
                to: 'GABC',
                amount: '100',
                asset_type: 'native',
                created_at: '2022-12-01T00:00:00Z',
                transaction_hash: 'h3',
                paging_token: '4',
              },
            ],
          },
        }),
      });

      const res = await fetchStellarHistory('GABC', 'stellar-testnet', undefined, 10);
      expect(res.transactions.map((t) => t.id)).toEqual([
        'pool-inv',
        'valued-inv',
        'path1',
        'pay1',
      ]);
      expect(res.transactions[0].displayTitle).toBe('Contract');
      expect(res.transactions[0].displaySubtitle).toMatch(/SPP pool/);
      expect(res.transactions[0].amount).toBe('50');
      expect(res.transactions[0].privacyLevel).toBe('standard');
      expect(res.transactions[1].displayTitle).toBe('Contract');
      expect(res.transactions[1].amount).toBe('3');
      expect(res.transactions[2].displayTitle).toBe('Path payment');
      expect(res.transactions[3].type).toBe('received');
      expect(res.transactions[3].amount).toBe('100');
    });

    it('maps SPP pool/verifier/registry Freighter-style; hides ASP trees and zero non-SPP', () => {
      const aspOp = {
        id: 'a1',
        type: 'invoke_host_function',
        source_account: 'GABC',
        created_at: '2023-01-01T00:00:00Z',
        transaction_hash: 'txasp',
        contract_id: SPP_TESTNET.aspMembershipId,
      };
      const poolOp = {
        id: 'p1',
        type: 'invoke_host_function',
        source_account: 'GABC',
        created_at: '2023-01-01T00:00:00Z',
        transaction_hash: 'txpool',
        contract_id: SPP_TESTNET.poolId,
        asset_balance_changes: [{ amount: '50', asset_type: 'native', from: 'GABC' }],
      };
      const poolZeroOp = {
        id: 'p0',
        type: 'invoke_host_function',
        source_account: 'GABC',
        created_at: '2023-01-01T00:00:00Z',
        transaction_hash: 'txpool0',
        contract_id: SPP_TESTNET.poolId,
      };
      const zeroOp = {
        id: 'z1',
        type: 'invoke_host_function',
        source_account: 'GABC',
        created_at: '2023-01-01T00:00:00Z',
        transaction_hash: 'txzero',
        contract_id: 'CYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYAAA',
      };

      expect(isAspMembershipOperation(aspOp, 'stellar-testnet')).toBe(true);
      expect(isSppAspTreeOperation(aspOp, 'stellar-testnet')).toBe(true);
      expect(isSppInfrastructureOperation(poolOp, 'stellar-testnet')).toBe(true);
      expect(isSppInfrastructureOperation(aspOp, 'stellar-testnet')).toBe(true);
      expect(getSppPublicContractRole(poolOp, 'stellar-testnet')).toBe('pool');
      expect(mapStellarOperationToTransaction(aspOp, 'GABC', 'stellar-testnet')).toBeNull();
      const mappedPool = mapStellarOperationToTransaction(poolOp, 'GABC', 'stellar-testnet');
      expect(mappedPool).not.toBeNull();
      expect(mappedPool?.displayTitle).toBe('Contract');
      expect(mappedPool?.displaySubtitle).toMatch(/SPP pool/);
      expect(mappedPool?.amount).toBe('50');
      expect(mappedPool?.privacyLevel).toBe('standard');
      // Proof-only pool invoke with no balance change still surfaces (Freighter-style).
      const mappedZeroPool = mapStellarOperationToTransaction(poolZeroOp, 'GABC', 'stellar-testnet');
      expect(mappedZeroPool).not.toBeNull();
      expect(mappedZeroPool?.amount).toBe('0');
      expect(mapStellarOperationToTransaction(zeroOp, 'GABC', 'stellar-testnet')).toBeNull();
    });

    it('pages past filtered-out ops until it fills the limit', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            _embedded: {
              // Full page of noise only — would previously yield empty home list
              records: Array.from({ length: 50 }, (_, i) => ({
                id: `noise-${i}`,
                type: 'change_trust',
                source_account: 'GABC',
                created_at: '2023-06-01T00:00:00Z',
                transaction_hash: `hn-${i}`,
                paging_token: `p${i}`,
              })),
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            _embedded: {
              records: [
                {
                  id: 'real-pay',
                  type: 'payment',
                  from: 'GABC',
                  to: 'GDEF',
                  amount: '2',
                  asset_type: 'native',
                  created_at: '2023-01-01T00:00:00Z',
                  transaction_hash: 'hpay',
                  paging_token: 'end',
                },
              ],
            },
          }),
        });

      const res = await fetchStellarHistory('GABC', 'stellar-testnet', undefined, 5);
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(res.transactions).toHaveLength(1);
      expect(res.transactions[0].id).toBe('real-pay');
    });

    it('returns empty array on error', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
      const res = await fetchStellarHistory('GABC', 'stellar', undefined, 10);
      expect(res.transactions).toEqual([]);
    });
  });
});
