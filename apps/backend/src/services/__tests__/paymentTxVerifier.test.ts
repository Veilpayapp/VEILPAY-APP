import { verifyPaymentTxOnChain } from '../paymentTxVerifier';
import { fetchGoldrushTransactions } from '../goldrush';

const mockGetTransaction = jest.fn();
const mockGetTransactionReceipt = jest.fn();
const mockGetBlockNumber = jest.fn();

jest.mock('viem', () => {
  const actual = jest.requireActual('viem');
  return {
    ...actual,
    createPublicClient: jest.fn(() => ({
      getTransaction: mockGetTransaction,
      getTransactionReceipt: mockGetTransactionReceipt,
      getBlockNumber: mockGetBlockNumber,
    })),
  };
});

jest.mock('../goldrush', () => ({
  fetchGoldrushTransactions: jest.fn(),
}));

const PAY_TO = '0xPaymentAddress000000000000000000000001';
const FROM = '0xFromAddress00000000000000000000000002';
const TX_HASH = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

function makeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    chainKey: 'ethereum',
    tokenSymbol: 'ETH',
    amount: '1.0',
    paymentAddress: PAY_TO,
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

describe('verifyPaymentTxOnChain (SEC-001 residual)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetBlockNumber.mockResolvedValue(1000n);
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

  it('non-EVM: rejects when Goldrush has no matching txHash', async () => {
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
});
