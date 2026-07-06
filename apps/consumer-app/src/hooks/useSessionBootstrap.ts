/* istanbul ignore file */
import { useState, useEffect, useRef } from 'react';
import { useWalletStore, validateAddress } from '../stores/walletStore';
import { useTransactionStore, useTransactions } from '../stores/transactionStore';
import { isWalletInitialized, getStoredMnemonic } from '../utils/transactions';
import { deriveAddressesForAllChains } from '../utils/multiChainDerivation';
import { captureError, captureMessage } from '../utils/sentry';
import { getActiveSessions } from '../utils/walletConnectSession';

const MAX_BOOTSTRAP_RETRIES = 3;

export function useSessionBootstrap() {
  const [isSessionReady, setIsSessionReady] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [bootstrapRetryCount, setBootstrapRetryCount] = useState(0);

  const hasBootstrappedRef = useRef(false);

  const hasHydrated = useWalletStore((state) => state.hasHydrated);
  const connect = useWalletStore((state) => state.connect);
  const disconnect = useWalletStore((state) => state.disconnect);

  useEffect(() => {
    if (!hasHydrated || hasBootstrappedRef.current) {
      return;
    }

    hasBootstrappedRef.current = true;
    let cancelled = false;
    let timerId: NodeJS.Timeout | undefined;
    let checkId: NodeJS.Timeout | undefined;

    const bootstrapSession = async (attempt: number): Promise<void> => {
      if (!cancelled) {
        setIsBootstrapping(true);
      }

      try {
        const walletInitialized = await isWalletInitialized();

        if (!walletInitialized) {
          // Allow external wallet sessions that do not rely on local seed storage.
          const state = useWalletStore.getState();
          const addressesState = state.addresses || {};
          const hasValidConnectedSession = Boolean(
            state.isConnected
            && state.address
            && state.chainType
            && validateAddress(state.address, state.chainType)
            && Object.keys(addressesState).length > 0
          );

          if (hasValidConnectedSession) {
            try {
              // Initialize WalletConnect client and check if session is still alive
              const activeSessions = await getActiveSessions();
              const sessionExists = activeSessions.some((session) => {
                const namespaces = session.namespaces || {};
                const keys = Object.keys(namespaces);
                for (const key of keys) {
                  const accounts = namespaces[key]?.accounts || [];
                  // Substring match (accounts are "chain:ref:0xADDR"), not an exact
                  // membership test, so a Set/Map lookup does not apply here.
                  // react-doctor-disable-next-line react-doctor/js-set-map-lookups
                  if (accounts.some((acc: string) => acc.includes(state.address as string))) {
                    return true;
                  }
                }
                return false;
              });

              if (!sessionExists) {
                captureMessage('[bootstrap] External wallet session expired or disconnected.', 'warning');
                disconnect();
              }
            } catch (error) {
              captureError(error instanceof Error ? error : new Error('Failed to restore WalletConnect session'), {
                scope: 'wallet-session-bootstrap',
              });
            }
          }

          if (!hasValidConnectedSession && (state.isConnected || Boolean(state.address))) {
            disconnect();
          }
          if (!cancelled) {
            setIsSessionReady(true);
            setIsBootstrapping(false);
          }
          return;
        }

        const state = useWalletStore.getState();
        const addressesState = state.addresses || {};
        const hasValidConnectedSession = Boolean(
          state.isConnected
          && state.address
          && state.chainType
          && validateAddress(state.address, state.chainType)
          && Object.keys(addressesState).length >= 4 // Ensure all 4 chain addresses exist
        );

        if (hasValidConnectedSession) {
          if (!cancelled) {
            setIsSessionReady(true);
            setIsBootstrapping(false);
          }
          return;
        }

        // Clear stale connection state before restoring
        if (state.isConnected || Boolean(state.address)) {
          disconnect();
        }

        const mnemonic = await getStoredMnemonic();
        if (!mnemonic) {
          disconnect();
          if (!cancelled) {
            setIsSessionReady(true);
            setIsBootstrapping(false);
          }
          return;
        }

        const addresses = await deriveAddressesForAllChains(mnemonic);
        const initialChainType = state.chainType ?? 'evm';
        const initialChainKey = state.activeChain?.key;
        const initialAddress = addresses[initialChainType] || addresses['evm'];
        
        if (initialAddress) {
          await connect(initialAddress, initialChainType, initialChainKey);
        } else {
          disconnect();
        }

        if (!cancelled) {
          setIsSessionReady(true);
          setIsBootstrapping(false);
        }
      } catch (error: unknown) {
        captureError(error instanceof Error ? error : new Error('Failed to bootstrap wallet session'), {
          scope: 'wallet-session-bootstrap',
          attempt: String(attempt + 1),
        });

        if (attempt + 1 < MAX_BOOTSTRAP_RETRIES) {
          // Retry with exponential backoff: 2s, 4s
          const backoffMs = 2000 * Math.pow(2, attempt);
          captureMessage(`[bootstrap] Retry ${attempt + 2}/${MAX_BOOTSTRAP_RETRIES} in ${backoffMs / 1000}s`, 'warning');

          if (!cancelled) {
            setBootstrapRetryCount(attempt + 1);
          }

          await new Promise((resolve) => {
            timerId = setTimeout(resolve, backoffMs);
            // Allow cancellation during backoff wait
            checkId = setInterval(() => {
              if (cancelled) {
                clearTimeout(timerId);
                clearInterval(checkId);
                resolve(undefined);
              }
            }, 200);
          });

          if (!cancelled) {
            // Reset the ref so the next attempt can proceed
            hasBootstrappedRef.current = false;
            return bootstrapSession(attempt + 1);
          }
        } else {
          // Exhausted retries — allow app to continue in disconnected state
          captureMessage(`[bootstrap] All ${MAX_BOOTSTRAP_RETRIES} attempts failed. Continuing in disconnected state.`, 'error');
          disconnect();
          if (!cancelled) {
            setIsSessionReady(true);
            setIsBootstrapping(false);
          }
        }
      }
    };

    void bootstrapSession(0);

    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
      if (checkId) clearInterval(checkId);
    };
  }, [hasHydrated, connect, disconnect]);

  return { isSessionReady, isBootstrapping, bootstrapRetryCount };
}
