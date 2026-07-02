const ORIGINAL_ENV = process.env;

type MockProvider = {
  url: string;
  getBlockNumber: jest.Mock;
};

const mockProviderRegistry = new Map<string, MockProvider>();

jest.mock('viem', () => ({
  createPublicClient: jest.fn().mockImplementation(({ transport }: any) => {
    // extract url from transport mock
    const url = transport.url;
    if (!mockProviderRegistry.has(url)) {
      mockProviderRegistry.set(url, {
        url,
        getBlockNumber: jest.fn(),
      });
    }
    return mockProviderRegistry.get(url);
  }),
  http: jest.fn((url: string) => ({ url })),
}));

jest.mock('../sentry', () => ({
  captureError: jest.fn(),
}));

let createPublicClientMock: jest.Mock;
let captureErrorMock: jest.Mock;

function loadRpcPool() {
  return require('../rpcPool');
}

function getProxyUrl(): string {
  return 'https://api.veilpay.app/api/v1/rpc/ethereum';
}

function getPublicUrl(): string {
  return 'https://ethereum-rpc.publicnode.com';
}

function getProvider(url: string): MockProvider {
  const provider = mockProviderRegistry.get(url);

  if (!provider) {
    throw new Error(`Missing provider mock for ${url}`);
  }

  return provider;
}

describe('rpcPool', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    mockProviderRegistry.clear();
    createPublicClientMock = require('viem').createPublicClient;
    captureErrorMock = require('../sentry').captureError;
    createPublicClientMock.mockClear();
    captureErrorMock.mockClear();

    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_BACKEND_BASE_URL: 'https://api.veilpay.app',
    };
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    process.env = ORIGINAL_ENV;
  });

  it('prefers the highest-weight provider when multiple endpoints are available', () => {
    const { getPoolProvider } = loadRpcPool();

    const provider = getPoolProvider('ethereum') as MockProvider;

    expect(provider.url).toBe(getProxyUrl());
    expect(createPublicClientMock).toHaveBeenCalledTimes(1);
    expect(createPublicClientMock).toHaveBeenCalledWith(
      { transport: { url: getProxyUrl() } }
    );
  });

  it('fails over to the next provider after the first circuit opens', async () => {
    const { poolCall, getPoolStatus } = loadRpcPool();

    const proxyUrl = getProxyUrl();
    const publicUrl = getPublicUrl();

    const callPromise = poolCall('ethereum', async (provider: any) => {
      const typedProvider = provider as MockProvider;
  
      if (typedProvider.url === proxyUrl) {
        throw new Error('proxy down');
      }
  
      return typedProvider.url;
    });

    await jest.advanceTimersByTimeAsync(900);

    await expect(callPromise).resolves.toBe(publicUrl);

    const status = getPoolStatus('ethereum');

    expect(status['backend-proxy-ethereum'].status).toBe('open');
    expect(status['public-ethereum'].status).toBe('healthy');
    expect(captureErrorMock).not.toHaveBeenCalled();
  });

  it('recovers an open circuit after a successful health check', async () => {
    const { poolCall, getPoolStatus, getPoolProvider } = loadRpcPool();

    const proxyUrl = getProxyUrl();
    const publicUrl = getPublicUrl();

    const callPromise = poolCall('ethereum', async (provider: any) => {
      const typedProvider = provider as MockProvider;
  
      if (typedProvider.url === proxyUrl) {
        throw new Error('proxy down');
      }
  
      return 'fallback-ok';
    });

    await jest.advanceTimersByTimeAsync(900);
    await expect(callPromise).resolves.toBe('fallback-ok');

    getProvider(proxyUrl).getBlockNumber.mockResolvedValue(1234);
    getProvider(publicUrl).getBlockNumber.mockResolvedValue(1234);

    await jest.advanceTimersByTimeAsync(60_000);

    const status = getPoolStatus('ethereum');

    expect(status['backend-proxy-ethereum'].status).toBe('healthy');
    expect(status['backend-proxy-ethereum'].failureCount).toBe(0);
    expect(getPoolProvider('ethereum').url).toBe(proxyUrl);
  });
});
