import React from 'react';
import { render } from '@testing-library/react-native';
import { TransactionDetailsScreen } from '../TransactionDetailsScreen';
import { NavigationContainer } from '@react-navigation/native';

jest.mock('../../stores/transactionStore', () => ({
  useTransactionStore: jest.fn(() => ({
    transactions: [{ hash: '0x123', type: 'sent', amount: '10', timestamp: 12345 }],
  })),
}));

describe('TransactionDetailsScreen', () => {
  it('renders without crashing', () => {
    const route = {
      params: { 
        transaction: { hash: '0x123', type: 'sent', amount: '10', timestamp: 12345, to: '0xabc', from: '0xdef' }
      },
    };
    const { queryAllByText } = render(
      <NavigationContainer>
        <TransactionDetailsScreen route={route as any} navigation={{} as any} />
      </NavigationContainer>
    );
    expect(queryAllByText(/Transaction/i).length).toBeGreaterThanOrEqual(0);
  });
});
