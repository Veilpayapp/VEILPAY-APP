import { withRedisLock } from '../redisLock';
import { getRedisClient } from '../redis';

jest.mock('../redis', () => ({
  getRedisClient: jest.fn()
}));

describe('redisLock', () => {
  let redisMock: any;

  beforeEach(() => {
    redisMock = {
      set: jest.fn().mockResolvedValue('OK'),
      eval: jest.fn().mockResolvedValue(1)
    };
    (getRedisClient as jest.Mock).mockReturnValue(redisMock);
    jest.clearAllMocks();
  });

  it('executes fn if lock acquired', async () => {
    const fn = jest.fn().mockResolvedValue('success');
    const result = await withRedisLock('my-key', 1000, fn);
    
    expect(result).toBe('success');
    expect(redisMock.set).toHaveBeenCalledWith('lock:my-key', expect.any(String), 'PX', 1000, 'NX');
    expect(redisMock.eval).toHaveBeenCalled();
  });

  it('does not execute fn if lock not acquired', async () => {
    redisMock.set.mockResolvedValue('NOT_OK');
    const fn = jest.fn();
    const result = await withRedisLock('my-key', 1000, fn);
    
    expect(result).toBeNull();
    expect(fn).not.toHaveBeenCalled();
    expect(redisMock.eval).toHaveBeenCalled();
  });

  it('runs locally if redis not available', async () => {
    (getRedisClient as jest.Mock).mockReturnValue(null);
    const fn = jest.fn().mockResolvedValue('local-success');
    const result = await withRedisLock('my-key', 1000, fn);
    
    expect(result).toBe('local-success');
    expect(fn).toHaveBeenCalled();
  });
});
