import { renderHook } from '@testing-library/react-native';
import { useBalancePolling } from '../useBalancePolling';
import { useWalletStore, useWalletAddress, useActiveChain } from '../../stores/walletStore';

jest.mock('../../stores/walletStore', () => ({
  useWalletStore: jest.fn(),
  useWalletAddress: jest.fn(),
  useActiveChain: jest.fn(),
}));

jest.mock('../../utils/balanceFetcher', () => ({
  fetchNativeBalance: jest.fn().mockResolvedValue({ balanceFormatted: '1.0' })
}));

describe('useBalancePolling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useWalletAddress as unknown as jest.Mock).mockReturnValue('0x123');
    (useActiveChain as unknown as jest.Mock).mockReturnValue({ key: 'ethereum' });
    (useWalletStore as unknown as jest.Mock).mockReturnValue(jest.fn());
  });

  it('initializes without crashing', () => {
    const { result } = renderHook(() => useBalancePolling());
    expect(result.current).toBeDefined();
  });
});
