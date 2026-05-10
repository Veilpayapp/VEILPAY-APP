import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

export type NetworkStatus = {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
  type: string | null;
};

export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>({
    isConnected: null,
    isInternetReachable: null,
    type: null,
  });

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    try {
      if (typeof NetInfo?.addEventListener !== 'function') {
        throw new Error('NetInfo.addEventListener is unavailable');
      }

      unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
        setStatus({
          isConnected: state.isConnected,
          isInternetReachable: state.isInternetReachable,
          type: state.type,
        });
      });
    } catch (error) {
      // Some preview runtimes can miss native NetInfo; fail open instead of crashing app boot.
      console.warn('[useNetworkStatus] NetInfo unavailable, skipping network listener.', error);
      setStatus({
        isConnected: true,
        isInternetReachable: null,
        type: null,
      });
    }

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  return status;
}
