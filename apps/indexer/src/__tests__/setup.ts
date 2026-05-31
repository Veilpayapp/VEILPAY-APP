import { jest } from '@jest/globals';

jest.mock('../lib/prisma', () => {
  return {
    prisma: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-member-access
      $transaction: jest.fn<any>((cb: any) => cb(require('../lib/prisma').prisma)),
      payment: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        findUnique: jest.fn<any>(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        findFirst: jest.fn<any>(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        update: jest.fn<any>(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: jest.fn<any>(),
      },
      invoice: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        findUnique: jest.fn<any>(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        update: jest.fn<any>(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        findMany: jest.fn<any>(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        findFirst: jest.fn<any>(),
      },
      merchant: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        findUnique: jest.fn<any>(),
      },
      chainViewingKey: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        findMany: jest.fn<any>().mockResolvedValue([]),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        findFirst: jest.fn<any>(),
      },
      webhookDelivery: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: jest.fn<any>(),
      },
      processedBlock: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        findUnique: jest.fn<any>(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        upsert: jest.fn<any>().mockResolvedValue({}),
      }
    }
  };
});

jest.mock('../lib/redis', () => {
  return {
    redis: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      get: jest.fn<any>(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set: jest.fn<any>(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      on: jest.fn<any>(),
    }
  };
});

jest.mock('bullmq', () => {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Queue: jest.fn<any>().mockImplementation(() => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      add: jest.fn<any>().mockResolvedValue({ id: 'mock-job-id' }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      on: jest.fn<any>(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      close: jest.fn<any>(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getWaitingCount: jest.fn<any>().mockResolvedValue(0),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getActiveCount: jest.fn<any>().mockResolvedValue(0),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getCompletedCount: jest.fn<any>().mockResolvedValue(0),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getFailedCount: jest.fn<any>().mockResolvedValue(0),
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Worker: jest.fn<any>().mockImplementation(() => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      on: jest.fn<any>(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      close: jest.fn<any>(),
    })),
  };
});

jest.mock('ethers', () => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-explicit-any
  const originalEthers = jest.requireActual('ethers') as any;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return {
    ...originalEthers,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    JsonRpcProvider: jest.fn<any>().mockImplementation(() => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getBlockNumber: jest.fn<any>().mockResolvedValue(1000),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getLogs: jest.fn<any>().mockResolvedValue([]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      on: jest.fn<any>(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      destroy: jest.fn<any>(),
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    WebSocketProvider: jest.fn<any>().mockImplementation(() => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getBlockNumber: jest.fn<any>().mockResolvedValue(1000),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getLogs: jest.fn<any>().mockResolvedValue([]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      on: jest.fn<any>(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      removeListener: jest.fn<any>(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      destroy: jest.fn<any>(),
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Contract: jest.fn<any>().mockImplementation(() => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      on: jest.fn<any>(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      removeAllListeners: jest.fn<any>(),
      filters: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        NewCommitment: jest.fn<any>().mockReturnValue({}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Withdrawal: jest.fn<any>().mockReturnValue({}),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      queryFilter: jest.fn<any>().mockResolvedValue([]),
    })),
  };
});

