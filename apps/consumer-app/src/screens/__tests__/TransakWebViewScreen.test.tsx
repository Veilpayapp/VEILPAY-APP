import React from 'react';
import { render } from '@testing-library/react-native';
import { TransakWebViewScreen } from '../TransakWebViewScreen';
import { NavigationContainer } from '@react-navigation/native';

jest.mock('react-native-webview', () => {
  const { View } = require('react-native');
  return {
    WebView: View,
  };
});

describe('TransakWebViewScreen', () => {
  it('renders without crashing', () => {
    const route = {
      params: {
        fiatCurrency: 'USD',
        cryptoCurrency: 'ETH',
        network: 'ethereum',
        fiatAmount: 100,
        type: 'buy' as const,
      }
    };
    
    const { queryAllByText } = render(
      <NavigationContainer>
        <TransakWebViewScreen route={route as any} navigation={{} as any} />
      </NavigationContainer>
    );
    expect(queryAllByText(/Loading/i).length).toBeGreaterThan(0);
  });
});
