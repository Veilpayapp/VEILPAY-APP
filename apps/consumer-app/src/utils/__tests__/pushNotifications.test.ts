
if (typeof global.AbortController === 'undefined') {
  (global as any).AbortController = class {
    signal = { aborted: false };
    abort() { this.signal.aborted = true; }
  };
}
if (typeof global.DOMException === 'undefined') {
  (global as any).DOMException = class extends Error {
    constructor(msg: string, name: string) {
      super(msg);
      this.name = name;
    }
  };
}

describe('pushNotifications', () => {
  const originalEnv = process.env;

  let registerPushDeviceToken: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    jest.useRealTimers();
    process.env = { ...originalEnv };
    process.env.EXPO_PUBLIC_BACKEND_BASE_URL = 'http://localhost';
    process.env.EXPO_PUBLIC_API_KEY = 'apikey';
    registerPushDeviceToken = require('../pushNotifications').registerPushDeviceToken;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('registers successfully on first attempt', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
    } as any);

    const res = await registerPushDeviceToken({ token: 'test' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(res).toBe(true);
  });

  it('returns false on non-retryable 4xx error', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
    } as any);

    const res = await registerPushDeviceToken({ token: 'test' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(res).toBe(false);
  });

  it('retries on network error and succeeds', async () => {
    let attempts = 0;
    jest.spyOn(global, 'fetch').mockImplementation(() => {
      attempts++;
      if (attempts === 1) {
        return Promise.reject(new TypeError('Network Error'));
      }
      return Promise.resolve({ ok: true, status: 200 } as any);
    });

    // It sleeps 1s on retry, so bump timeout
    const res = await registerPushDeviceToken({ token: 'test' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(res).toBe(true);
  }, 10000);

  it('returns false after max retries on 500 error', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
    } as any);

    // It sleeps 1s + 2s = 3s total.
    const res = await registerPushDeviceToken({ token: 'test' });
    expect(global.fetch).toHaveBeenCalledTimes(3); // MAX_RETRIES = 3
    expect(res).toBe(false);
  }, 15000);
});
