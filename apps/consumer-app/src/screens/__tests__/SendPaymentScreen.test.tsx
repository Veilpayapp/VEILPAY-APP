import React from 'react';
import { render } from '@testing-library/react-native';
import { SendPaymentScreen } from '../SendPaymentScreen';
import { NavigationContainer } from '@react-navigation/native';
import { useWalletStore } from '../../stores/walletStore';

jest.mock('../../stores/walletStore');

function renderScreen() {
  return render(
    <NavigationContainer>
      <SendPaymentScreen navigation={{} as any} route={{ params: {} } as any} />
    </NavigationContainer>
  );
}

describe('SendPaymentScreen', () => {
  beforeEach(() => {
    (useWalletStore as unknown as jest.Mock).mockReturnValue({
      address: '0x123',
    });
  });

  it('renders without crashing', () => {
    const { queryAllByText } = renderScreen();
    expect(queryAllByText(/Send/i).length).toBeGreaterThan(0);
  });

  // A11Y-001: screen-reader smoke. The money-flow entry controls must expose
  // stable accessibility labels so a VoiceOver/TalkBack user can complete a
  // send without relying on placeholder-only hints. This is a presence check,
  // not a full WCAG audit — it locks in the labels so a refactor can't silently
  // drop them.
  describe('accessibility labels (A11Y-001)', () => {
    it('labels the recipient and amount inputs', () => {
      const { getByLabelText } = renderScreen();
      expect(getByLabelText('Recipient address')).toBeTruthy();
      expect(getByLabelText('Payment amount')).toBeTruthy();
    });

    it('labels the memo input and quick-amount controls', () => {
      const { getByLabelText } = renderScreen();
      expect(getByLabelText('Payment memo, optional')).toBeTruthy();
      expect(getByLabelText('Use maximum available amount')).toBeTruthy();
      expect(getByLabelText('Use 25% of balance')).toBeTruthy();
    });

    it('exposes an accessible available-balance summary', () => {
      const { getByLabelText } = renderScreen();
      // Balance value is dynamic; assert the summary prefix is present.
      expect(getByLabelText(/^Available balance /)).toBeTruthy();
    });
  });
});
