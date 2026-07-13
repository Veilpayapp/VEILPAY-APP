import {
  baseUnitsToHuman,
  fetchGoldrushTransactions,
  GoldrushError,
  addressesEqual,
  nativeSymbolForChain,
} from '../goldrush';
import { config } from '../../config';

jest.mock('../../config', () => ({
  config: {
    rpc: {
      goldrushApiKey: 'test-api-key',
    },
  },
}));

describe('goldrush helpers', () => {
  it('baseUnitsToHuman converts USDC 6-decimal base units', () => {
    expect(baseUnitsToHuman('100000000', 6)).toBe('100');
    expect(baseUnitsToHuman('1500000', 6)).toBe('1.5');
    expect(baseUnitsToHuman('1', 6)).toBe('0.000001');
  });

  it('baseUnitsToHuman leaves already-human amounts alone', () => {
    expect(baseUnitsToHuman('1.5', 6)).toBe('1.5');
    expect(baseUnitsToHuman('100', 0)).toBe('100');
  });

  it('nativeSymbolForChain maps known chains', () => {
    expect(nativeSymbolForChain('solana')).toBe('SOL');
    expect(nativeSymbolForChain('stellar')).toBe('XLM');
    expect(nativeSymbolForChain('ethereum')).toBe('ETH');
  });

  it('addressesEqual is case-insensitive', () => {
    expect(addressesEqual('0xAbC', '0xabc')).toBe(true);
    expect(addressesEqual('addr1', 'ADDR1')).toBe(true);
    expect(addressesEqual('a', 'b')).toBe(false);
  });
});

describe('fetchGoldrushTransactions', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    (config.rpc as { goldrushApiKey?: string }).goldrushApiKey = 'test-api-key';
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it('returns empty when API key is missing', async () => {
    (config.rpc as { goldrushApiKey?: string }).goldrushApiKey = '';
    const result = await fetchGoldrushTransactions('solana', 'addr');
    expect(result).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('throws GoldrushError for unsupported chains (e.g. stellar)', async () => {
    await expect(fetchGoldrushTransactions('stellar', 'G...')).rejects.toBeInstanceOf(
      GoldrushError
    );
  });

  it('emits only Transfer credits to the watched address with human amounts', async () => {
    const watched = '0xPayment';
    const other = '0xOther';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          items: [
            {
              tx_hash: '0xabc',
              from_address: '0xPayer',
              to_address: watched,
              block_height: 12,
              successful: true,
              log_events: [
                {
                  sender_address: '0xUSDC',
                  sender_contract_ticker_symbol: 'USDC',
                  sender_contract_decimals: 6,
                  decoded: {
                    name: 'Transfer',
                    params: [
                      { name: 'from', value: '0xPayer' },
                      { name: 'to', value: other },
                      { name: 'value', value: '100000000' },
                    ],
                  },
                },
                {
                  sender_address: '0xUSDC',
                  sender_contract_ticker_symbol: 'USDC',
                  sender_contract_decimals: 6,
                  decoded: {
                    name: 'Transfer',
                    params: [
                      { name: 'from', value: '0xPayer' },
                      { name: 'to', value: watched },
                      { name: 'value', value: '100000000' },
                    ],
                  },
                },
              ],
            },
          ],
        },
      }),
    });

    const rows = await fetchGoldrushTransactions('ethereum', watched);
    expect(rows).toHaveLength(1);
    expect(rows[0].toAddress).toBe(watched);
    expect(rows[0].amount).toBe('100');
    expect(rows[0].tokenSymbol).toBe('USDC');
    expect(rows[0].tokenAddress).toBe('0xUSDC');
  });

  it('converts native SOL lamports and uses SOL symbol', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          items: [
            {
              tx_hash: 'soltx1',
              from_address: 'payer',
              to_address: 'recv',
              value: '1500000000', // 1.5 SOL
              block_height: 99,
              successful: true,
            },
          ],
        },
      }),
    });

    const rows = await fetchGoldrushTransactions('solana', 'recv');
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe('1.5');
    expect(rows[0].tokenSymbol).toBe('SOL');
  });

  it('skips native transfers not to the watched address', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          items: [
            {
              tx_hash: 'soltx2',
              from_address: 'payer',
              to_address: 'other',
              value: '1000000000',
              block_height: 1,
              successful: true,
            },
          ],
        },
      }),
    });

    const rows = await fetchGoldrushTransactions('solana', 'recv');
    expect(rows).toHaveLength(0);
  });
});
