import { useState, useCallback } from 'react';
import { useTransactionStore, type OnrampOrderRecord, type OnrampOrderStatus } from '../stores/transactionStore';
import { getOnrampConfig } from '../utils/onramp';
import { captureError } from '../utils/sentry';
import type { FiatGatewayProvider } from '../utils/fiatGateway';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_BASE_URL;

export interface OnrampQuoteRequest {
  walletAddress: string;
  fiatAmount?: string;
  fiatCurrency: string;
  cryptoToken: string;
  chainKey: string;
  flow: 'buy' | 'sell';
  provider?: string;
}

export interface OnrampSession {
  url: string;
  orderId: string;
  /**
   * SEC-005: opaque signed token required to poll order status. Pass this to
   * `checkOrderStatus` instead of the raw order UUID.
   */
  statusToken: string;
}

export const useOnramp = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setLatestOnrampOrder = useTransactionStore(s => s.setLatestOnrampOrder);

  /**
   * Fetches a signed Onramp URL from the VeilPay backend.
   * The caller must supply `walletAddress` (resolved per-chain-type) to prevent
   * cross-chain fund loss.
   */
  const getOnrampUrl = useCallback(async (params: OnrampQuoteRequest): Promise<OnrampSession | null> => {
    if (!params.walletAddress) {
      setError('Wallet not connected');
      return null;
    }

    if (!BACKEND_URL) {
      setError('Backend configuration missing');
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      const config = getOnrampConfig(params.cryptoToken, params.chainKey);
      
      const response = await fetch(`${BACKEND_URL}/api/v1/onramp/url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userAddress: params.walletAddress,
          fiatAmount: params.fiatAmount,
          fiatCurrency: params.fiatCurrency,
          cryptoToken: config.coinCode,
          chainKey: params.chainKey,
          flow: params.flow,
          provider: params.provider || 'onramp_money',
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch Onramp URL');
      }

      const data = await response.json();
      const orderId = typeof data.orderId === 'string' ? data.orderId : '';
      const statusToken = typeof data.statusToken === 'string' ? data.statusToken : '';

      if (!orderId || !statusToken) {
        throw new Error('Failed to create Onramp order');
      }

      // Track the order in local state
      setLatestOnrampOrder({
        provider: (params.provider || 'onramp_money') as FiatGatewayProvider,
        id: orderId,
        orderId,
        statusToken,
        walletAddress: params.walletAddress,
        userAddress: params.walletAddress,
        flow: params.flow,
        status: 'pending',
        fiatAmount: params.fiatAmount || '0',
        fiatCurrency: params.fiatCurrency,
        cryptoToken: params.cryptoToken,
        chainKey: params.chainKey,
        updatedAt: Date.now(),
      });

      return {
        url: data.url as string,
        orderId,
        statusToken,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      captureError(err instanceof Error ? err : new Error(message));
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [setLatestOnrampOrder]);

  /**
   * Polls the backend for the status of a specific order.
   *
   * SEC-005: `statusToken` is the opaque signed token issued by
   * `POST /api/v1/onramp/url` — NOT the raw order UUID. The backend verifies
   * the token's HMAC before returning a minimized status payload.
   */
  const checkOrderStatus = useCallback(async (statusToken: string) => {
    if (!BACKEND_URL) return null;

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/onramp/status/${statusToken}`);
      if (!response.ok) return null;

      const order = await response.json();
      const normalizedOrderId =
        typeof order.orderId === 'string' && order.orderId.length > 0
          ? order.orderId
          : (typeof order.id === 'string' ? order.id : statusToken);

      // SEC-005: the backend's minimized status payload omits creation-time
      // fields (`userAddress`, `flow`, `chainKey`, `fiatCurrency`,
      // `cryptoToken`, `provider`, `statusToken`, `walletAddress`) on
      // purpose — see onrampController.getOnrampStatus. setLatestOnrampOrder
      // replaces the whole record, so we spread the existing record first
      // and override only the poll-authoritative fields. That avoids a
      // minimized backend response silently overwriting creation-time
      // values like flow ('sell' would otherwise downgrade to 'buy' if the
      // payload omits flow — see review suggestion #11) or wiping the
      // signed `statusToken` we already have polarized on disk.
      const current = useTransactionStore.getState().latestOnrampOrder;

      setLatestOnrampOrder({
        ...(current as OnrampOrderRecord | null),
        // Poll-authoritative fields: poll response is the source of truth.
        provider:
          order.provider === 'transak' || order.provider === 'onramp_money'
            ? (order.provider as FiatGatewayProvider)
            : (current?.provider ?? ('onramp_money' as FiatGatewayProvider)),
        id: typeof order.id === 'string' && order.id.length > 0 ? order.id : normalizedOrderId,
        orderId: normalizedOrderId,
        statusToken, // preserve the token across polls; backend never returns it
        walletAddress: current?.walletAddress ?? '',
        userAddress: current?.userAddress ?? current?.walletAddress ?? '',
        flow: current?.flow ?? 'buy',
        status: typeof order.status === 'string' ? (order.status as OnrampOrderStatus) : 'pending',
        fiatAmount: order.fiatAmount ?? current?.fiatAmount ?? '0',
        fiatCurrency: order.fiatCurrency ?? current?.fiatCurrency ?? '',
        cryptoToken: order.cryptoToken ?? current?.cryptoToken ?? '',
        chainKey: order.chainKey ?? current?.chainKey ?? '',
        cryptoAmount: order.cryptoAmount ?? current?.cryptoAmount,
        txHash: order.txHash ?? current?.txHash,
        updatedAt: Date.now(),
      });

      return order;
    } catch (err) {
      return null;
    }
  }, [setLatestOnrampOrder]);

  return {
    getOnrampUrl,
    checkOrderStatus,
    isLoading,
    error,
  };
};
