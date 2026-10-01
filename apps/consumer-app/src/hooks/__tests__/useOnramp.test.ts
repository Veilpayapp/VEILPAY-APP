/**
 * useOnramp — behavior tests for the signed-URL and status-poll lanes.
 *
 * Covers: missing wallet address guard, backend fetch success (order record
 * persisted with the SEC-005 statusToken), non-ok response, malformed payload
 * (missing orderId / statusToken), thrown non-Error, and the status-poll merge
 * semantics (poll-authoritative fields, provider allow-list, fallbacks to the
 * creation-time record, poll failure).
 */
import { renderHook, act } from '@testing-library/react-native';
import { useTransactionStore } from '../../stores/transactionStore';
import { getOnrampConfig } from '../../utils/onramp';
import { getAttestationHeaders } from '../../services/attestation';
import { captureError } from '../../utils/sentry';

jest.mock('../../utils/onramp', () => ({
  getOnrampConfig: jest.fn(() => ({ coinCode: 'ETH' })),
  createOnrampSession: jest.fn(),
  getOnrampQuotes: jest.fn(),
}));

jest.mock('../../services/attestation', () => ({
  getAttestationHeaders: jest.fn(async () => ({ 'X-Test-Attestation': '1' })),
}));

jest.mock('../../utils/sentry', () => ({
  captureError: jest.fn(),
}));

// BACKEND_URL is captured at module scope from the env, so it must be set
// BEFORE the hook module is required. Static imports are hoisted above this
// assignment; a dynamic require in source order is not.
process.env.EXPO_PUBLIC_BACKEND_BASE_URL = 'https://backend.test';

type UseOnrampModule = typeof import('../useOnramp');
const { useOnramp } = require('../useOnramp') as UseOnrampModule;

const fetchMock = global.fetch as unknown as jest.Mock;

function mockFetchOnce(json: unknown, ok = true) {
  fetchMock.mockReset();
  fetchMock.mockResolvedValueOnce({ ok, json: async () => json });
}

async function renderOnramp() {
  const utils = renderHook(() => useOnramp());
  await act(async () => {
    await Promise.resolve();
  });
  return utils;
}

const REQUEST = {
  walletAddress: 'GA6H2O3BLABLAEXAMPLEADDRESSEXAMPLEADDRESSEXAMPLE',
  fiatAmount: '100',
  fiatCurrency: 'USD',
  cryptoToken: 'ETH',
  chainKey: 'ethereum',
  flow: 'buy' as const,
};

describe('useOnramp', () => {
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) });
    (getOnrampConfig as jest.Mock).mockClear();
    (getAttestationHeaders as jest.Mock).mockClear();
    (captureError as jest.Mock).mockClear();
    useTransactionStore.setState({ latestOnrampOrder: null });
  });

  it('getOnrampUrl: rejects an empty wallet address before any fetch', async () => {
    const { result } = await renderOnramp();
    let session: Awaited<ReturnType<typeof result.current.getOnrampUrl>> | null = null;
    await act(async () => {
      session = await result.current.getOnrampUrl({ ...REQUEST, walletAddress: '' });
    });
    expect(session).toBeNull();
    expect(result.current.error).toBe('Wallet not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('getOnrampUrl: happy path returns the session and persists the order', async () => {
    mockFetchOnce({ url: 'https://widget.test/start', orderId: 'order-1', statusToken: 'tok-1' });
    const { result } = await renderOnramp();

    let session: Awaited<ReturnType<typeof result.current.getOnrampUrl>> | null = null;
    await act(async () => {
      session = await result.current.getOnrampUrl(REQUEST);
    });
    expect(session).toEqual({
      url: 'https://widget.test/start',
      orderId: 'order-1',
      statusToken: 'tok-1',
    });
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);

    // POST with attestation headers and the mapped coinCode.
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://backend.test/api/v1/onramp/url');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-Test-Attestation']).toBe('1');
    expect(JSON.parse(init.body as string)).toMatchObject({
      userAddress: REQUEST.walletAddress,
      cryptoToken: 'ETH',
      chainKey: 'ethereum',
      flow: 'buy',
      provider: 'onramp_money',
    });

    const record = useTransactionStore.getState().latestOnrampOrder;
    expect(record).toMatchObject({
      orderId: 'order-1',
      statusToken: 'tok-1',
      walletAddress: REQUEST.walletAddress,
      flow: 'buy',
      status: 'pending',
    });
  });

  it('getOnrampUrl: explicit provider is forwarded to the backend', async () => {
    mockFetchOnce({ url: 'u', orderId: 'order-2', statusToken: 'tok-2' });
    const { result } = await renderOnramp();
    await act(async () => {
      await result.current.getOnrampUrl({ ...REQUEST, provider: 'transak' });
    });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(init.body as string)).toMatchObject({ provider: 'transak' });
  });

  it('getOnrampUrl: non-ok response → error surfaced, captured, null returned', async () => {
    mockFetchOnce({}, false);
    const { result } = await renderOnramp();
    let session: Awaited<ReturnType<typeof result.current.getOnrampUrl>> | null = null;
    await act(async () => {
      session = await result.current.getOnrampUrl(REQUEST);
    });
    expect(session).toBeNull();
    expect(result.current.error).toBe('Failed to fetch Onramp URL');
    expect(result.current.isLoading).toBe(false);
    expect(captureError).toHaveBeenCalled();
  });

  it('getOnrampUrl: payload missing orderId/statusToken → order-creation error', async () => {
    mockFetchOnce({ url: 'u', orderId: 'order-3' }); // no statusToken
    const { result } = await renderOnramp();
    let session: Awaited<ReturnType<typeof result.current.getOnrampUrl>> | null = null;
    await act(async () => {
      session = await result.current.getOnrampUrl(REQUEST);
    });
    expect(session).toBeNull();
    expect(result.current.error).toBe('Failed to create Onramp order');
  });

  it('getOnrampUrl: non-Error rejection → "Unknown error" fallback message', async () => {
    fetchMock.mockReset();
    fetchMock.mockRejectedValueOnce('string failure');
    const { result } = await renderOnramp();
    let session: Awaited<ReturnType<typeof result.current.getOnrampUrl>> | null = null;
    await act(async () => {
      session = await result.current.getOnrampUrl(REQUEST);
    });
    expect(session).toBeNull();
    expect(result.current.error).toBe('Unknown error');
  });

  it('checkOrderStatus: non-ok response → null, no state change', async () => {
    mockFetchOnce({}, false);
    const { result } = await renderOnramp();
    let order: Awaited<ReturnType<typeof result.current.checkOrderStatus>> | null = null;
    await act(async () => {
      order = await result.current.checkOrderStatus('tok-9');
    });
    expect(order).toBeNull();
    expect(useTransactionStore.getState().latestOnrampOrder).toBeNull();
  });

  it('checkOrderStatus: ok response returns the payload and merges it over the current record', async () => {
    useTransactionStore.setState({
      latestOnrampOrder: {
        provider: 'onramp_money',
        id: 'order-1',
        orderId: 'order-1',
        statusToken: 'tok-1',
        walletAddress: 'GA_WALLET',
        userAddress: 'GA_WALLET',
        flow: 'sell',
        status: 'pending',
        fiatAmount: '100',
        fiatCurrency: 'USD',
        cryptoToken: 'ETH',
        chainKey: 'ethereum',
        updatedAt: 1,
      },
    });
    mockFetchOnce({
      orderId: 'order-1',
      status: 'completed',
      provider: 'transak',
      fiatAmount: '100',
      cryptoAmount: '0.04',
      txHash: '0xabc',
    });
    const { result } = await renderOnramp();

    let order: Awaited<ReturnType<typeof result.current.checkOrderStatus>> | null = null;
    await act(async () => {
      order = await result.current.checkOrderStatus('tok-1');
    });
    expect(order).toMatchObject({ orderId: 'order-1', status: 'completed' });

    const record = useTransactionStore.getState().latestOnrampOrder!;
    // Poll-authoritative fields (provider is normalized to 'onramp_money' by
    // the store's setLatestOnrampOrder, even when the poll says 'transak'):
    expect(record.status).toBe('completed');
    expect(record.provider).toBe('onramp_money');
    expect(record.cryptoAmount).toBe('0.04');
    expect(record.txHash).toBe('0xabc');
    // Creation-time fields preserved from the existing record:
    expect(record.flow).toBe('sell');
    expect(record.walletAddress).toBe('GA_WALLET');
    expect(record.statusToken).toBe('tok-1');
    expect(record.id).toBe('order-1');
  });

  it('checkOrderStatus: unknown provider falls back to the current record provider', async () => {
    useTransactionStore.setState({
      latestOnrampOrder: {
        provider: 'onramp_money',
        id: 'order-4',
        orderId: 'order-4',
        walletAddress: 'GA_W',
        userAddress: 'GA_W',
        flow: 'buy',
        status: 'pending',
        fiatAmount: '0',
        fiatCurrency: 'USD',
        cryptoToken: 'ETH',
        chainKey: 'ethereum',
        updatedAt: 1,
      },
    });
    mockFetchOnce({ orderId: 'order-4', status: 'processing', provider: 'mystery-gateway' });
    const { result } = await renderOnramp();
    await act(async () => {
      await result.current.checkOrderStatus('tok-4');
    });
    expect(useTransactionStore.getState().latestOnrampOrder!.provider).toBe('onramp_money');
  });

  it('checkOrderStatus: no current record → defaults (buy flow, token id fallbacks)', async () => {
    mockFetchOnce({ status: 'pending' }); // no orderId/id → normalized to the token
    const { result } = await renderOnramp();
    await act(async () => {
      await result.current.checkOrderStatus('tok-7');
    });
    const record = useTransactionStore.getState().latestOnrampOrder!;
    expect(record.orderId).toBe('tok-7');
    expect(record.flow).toBe('buy');
    expect(record.status).toBe('pending');
    expect(record.provider).toBe('onramp_money');
    expect(record.fiatAmount).toBe('0');
  });

  it('checkOrderStatus: id present in payload wins over the token', async () => {
    mockFetchOnce({ id: 'internal-9', orderId: '', status: 'processing' });
    const { result } = await renderOnramp();
    await act(async () => {
      await result.current.checkOrderStatus('tok-9');
    });
    const record = useTransactionStore.getState().latestOnrampOrder!;
    // Empty orderId in the payload → normalized from order.id (internal id).
    expect(record.id).toBe('internal-9');
    expect(record.orderId).toBe('internal-9');
  });

  it('checkOrderStatus: fetch throwing → null (silent)', async () => {
    fetchMock.mockReset();
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const { result } = await renderOnramp();
    let order: Awaited<ReturnType<typeof result.current.checkOrderStatus>> | null = null;
    await act(async () => {
      order = await result.current.checkOrderStatus('tok-x');
    });
    expect(order).toBeNull();
  });
});
