import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { getHealth, getReady, getLive } from '../healthController';
import { getRedisClient } from '../../lib/redis';

jest.mock('../../lib/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
  },
}));

// PERF-001: checkRedis now reuses the shared Redis singleton, so the test
// stubs that accessor rather than the raw ioredis constructor.
jest.mock('../../lib/redis', () => ({
  getRedisClient: jest.fn(),
}));

const mockGetRedisClient = getRedisClient as jest.Mock;

function stubRedis(ping: jest.Mock): void {
  mockGetRedisClient.mockReturnValue({ ping } as unknown as ReturnType<typeof getRedisClient>);
}

describe('healthController', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {};
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
  });

  describe('getHealth', () => {
    it('returns ok status when both database and redis are healthy', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ 1: 1 }]);

      stubRedis(jest.fn().mockResolvedValue('PONG'));

      await getHealth(req as Request, res as Response);

      expect(res.json).toHaveBeenCalledWith({
        status: 'ok',
        timestamp: expect.any(String),
        services: {
          database: 'connected',
          redis: 'connected',
        },
      });
    });

    it('returns degraded status when database is down', async () => {
      (prisma.$queryRaw as jest.Mock).mockRejectedValue(new Error('Connection failed'));

      stubRedis(jest.fn().mockResolvedValue('PONG'));

      await getHealth(req as Request, res as Response);

      expect(res.json).toHaveBeenCalledWith({
        status: 'degraded',
        timestamp: expect.any(String),
        services: {
          database: 'disconnected',
          redis: 'connected',
        },
      });
    });

    it('returns degraded status when redis is down', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ 1: 1 }]);

      stubRedis(jest.fn().mockRejectedValue(new Error('Connection failed')));

      await getHealth(req as Request, res as Response);

      expect(res.json).toHaveBeenCalledWith({
        status: 'degraded',
        timestamp: expect.any(String),
        services: {
          database: 'connected',
          redis: 'disconnected',
        },
      });
    });
  });

  describe('getReady', () => {
    it('returns ready true when database is ok', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ 1: 1 }]);

      await getReady(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ ready: true });
    });

    it('returns 503 when database is not ok', async () => {
      (prisma.$queryRaw as jest.Mock).mockRejectedValue(new Error('Connection failed'));

      await getReady(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({ ready: false, reason: 'Database not available' });
    });
  });

  describe('getLive', () => {
    it('returns alive true', () => {
      getLive(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ alive: true });
    });
  });
});
