import { secureStateStorage } from '../secureStateStorage';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureMessage } from '../sentry';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('../sentry', () => ({
  captureError: jest.fn(),
  captureMessage: jest.fn(),
}));

describe('secureStateStorage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getItem uses SecureStore successfully', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('secret_value');
    
    const val = await secureStateStorage.getItem('veilpay-wallet-storage');
    expect(val).toBe('secret_value');
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith('veilpay-wallet-storage', expect.any(Object));
  });

  it('setItem uses SecureStore successfully', async () => {
    (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
    
    await secureStateStorage.setItem('veilpay-wallet-storage', 'secret_value');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('veilpay-wallet-storage', 'secret_value', expect.any(Object));
  });

  it('removeItem uses SecureStore successfully', async () => {
    (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
    
    await secureStateStorage.removeItem('veilpay-wallet-storage');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('veilpay-wallet-storage', expect.any(Object));
  });

  it('getItem fails for sensitive store and does not fallback', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValue(new Error('fail'));
    
    const val = await secureStateStorage.getItem('veilpay-wallet-storage');
    expect(val).toBeNull();
    expect(captureMessage).toHaveBeenCalled();
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });

  it('getItem fails for non-sensitive store and falls back to AsyncStorage', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValue(new Error('fail'));
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('normal_value');
    
    const val = await secureStateStorage.getItem('normal-store');
    expect(val).toBe('normal_value');
    expect(AsyncStorage.getItem).toHaveBeenCalledWith('normal-store');
  });

  it('setItem fails for sensitive store and does not fallback', async () => {
    (SecureStore.setItemAsync as jest.Mock).mockRejectedValue(new Error('fail'));
    
    await secureStateStorage.setItem('veilpay-wallet-storage', 'secret_value');
    expect(captureMessage).toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('setItem fails for non-sensitive store and falls back to AsyncStorage', async () => {
    (SecureStore.setItemAsync as jest.Mock).mockRejectedValue(new Error('fail'));
    
    await secureStateStorage.setItem('normal-store', 'normal_value');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('normal-store', 'normal_value');
  });

  it('removeItem fails and falls back to AsyncStorage', async () => {
    (SecureStore.deleteItemAsync as jest.Mock).mockRejectedValue(new Error('fail'));
    
    await secureStateStorage.removeItem('normal-store');
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('normal-store');
  });
});
