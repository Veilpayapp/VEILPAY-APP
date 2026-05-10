import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('../../components/Logo', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Logo: () => <View testID="mock-logo" />,
  };
});

jest.mock('../../components/Icon', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Icon: () => <View testID="mock-icon" />,
  };
});

jest.mock('../../components/NeoPop', () => {
  const React = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');
  return {
    NeoPopCard: ({ children }: { children: any }) => <View>{children}</View>,
    NeoPopButton: ({ title, onPress }: { title: string; onPress: () => void }) => (
      <TouchableOpacity onPress={onPress}>
        <Text>{title}</Text>
      </TouchableOpacity>
    ),
  };
});

const { OnboardingScreen } = require('../OnboardingScreen');
const { SCREENS } = require('../../constants/screens');

describe('OnboardingScreen', () => {
  it('renders all feature cards', () => {
    const navigation = { navigate: jest.fn() };

    const screen = render(<OnboardingScreen navigation={navigation} />);

    expect(screen.getByText('STEALTH ADDRESS')).toBeTruthy();
    expect(screen.getByText('ZK PROOFS')).toBeTruthy();
    expect(screen.getByText('MULTI-CHAIN')).toBeTruthy();
  });

  it('navigates to WalletConnect on Get Started', () => {
    const navigation = { navigate: jest.fn() };

    const screen = render(<OnboardingScreen navigation={navigation} />);

    fireEvent.press(screen.getByText('GET STARTED'));

    expect(navigation.navigate).toHaveBeenCalledWith(SCREENS.WALLET_CONNECT);
  });

  it('navigates to WalletConnect on Restore Existing Vault', () => {
    const navigation = { navigate: jest.fn() };

    const screen = render(<OnboardingScreen navigation={navigation} />);

    fireEvent.press(screen.getByText('RESTORE EXISTING VAULT'));

    expect(navigation.navigate).toHaveBeenCalledWith(SCREENS.WALLET_CONNECT);
  });
});
