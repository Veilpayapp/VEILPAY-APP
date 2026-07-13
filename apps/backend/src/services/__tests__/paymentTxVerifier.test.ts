import { verifyPaymentTxOnChain } from '../paymentTxVerifier';
import { fetchGoldrushTransactions } from '../goldrush';
import { verifyStellarPayment } from '../stellarHorizon';
import { config } from '../../config';
import { createPublicClient, http } from 'viem';

const mockGetTransaction = jest.fn();
const mockGetTransactionReceipt = jest.fn();
const mockGetBlockNumber = jest.fn();
const mockReadContract = jest.fn();

jest.mock('viem', () => {
  const actual = jest.requireActual('viem');
  return {
    ...actual,
    createPublicClient: jest.fn(() => ({
      getTransaction: mockGetTransaction,
      getTransactionReceipt: mockGetTransactionReceipt,
      getBlockNumber: mockGetBlockNumber,
      readContract: mockReadContract,
    })),
    http: jest.fn((url?: string) => ({ __url: url ?? 'default' })),
  };
});

jest.mock('../goldrush', () => ({
  fetchGoldrushTransactions: jest.fn(),
  GoldrushError: class GoldrushError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'GoldrushError';
    }
  },
}));

jest.mock('../stellarHorizon', () => ({
  verifyStellarPayment: jest.fn(),
  StellarHorizonError: class StellarHorizonError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'StellarHorizonError';
    }
  },
}));

const PAY_TO = '0xPaymentAddress000000000000000000000001';
const FROM = '0xFromAddress00000000000000000000000002';
const TX_HASH = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

// Canonical mainnet USDC (matches tokenRegistry)
const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

function makeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    chainKey: 'ethereum',
    tokenSymbol: 'ETH',
    amount: '1.0',
    paymentAddress: PAY_TO,
    tokenAddress: null as string | null,
    ...overrides,
  };
}

function makeClaimed(overrides: Record<string, unknown> = {}) {
  return {
    txHash: TX_HASH,
    fromAddress: FROM,
    toAddress: PAY_TO,
    amount: '1.0',
    tokenSymbol: 'ETH',
    ...overrides,
  };
}

describe('verifyPaymentTxOnChain (SEC-001 residual / Pass B)', () => {
  const originalMinConf = config.paymentMinConfirmations;
  const originalGoldrush = config.rpc.goldrushApiKey;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetBlockNumber.mockResolvedValue(1000n);
    // Happy-path tests assume enough confirmations vs block 10/42/55.
    config.paymentMinConfirmations = 1;
    config.rpc.goldrushApiKey = originalGoldrush;
  });

  afterAll(() => {
    config.paymentMinConfirmations = originalMinConf;
    config.rpc.goldrushApiKey = originalGoldrush;
  });

  it('rejects when invoice has no payment address', async () => {
    const r = await verifyPaymentTxOnChain(
      makeInvoice({ paymentAddress: null }),
      makeClaimed()
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.error).toMatch(/payment address/i);
    }
  });

  it('rejects claimed amount mismatch vs invoice', async () => {
    const r = await verifyPaymentTxOnChain(makeInvoice(), makeClaimed({ amount: '9.9' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/amount/i);
  });

  it('rejects toAddress mismatch vs invoice payment address', async () => {
    const r = await verifyPaymentTxOnChain(
      makeInvoice(),
      makeClaimed({ toAddress: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/toAddress|payment address/i);
  });

  it('EVM: rejects failed or missing receipt (fake txHash)', async () => {
    mockGetTransaction.mockResolvedValue({
      from: FROM,
      to: PAY_TO,
      value: 10n ** 18n,
    });
    mockGetTransactionReceipt.mockResolvedValue({ status: 'reverted', blockNumber: 10n });

    const r = await verifyPaymentTxOnChain(makeInvoice(), makeClaimed());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.error).toMatch(/failed or not found/i);
    }
  });

  it('EVM: rejects recipient mismatch on-chain', async () => {
    mockGetTransaction.mockResolvedValue({
      from: FROM,
      to: '0xOtherRecipient0000000000000000000000001',
      value: 10n ** 18n,
    });
    mockGetTransactionReceipt.mockResolvedValue({ status: 'success', blockNumber: 10n });

    const r = await verifyPaymentTxOnChain(makeInvoice(), makeClaimed());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/recipient/i);
  });

  it('EVM: rejects underpaid native value', async () => {
    mockGetTransaction.mockResolvedValue({
      from: FROM,
      to: PAY_TO,
      value: 10n ** 15n, // 0.001 ETH
    });
    mockGetTransactionReceipt.mockResolvedValue({ status: 'success', blockNumber: 10n });

    const r = await verifyPaymentTxOnChain(makeInvoice(), makeClaimed());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/value|amount/i);
  });

  it('EVM: happy path returns chain-derived PaymentTxInput', async () => {
    mockGetTransaction.mockResolvedValue({
      from: FROM,
      to: PAY_TO,
      value: 10n ** 18n,
    });
    mockGetTransactionReceipt.mockResolvedValue({ status: 'success', blockNumber: 42n });

    const r = await verifyPaymentTxOnChain(makeInvoice(), makeClaimed());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tx.txHash).toBe(TX_HASH);
      expect(r.tx.fromAddress).toBe(FROM);
      expect(r.tx.toAddress.toLowerCase()).toBe(PAY_TO.toLowerCase());
      expect(r.tx.blockNumber).toBe(42);
      expect(r.tx.tokenSymbol).toBe('ETH');
    }
  });

  it('EVM: routes base/optimism/bsc as EVM (not Goldrush)', async () => {
    mockGetTransaction.mockResolvedValue({
      from: FROM,
      to: PAY_TO,
      value: 10n ** 18n,
    });
    mockGetTransactionReceipt.mockResolvedValue({ status: 'success', blockNumber: 42n });

    for (const chainKey of ['base', 'optimism', 'bsc'] as const) {
      const r = await verifyPaymentTxOnChain(
        makeInvoice({ chainKey, tokenSymbol: 'ETH' }),
        makeClaimed({ tokenSymbol: 'ETH' })
      );
      expect(r.ok).toBe(true);
      expect(fetchGoldrushTransactions).not.toHaveBeenCalled();
    }
  });

  it('EVM: rejects when confirmations are below floor', async () => {
    config.paymentMinConfirmations = 12;
    mockGetTransaction.mockResolvedValue({
      from: FROM,
      to: PAY_TO,
      value: 10n ** 18n,
    });
    mockGetTransactionReceipt.mockResolvedValue({ status: 'success', blockNumber: 995n });
    mockGetBlockNumber.mockResolvedValue(1000n); // 6 confirmations

    const r = await verifyPaymentTxOnChain(makeInvoice(), makeClaimed());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/confirmation/i);
  });

  describe('EVM ERC-20 (token contract identity)', () => {
    const PAY_ERC20 = '0x1111111111111111111111111111111111111111';
    const SENDER = '0x3333333333333333333333333333333333333333';
    const SPOOF_TOKEN = '0x2222222222222222222222222222222222222222';

    function topicAddr(addr: string): string {
      return '0x' + '0'.repeat(24) + addr.slice(2).toLowerCase();
    }

    function usdcInvoice(overrides: Record<string, unknown> = {}) {
      return makeInvoice({
        tokenSymbol: 'USDC',
        amount: '100',
        paymentAddress: PAY_ERC20,
        tokenAddress: USDC_ETH,
        ...overrides,
      });
    }

    function transferLog(token: string, to: string, amountBaseUnits: bigint) {
      return {
        address: token,
        topics: [
          '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
          topicAddr(SENDER),
          topicAddr(to),
        ],
        data: '0x' + amountBaseUnits.toString(16).padStart(64, '0'),
      };
    }

    beforeEach(() => {
      mockGetTransaction.mockResolvedValue({ from: SENDER, to: USDC_ETH, value: 0n });
      mockReadContract.mockImplementation(({ functionName }: { functionName: string }) =>
        functionName === 'decimals' ? Promise.resolve(6) : Promise.resolve('USDC')
      );
    });

    it('accepts a matching ERC-20 transfer from the expected token contract', async () => {
      mockGetTransactionReceipt.mockResolvedValue({
        status: 'success',
        blockNumber: 55n,
        logs: [transferLog(USDC_ETH, PAY_ERC20, 100_000000n)],
      });

      const r = await verifyPaymentTxOnChain(
        usdcInvoice(),
        makeClaimed({ tokenSymbol: 'USDC', amount: '100', toAddress: PAY_ERC20 })
      );
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.tx.tokenSymbol).toBe('USDC');
        expect(r.tx.amount).toBe('100');
        expect(r.tx.blockNumber).toBe(55);
        expect(r.tx.toAddress.toLowerCase()).toBe(PAY_ERC20);
      }
    });

    it('rejects a spoof token that only matches the symbol string', async () => {
      mockGetTransactionReceipt.mockResolvedValue({
        status: 'success',
        blockNumber: 55n,
        logs: [transferLog(SPOOF_TOKEN, PAY_ERC20, 100_000000n)],
      });
      // Spoof contract still claims symbol USDC
      mockReadContract.mockImplementation(({ functionName }: { functionName: string }) =>
        functionName === 'decimals' ? Promise.resolve(6) : Promise.resolve('USDC')
      );

      const r = await verifyPaymentTxOnChain(
        usdcInvoice(),
        makeClaimed({ tokenSymbol: 'USDC', amount: '100', toAddress: PAY_ERC20 })
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/expected token contract|no erc-20 transfer/i);
    });

    it('sums multiple credits from the expected token contract', async () => {
      mockGetTransactionReceipt.mockResolvedValue({
        status: 'success',
        blockNumber: 55n,
        logs: [
          transferLog(USDC_ETH, PAY_ERC20, 40_000000n),
          transferLog(USDC_ETH, PAY_ERC20, 60_000000n),
        ],
      });

      const r = await verifyPaymentTxOnChain(
        usdcInvoice(),
        makeClaimed({ tokenSymbol: 'USDC', amount: '100', toAddress: PAY_ERC20 })
      );
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.tx.amount).toBe('100');
    });

    it('rejects an underpaid ERC-20 transfer even across multiple logs', async () => {
      mockGetTransactionReceipt.mockResolvedValue({
        status: 'success',
        blockNumber: 55n,
        logs: [
          transferLog(USDC_ETH, PAY_ERC20, 30_000000n),
          transferLog(USDC_ETH, PAY_ERC20, 20_000000n),
        ],
      });

      const r = await verifyPaymentTxOnChain(
        usdcInvoice(),
        makeClaimed({ tokenSymbol: 'USDC', amount: '100', toAddress: PAY_ERC20 })
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/less than invoice/i);
    });

    it('rejects when the only transfer credits a different address', async () => {
      const OTHER = '0x4444444444444444444444444444444444444444';
      mockGetTransactionReceipt.mockResolvedValue({
        status: 'success',
        blockNumber: 55n,
        logs: [transferLog(USDC_ETH, OTHER, 100_000000n)],
      });

      const r = await verifyPaymentTxOnChain(
        usdcInvoice(),
        makeClaimed({ tokenSymbol: 'USDC', amount: '100', toAddress: PAY_ERC20 })
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/no erc-20 transfer/i);
    });

    it('rejects when invoice has no tokenAddress and symbol is not registered', async () => {
      const r = await verifyPaymentTxOnChain(
        usdcInvoice({ tokenSymbol: 'FAKECOIN', tokenAddress: null }),
        makeClaimed({ tokenSymbol: 'FAKECOIN', amount: '100', toAddress: PAY_ERC20 })
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/tokenAddress|registry/i);
    });
  });

  it('non-EVM: rejects when GOLDRUSH_API_KEY is unset', async () => {
    config.rpc.goldrushApiKey = '';
    const r = await verifyPaymentTxOnChain(
      makeInvoice({ chainKey: 'solana', tokenSymbol: 'USDC', amount: '100' }),
      makeClaimed({
        amount: '100',
        tokenSymbol: 'USDC',
        txHash: '5' + 'a'.repeat(63),
      })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/GOLDRUSH_API_KEY|unavailable/i);
    expect(fetchGoldrushTransactions).not.toHaveBeenCalled();
  });

  it('non-EVM: rejects when Goldrush has no matching txHash', async () => {
    config.rpc.goldrushApiKey = 'test-key';
    (fetchGoldrushTransactions as jest.Mock).mockResolvedValue([]);
    const r = await verifyPaymentTxOnChain(
      makeInvoice({ chainKey: 'solana', tokenSymbol: 'USDC', amount: '100' }),
      makeClaimed({
        amount: '100',
        tokenSymbol: 'USDC',
        txHash: '5' + 'a'.repeat(63),
      })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not found|Goldrush|indexer/i);
  });

  it('non-EVM: accepts matching Goldrush tx', async () => {
    config.rpc.goldrushApiKey = 'test-key';
    const hash = 'SolTxHashAbc1234567890xyzABCDEFGHIJKLMNOP';
    (fetchGoldrushTransactions as jest.Mock).mockResolvedValue([
      {
        txHash: hash,
        fromAddress: 'sol-from',
        toAddress: PAY_TO,
        amount: '100',
        tokenSymbol: 'USDC',
        blockNumber: 9,
      },
    ]);

    const r = await verifyPaymentTxOnChain(
      makeInvoice({ chainKey: 'solana', tokenSymbol: 'USDC', amount: '100' }),
      makeClaimed({
        txHash: hash,
        amount: '100',
        tokenSymbol: 'USDC',
        fromAddress: 'sol-from',
        toAddress: PAY_TO,
      })
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tx.txHash).toBe(hash);
      expect(r.tx.amount).toBe('100');
      expect(r.tx.blockNumber).toBe(9);
    }
  });

  it('EVM: wires createPublicClient with a configured HTTP RPC URL', async () => {
    mockGetTransaction.mockResolvedValue({
      from: FROM,
      to: PAY_TO,
      value: 10n ** 18n,
    });
    mockGetTransactionReceipt.mockResolvedValue({ status: 'success', blockNumber: 42n });
    mockGetBlockNumber.mockResolvedValue(1000n);

    await verifyPaymentTxOnChain(makeInvoice(), makeClaimed());
    expect(http).toHaveBeenCalled();
    const urlArg = (http as jest.Mock).mock.calls[0]?.[0];
    expect(typeof urlArg).toBe('string');
    expect(urlArg.length).toBeGreaterThan(0);
    expect(createPublicClient).toHaveBeenCalled();
  });

  it('Stellar: routes to Horizon verifier (not GoldRush)', async () => {
    const hash = 'a'.repeat(64);
    (verifyStellarPayment as jest.Mock).mockResolvedValue({
      ok: true,
      tx: {
        txHash: hash,
        fromAddress: 'GFROM',
        toAddress: PAY_TO,
        amount: '5',
        tokenSymbol: 'XLM',
        blockNumber: 0,
      },
    });

    const r = await verifyPaymentTxOnChain(
      makeInvoice({ chainKey: 'stellar', tokenSymbol: 'XLM', amount: '5' }),
      makeClaimed({
        txHash: hash,
        amount: '5',
        tokenSymbol: 'XLM',
        fromAddress: 'GFROM',
        toAddress: PAY_TO,
      })
    );
    expect(r.ok).toBe(true);
    expect(verifyStellarPayment).toHaveBeenCalled();
    expect(fetchGoldrushTransactions).not.toHaveBeenCalled();
  });
});
