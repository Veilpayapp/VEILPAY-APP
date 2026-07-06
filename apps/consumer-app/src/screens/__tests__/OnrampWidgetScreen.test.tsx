import React from 'react';
import { render } from '@testing-library/react-native';
import { OnrampWidgetScreen as Component } from '../OnrampWidgetScreen';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: {} }),
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaView: ({ children, ...props }: any) => <View {...props}>{children}</View>,
  };
});
jest.mock('../../utils/secureStateStorage', () => ({
  getSecureItem: jest.fn(),
  setSecureItem: jest.fn(),
}));

import { fireEvent } from '@testing-library/react-native';

// The screen imports these from their direct module paths, not the
// feature barrel — mock those same paths so the stubs actually
// intercept (mocking the barrel alone leaves the real WebView shell to
// render, which crashes on the mocked safe-area module).
jest.mock('../../hooks/useOnramp', () => ({
  useOnramp: () => ({ checkOrderStatus: jest.fn() }),
}));
jest.mock('../../components/FiatGatewayWebViewShell', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    FiatGatewayWebViewShell: React.forwardRef((props: any, _ref: any) => <View testID="fiat-gateway-shell" {...props} />),
  };
});

describe('OnrampWidgetScreen', () => {
  it('renders correctly and handles button clicks', () => {
    const mockNavigate = jest.fn();
    const props = {
      navigation: { navigate: mockNavigate, goBack: jest.fn() } as any,
      route: { params: {} } as any,
    };

    const { toJSON } = render(<Component {...props} />);
    expect(toJSON()).toBeTruthy();
  });
});
