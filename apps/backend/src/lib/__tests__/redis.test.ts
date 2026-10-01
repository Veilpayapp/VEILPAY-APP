import {
  parseRedisUrl,
  getRedisClient,
  getRedisInitError,
  disconnectRedis,
  getBoundedRedisClient,
  getBoundedRedisInitError,
  disconnectBoundedRedis,
} from '../redis';
import Redis from 'ioredis';

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => {
    return {
      on: jest.fn(),
      disconnect: jest.fn()
    };
  });
});

jest.mock('../../config', () => ({
  config: {
    redisUrl: 'redis://user:pass@localhost:6379',
    redisPassword: 'password'
  }
}));

describe('redis utility', () => {
  afterEach(() => {
    disconnectRedis();
    jest.clearAllMocks();
  });

  describe('parseRedisUrl', () => {
    it('parses raw host:port', () => {
      const res = parseRedisUrl('127.0.0.1:6380');
      expect(res).toEqual({ host: '127.0.0.1', port: 6380 });
    });

    it('parses full url', () => {
      const res = parseRedisUrl('redis://:mypass@myhost.com:6379');
      expect(res).toEqual({ host: 'myhost.com', port: 6379, password: 'mypass', tls: undefined });
    });
  });

  describe('getRedisClient', () => {
    it('creates a new redis instance and reuses it', () => {
      const client1 = getRedisClient();
      const client2 = getRedisClient();
      expect(client1).toBe(client2);
      expect(Redis).toHaveBeenCalledTimes(1);
    });

    it('disconnects properly', () => {
      const client = getRedisClient();
      disconnectRedis();
      expect(client?.disconnect).toHaveBeenCalled();

      const client2 = getRedisClient();
      expect(client2).not.toBe(client);
    });
  });

  describe('getBoundedRedisClient (D1)', () => {
    it('returns a second, separate instance with hard-bounded options', () => {
      const bullmqClient = getRedisClient();
      const boundedClient = getBoundedRedisClient();

      expect(boundedClient).not.toBeNull();
      expect(boundedClient).not.toBe(bullmqClient);
      // Two constructor calls: BullMQ client + bounded client.
      expect(Redis).toHaveBeenCalledTimes(2);

      const boundedOptions = (Redis as unknown as jest.Mock).mock.calls[1][0];
      expect(boundedOptions).toEqual(
        expect.objectContaining({
          maxRetriesPerRequest: 2,
          commandTimeout: 1000,
          connectTimeout: 2000,
          lazyConnect: true,
          retryStrategy: expect.any(Function),
        })
      );
      // The BullMQ client must keep its unbounded semantics.
      const bullmqOptions = (Redis as unknown as jest.Mock).mock.calls[0][0];
      expect(bullmqOptions).toEqual(
        expect.objectContaining({
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          lazyConnect: true,
        })
      );
    });

    it('reuses the bounded singleton across calls', () => {
      const first = getBoundedRedisClient();
      const second = getBoundedRedisClient();
      expect(first).toBe(second);
      expect(getBoundedRedisInitError()).toBeNull();
    });

    it('stops reconnecting after a bounded number of attempts', () => {
      // getRedisClient first so the bounded client is constructor call #1
      // (afterEach clears constructor calls between tests).
      getRedisClient();
      getBoundedRedisClient();
      const boundedOptions = (Redis as unknown as jest.Mock).mock.calls[1][0];
      const retryStrategy = boundedOptions.retryStrategy as (times: number) => number | null;

      expect(retryStrategy(1)).toBe(200);
      expect(retryStrategy(3)).toBe(600);
      // Attempts beyond the cap return null → ioredis gives up ('end' status).
      expect(retryStrategy(4)).toBeNull();
      expect(retryStrategy(50)).toBeNull();
    });

    it('disconnectBoundedRedis tears down only the bounded instance', () => {
      const bullmqClient = getRedisClient();
      const boundedClient = getBoundedRedisClient();

      disconnectBoundedRedis();

      expect(boundedClient?.disconnect).toHaveBeenCalled();
      expect(bullmqClient?.disconnect).not.toHaveBeenCalled();

      const next = getBoundedRedisClient();
      expect(next).not.toBe(boundedClient);
    });
  });
});
