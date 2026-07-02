process.env.DATABASE_URL = 'postgresql://dummy:dummy@localhost:5432/dummy';
process.env.JWT_SECRET = 'dummydummydummydummydummydummydummydummydummy';
process.env.API_KEY_SALT = 'dummydummydummydummydummydummydummydummydummy';
process.env.WEBHOOK_SIGNING_SECRET = 'dummydummydummydummydummydummydummydummydummy';
process.env.NODE_ENV = 'test';


jest.setTimeout(30000);

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => {
    return {
      on: jest.fn(),
      disconnect: jest.fn(),
      call: jest.fn((cmd: string, ...args: any[]) => {
        const command = cmd?.toLowerCase();
        if (command === 'script' && args[0]?.toLowerCase() === 'load') {
          return Promise.resolve('mock-sha-hash');
        }
        if (command === 'eval' || command === 'evalsha') {
          // rate-limit-redis script returns [count, ttl] or similar
          return Promise.resolve([1, Date.now() + 60000]);
        }
        return Promise.resolve('OK');
      }),
      ping: jest.fn().mockResolvedValue('PONG'),
    };
  });
});

