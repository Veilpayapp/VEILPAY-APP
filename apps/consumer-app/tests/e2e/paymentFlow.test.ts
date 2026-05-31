// Consumer App E2E Payment Flow Test (Jest / React Native Testing Library)
import { renderHook, act } from '@testing-library/react-native';
import { useWalletStore } from '../../src/stores/walletStore';

describe('E2E: Payment Flow & ZKP Integration', () => {
  it('should handle proof generation state toggle correctly', () => {
    const { result } = renderHook(() => useWalletStore());
    
    expect(result.current.isProving).toBe(false);
    
    act(() => {
      result.current.setIsProving(true);
    });
    
    expect(result.current.isProving).toBe(true);
  });
});
