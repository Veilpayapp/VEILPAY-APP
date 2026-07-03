import { useState, useCallback } from 'react';
import { useTransactionStore } from '../stores/transactionStore';
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

      if (!orderId) {
        throw new Error('Failed to create Onramp order');
      }

      // Track the order in local state
      setLatestOnrampOrder({
        provider: (params.provider || 'onramp_money') as FiatGatewayProvider,
        id: orderId,
        orderId,
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
   */
  const checkOrderStatus = useCallback(async (internalOrderId: string) => {
    if (!BACKEND_URL) return null;

    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/onramp/status/${internalOrderId}`);
      if (!response.ok) return null;
      
      const order = await response.json();
      const normalizedOrderId = typeof order.orderId === 'string' && order.orderId.length > 0 ? order.orderId : internalOrderId;
      
      // Sync local state if changed
      setLatestOnrampOrder({
        ...order,
        provider: order.provider || 'onramp_money',
        id: order.id ?? normalizedOrderId,
        orderId: normalizedOrderId,
        walletAddress: order.walletAddress ?? order.userAddress,
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
