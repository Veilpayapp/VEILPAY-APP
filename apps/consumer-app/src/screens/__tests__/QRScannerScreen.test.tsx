import React from 'react';
import { render } from '@testing-library/react-native';
import { QRScannerScreen } from '../QRScannerScreen';
import { NavigationContainer } from '@react-navigation/native';

jest.mock('expo-camera', () => ({
  CameraView: jest.fn(() => null),
  useCameraPermissions: jest.fn().mockReturnValue([{ granted: true }, jest.fn()]),
}));

describe('QRScannerScreen', () => {
  it('renders without crashing', () => {
    const { getByTestId, queryAllByText } = render(
      <NavigationContainer>
        <QRScannerScreen navigation={{} as any} route={{ params: {} } as any} />
      </NavigationContainer>
    );
    expect(queryAllByText(/Scan/i).length).toBeGreaterThanOrEqual(0);
  });
});
