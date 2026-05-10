jest.mock('../rpcPool', () => ({
  poolCall: jest.fn(),
}));

jest.mock('../sentry', () => ({
  captureError: jest.fn(),
}));

const { ethers } = require('ethers');
const { poolCall } = require('../rpcPool');
const {
  estimateTransactionGas,
  clearGasCache,
  isGasExpensive,
} = require('../gasEstimator');

const mockProvider = {
  getFeeData: jest.fn(),
  estimateGas: jest.fn(),
};

describe('gasEstimator', () => {
  beforeEach(() => {
    clearGasCache();
    jest.clearAllMocks();
    (poolCall as jest.Mock).mockImplementation(async (_chainKey: string, fn: (provider: unknown) => Promise<unknown>) => {
      return fn(mockProvider as never);
    });
  });

  it('uses live fee data and buffers the gas estimate', async () => {
    mockProvider.getFeeData.mockResolvedValue({
      maxFeePerGas: 10_000_000_000n,
      maxPriorityFeePerGas: 2_000_000_000n,
      gasPrice: 8_000_000_000n,
    });
    mockProvider.estimateGas.mockResolvedValue(21_000n);

    const estimate = await estimateTransactionGas(
      { to: '0x1111111111111111111111111111111111111111', value: '1', from: '0x2222222222222222222222222222222222222222' },
      'ethereum',
      3200
    );

    expect(mockProvider.getFeeData).toHaveBeenCalledTimes(1);
    expect(mockProvider.estimateGas).toHaveBeenCalledTimes(1);
    expect(estimate.gasLimit).toBe(24_150n);
    expect(estimate.maxFeePerGas).toBe(11_500_000_000n);
    expect(estimate.maxPriorityFeePerGas).toBe(2_300_000_000n);
    expect(estimate.isStale).toBe(false);
    expect(estimate.estimatedCostEth).toBe(ethers.formatEther(24_150n * 11_500_000_000n));
    expect(estimate.estimatedCostUsd).toBeDefined();
  });

  it('returns cached estimates for identical requests', async () => {
    mockProvider.getFeeData.mockResolvedValue({
      maxFeePerGas: 10_000_000_000n,
      maxPriorityFeePerGas: 2_000_000_000n,
      gasPrice: 8_000_000_000n,
    });
    mockProvider.estimateGas.mockResolvedValue(21_000n);

    const firstEstimate = await estimateTransactionGas(
      { to: '0x1111111111111111111111111111111111111111', value: '1', from: '0x2222222222222222222222222222222222222222' },
      'ethereum',
      3000
    );

    const secondEstimate = await estimateTransactionGas(
      { to: '0x1111111111111111111111111111111111111111', value: '1', from: '0x2222222222222222222222222222222222222222' },
      'ethereum',
      3200
    );

    expect(poolCall).toHaveBeenCalledTimes(2);
    expect(mockProvider.getFeeData).toHaveBeenCalledTimes(1);
    expect(mockProvider.estimateGas).toHaveBeenCalledTimes(1);
    expect(firstEstimate.gasLimit).toEqual(secondEstimate.gasLimit);
    expect(secondEstimate.estimatedCostUsd).toBe('0.8887');
  });

  it('falls back to conservative static estimates when live estimation fails', async () => {
    (poolCall as jest.Mock).mockImplementation(async () => {
      throw new Error('rpc unavailable');
    });

    const estimate = await estimateTransactionGas(
      { to: '0x1111111111111111111111111111111111111111', value: '1', from: '0x2222222222222222222222222222222222222222' },
      'sepolia',
      3200
    );

    expect(estimate.isStale).toBe(true);
    expect(estimate.gasLimit).toBe(21_000n);
    expect(estimate.maxFeePerGas).toBe(10_000_000_000n);
    expect(estimate.estimatedCostUsd).toBeDefined();
  });

  it('flags expensive gas estimates above the threshold', () => {
    expect(
      isGasExpensive({
        gasLimit: 21_000n,
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
        gasPrice: 1n,
        estimatedCostWei: 1n,
        estimatedCostEth: '0.1',
        estimatedCostUsd: '12.50',
        isStale: false,
        fetchedAt: Date.now(),
      })
    ).toBe(true);

    expect(
      isGasExpensive({
        gasLimit: 21_000n,
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
        gasPrice: 1n,
        estimatedCostWei: 1n,
        estimatedCostEth: '0.1',
        estimatedCostUsd: '9.99',
        isStale: false,
        fetchedAt: Date.now(),
      })
    ).toBe(false);
  });
});
