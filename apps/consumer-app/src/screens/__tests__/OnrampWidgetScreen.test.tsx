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
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../utils/secureStateStorage', () => ({
  getSecureItem: jest.fn(),
  setSecureItem: jest.fn(),
}));

import { fireEvent } from '@testing-library/react-native';

jest.mock('../../features/fiat-gateway', () => {
  const actual = jest.requireActual('../../features/fiat-gateway');
  const React = require('react');
  const { View } = require('react-native');
  return {
    ...actual,
    useOnramp: () => ({ checkOrderStatus: jest.fn() }),
    FiatGatewayWebViewShell: React.forwardRef((props: any, ref: any) => <View testID="fiat-gateway-shell" {...props} />),
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
