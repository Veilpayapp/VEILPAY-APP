import * as Updates from 'expo-updates';
import { useState, useEffect } from 'react';

export type UpdateStatus = {
  isChecking: boolean;
  isDownloading: boolean;
  isUpdateAvailable: boolean;
  isUpdatePending: boolean;
  error: string | null;
  lastChecked: Date | null;
};

export function useOTAUpdates() {
  const [status, setStatus] = useState<UpdateStatus>({
    isChecking: false,
    isDownloading: false,
    isUpdateAvailable: false,
    isUpdatePending: false,
    error: null,
    lastChecked: null,
  });

  // Only run in production (not in development)
  const isProduction = !__DEV__;

  useEffect(() => {
    if (isProduction) {
      // Check for updates on app start
      checkForUpdate();
    }
  }, [isProduction]);

  const checkForUpdate = async () => {
    if (!isProduction) return;

    setStatus(prev => ({ ...prev, isChecking: true, error: null }));

    try {
      const update = await Updates.checkForUpdateAsync();
      setStatus(prev => ({
        ...prev,
        isChecking: false,
        isUpdateAvailable: update.isAvailable,
        lastChecked: new Date(),
      }));
      return update.isAvailable;
    } catch (error) {
      setStatus(prev => ({
        ...prev,
        isChecking: false,
        error: 'Failed to check for updates',
      }));
      return false;
    }
  };

  const downloadUpdate = async () => {
    if (!isProduction) return false;

    setStatus(prev => ({ ...prev, isDownloading: true, error: null }));

    try {
      const result = await Updates.fetchUpdateAsync();
      setStatus(prev => ({
        ...prev,
        isDownloading: false,
        isUpdatePending: result.isNew,
      }));
      return result.isNew;
    } catch (error) {
      setStatus(prev => ({
        ...prev,
        isDownloading: false,
        error: 'Failed to download update',
      }));
      return false;
    }
  };

  const applyUpdate = async () => {
    if (!isProduction) return;
    await Updates.reloadAsync();
  };

  return {
    ...status,
    isProduction,
    checkForUpdate,
    downloadUpdate,
    applyUpdate,
  };
}
