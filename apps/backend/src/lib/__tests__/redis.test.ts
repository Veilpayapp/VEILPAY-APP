import { parseRedisUrl, getRedisClient, getRedisInitError, disconnectRedis } from '../redis';
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
});
