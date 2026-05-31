// Comprehensive tests for the EVMIndexer, SolanaIndexer, AptosIndexer, and runIndexers

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { EVMIndexer, SolanaIndexer, AptosIndexer, runIndexers, IndexedEvent } from '../index';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../lib/prisma', () => ({
  prisma: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    $transaction: jest.fn((cb: any) => cb(prisma)),
    processedBlock: { findUnique: jest.fn(), upsert: jest.fn() },
    payment: { findUnique: jest.fn(), create: jest.fn() },
    invoice: { findFirst: jest.fn(), update: jest.fn() },
    chainViewingKey: { findFirst: jest.fn() },
  },
}));

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();
jest.mock('../../lib/redis', () => ({
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument
  redis: { get: (...args: any[]) => mockRedisGet(...args), set: (...args: any[]) => mockRedisSet(...args) },
}));

import { prisma } from '../../lib/prisma';
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
const mockPrisma = prisma as any;

const mockGetBlockNumber = jest.fn();
const mockQueryFilter = jest.fn();

jest.mock('ethers', () => ({
  JsonRpcProvider: jest.fn().mockImplementation(() => ({
    getBlockNumber: mockGetBlockNumber,
  })),
  Contract: jest.fn().mockImplementation(() => ({
    filters: {
      NewCommitment: jest.fn().mockReturnValue('commitmentFilter'),
      Withdrawal: jest.fn().mockReturnValue('withdrawalFilter'),
    },
    queryFilter: mockQueryFilter,
  })),
}));

jest.mock('../../config', () => ({
  config: { indexSolana: false, indexAptos: false },
}));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('EVMIndexer', () => {
  let indexer: EVMIndexer;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.POOL_SEPOLIA = '0xPoolAddress1234';
    indexer = new EVMIndexer('sepolia');
  });

  afterEach(() => {
    delete process.env.POOL_SEPOLIA;
  });

  describe('constructor', () => {
    it('throws when chain key has no RPC endpoint', () => {
      expect(() => new EVMIndexer('unknown-chain')).toThrow('No RPC endpoint for chain: unknown-chain');
    });

    it('constructs for known chains without throwing', () => {
      expect(() => new EVMIndexer('ethereum')).not.toThrow();
      expect(() => new EVMIndexer('polygon')).not.toThrow();
      expect(() => new EVMIndexer('arbitrum')).not.toThrow();
    });
  });

  describe('getLastProcessedBlock', () => {
    it('returns cached value from Redis', async () => {
      mockRedisGet.mockResolvedValue('12345');
      const block = await indexer.getLastProcessedBlock();
      expect(block).toBe(12345);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(mockPrisma.processedBlock.findUnique).not.toHaveBeenCalled();
    });

    it('falls back to Prisma when Redis cache misses', async () => {
      mockRedisGet.mockResolvedValue(null);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      mockPrisma.processedBlock.findUnique.mockResolvedValue({ blockNumber: BigInt(99999) });
      const block = await indexer.getLastProcessedBlock();
      expect(block).toBe(99999);
      expect(mockRedisSet).toHaveBeenCalledWith('veilpay:block:sepolia', '99999');
    });

    it('returns 0 when no block found in Prisma', async () => {
      mockRedisGet.mockResolvedValue(null);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      mockPrisma.processedBlock.findUnique.mockResolvedValue(null);
      const block = await indexer.getLastProcessedBlock();
      expect(block).toBe(0);
    });

    it('handles Redis read errors gracefully', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      mockPrisma.processedBlock.findUnique.mockResolvedValue({ blockNumber: BigInt(500) });
      const block = await indexer.getLastProcessedBlock();
      expect(block).toBe(500);
    });
  });

  describe('setLastProcessedBlock', () => {
    it('writes to Redis cache', async () => {
      mockRedisSet.mockResolvedValue('OK');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      mockPrisma.processedBlock.upsert.mockResolvedValue({});
      await indexer.setLastProcessedBlock(50000);
      expect(mockRedisSet).toHaveBeenCalledWith('veilpay:block:sepolia', '50000');
    });

    it('handles Redis write errors gracefully', async () => {
      mockRedisSet.mockRejectedValue(new Error('Redis write failed'));
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      mockPrisma.processedBlock.upsert.mockResolvedValue({});
      await expect(indexer.setLastProcessedBlock(50000)).resolves.toBeUndefined();
    });
  });

  describe('indexNewBlocks', () => {
    it('returns empty array when pool address is not configured', async () => {
      delete process.env.POOL_SEPOLIA;
      const noPoolIndexer = new EVMIndexer('sepolia');
      const events = await noPoolIndexer.indexNewBlocks();
      expect(events).toEqual([]);
    });

    it('returns empty array when fromBlock > toBlock', async () => {
      mockRedisGet.mockResolvedValue('999999');
      mockGetBlockNumber.mockResolvedValue(999998);
      const events = await indexer.indexNewBlocks();
      expect(events).toEqual([]);
    });

    it('indexes NewCommitment events correctly', async () => {
      mockRedisGet.mockResolvedValue('100');
      mockGetBlockNumber.mockResolvedValue(200);
      mockQueryFilter
        .mockResolvedValueOnce([
          {
            args: ['0xCommitmentHash', '0xTokenAddress', BigInt(1000000), BigInt(5)],
            blockNumber: 150,
            transactionHash: '0xTxHash1',
            index: 0,
            getBlock: jest.fn().mockResolvedValue({ timestamp: 1700000000 }),
          },
        ])
        .mockResolvedValueOnce([]); // no withdrawal events

      mockRedisSet.mockResolvedValue('OK');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      mockPrisma.processedBlock.upsert.mockResolvedValue({});

      const events = await indexer.indexNewBlocks();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('commitment');
      expect(events[0].commitment).toBe('0xCommitmentHash');
      expect(events[0].amount).toBe('1000000');
      expect(events[0].leafIndex).toBe(5);
    });

    it('indexes Withdrawal events correctly', async () => {
      mockRedisGet.mockResolvedValue('100');
      mockGetBlockNumber.mockResolvedValue(200);
      mockQueryFilter
        .mockResolvedValueOnce([]) // no commitment events
        .mockResolvedValueOnce([
          {
            args: ['0xNullifierHash', '0xRecipient', '0xTokenAddress', BigInt(500000)],
            blockNumber: 170,
            transactionHash: '0xTxHash2',
            index: 1,
            getBlock: jest.fn().mockResolvedValue({ timestamp: 1700000100 }),
          },
        ]);

      mockRedisSet.mockResolvedValue('OK');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      mockPrisma.processedBlock.upsert.mockResolvedValue({});

      const events = await indexer.indexNewBlocks();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('withdrawal');
      expect(events[0].nullifier).toBe('0xNullifierHash');
      expect(events[0].recipient).toBe('0xRecipient');
    });

    it('handles query errors gracefully and returns empty array', async () => {
      mockRedisGet.mockResolvedValue('100');
      mockGetBlockNumber.mockResolvedValue(200);
      mockQueryFilter.mockRejectedValue(new Error('RPC error'));
      mockRedisSet.mockResolvedValue('OK');

      const events = await indexer.indexNewBlocks();
      expect(events).toEqual([]);
    });
  });
});

describe('SolanaIndexer', () => {
  it('returns empty array (stub)', () => {
    const indexer = new SolanaIndexer();
    const events = indexer.indexNewBlocks();
    expect(events).toEqual([]);
  });
});

describe('AptosIndexer', () => {
  it('returns empty array (stub)', () => {
    const indexer = new AptosIndexer();
    const events = indexer.indexNewBlocks();
    expect(events).toEqual([]);
  });
});

describe('runIndexers', () => {
  it('runs without errors when POOL_SEPOLIA is not set', async () => {
    delete process.env.POOL_SEPOLIA;
    await expect(runIndexers()).resolves.toBeUndefined();
  });

  it('runs EVM indexer when POOL_SEPOLIA is set', async () => {
    process.env.POOL_SEPOLIA = '0xPoolAddress';
    mockRedisGet.mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    mockPrisma.processedBlock.findUnique.mockResolvedValue(null);
    mockGetBlockNumber.mockResolvedValue(1000);
    mockQueryFilter.mockResolvedValue([]);
    mockRedisSet.mockResolvedValue('OK');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    mockPrisma.processedBlock.upsert.mockResolvedValue({});

    await expect(runIndexers()).resolves.toBeUndefined();
    delete process.env.POOL_SEPOLIA;
  });
});
