import { renderHook } from '@testing-library/react-native';
import { useOnramp } from '../useOnramp';

jest.mock('../../utils/onramp', () => ({
  createOnrampSession: jest.fn(),
  getOnrampQuotes: jest.fn(),
}));

describe('useOnramp', () => {
  it('initializes without crashing', () => {
    const { result } = renderHook(() => useOnramp());
    expect(result.current).toBeDefined();
  });
});
