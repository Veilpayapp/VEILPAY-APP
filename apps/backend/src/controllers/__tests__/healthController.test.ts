import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { getHealth, getReady, getLive } from '../healthController';
import IORedis from 'ioredis';
import { config } from '../../config';

jest.mock('../../lib/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
  },
}));

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    ping: jest.fn(),
    quit: jest.fn(),
  }));
});

jest.mock('../../config', () => ({
  config: {
    redisUrl: 'redis://localhost:6379',
    redisPassword: 'password',
  },
}));

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
      
      const mockPing = jest.fn().mockResolvedValue('PONG');
      const mockQuit = jest.fn().mockResolvedValue('OK');
      (IORedis as unknown as jest.Mock).mockImplementation(() => ({
        ping: mockPing,
        quit: mockQuit,
      }));

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
      
      const mockPing = jest.fn().mockResolvedValue('PONG');
      const mockQuit = jest.fn().mockResolvedValue('OK');
      (IORedis as unknown as jest.Mock).mockImplementation(() => ({
        ping: mockPing,
        quit: mockQuit,
      }));

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
      
      const mockPing = jest.fn().mockRejectedValue(new Error('Connection failed'));
      const mockQuit = jest.fn().mockResolvedValue('OK');
      (IORedis as unknown as jest.Mock).mockImplementation(() => ({
        ping: mockPing,
        quit: mockQuit,
      }));

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
