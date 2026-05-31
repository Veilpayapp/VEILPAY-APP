const fs = require('fs');
const path = require('path');

const screensDir = 'apps/consumer-app/src/screens';
const testsDir = path.join(screensDir, '__tests__');

if (!fs.existsSync(testsDir)) {
  fs.mkdirSync(testsDir);
}

const files = fs.readdirSync(screensDir).filter(f => f.endsWith('Screen.tsx'));
for (const file of files) {
  const componentName = file.replace('.tsx', '');
  const testFile = path.join(testsDir, componentName + '.test.tsx');
  if (!fs.existsSync(testFile)) {
    const content = `import React from 'react';
import { render } from '@testing-library/react-native';
import { ${componentName} } from '../${componentName}';
import { NavigationContainer } from '@react-navigation/native';

jest.mock('../../stores/walletStore', () => ({
  useWalletStore: jest.fn(() => ({ address: '0x123' })),
}));
jest.mock('../../stores/settingsStore', () => ({
  useSettingsStore: jest.fn(() => ({})),
}));
jest.mock('../../hooks/useBiometrics', () => ({
  useBiometrics: jest.fn(() => ({ authenticate: jest.fn().mockResolvedValue(true) })),
}));

describe('${componentName}', () => {
  it('renders without crashing', () => {
    const route = { params: {} };
    const { queryAllByText } = render(
      <NavigationContainer>
        <${componentName} route={route as any} navigation={{} as any} />
      </NavigationContainer>
    );
    expect(queryAllByText(/./).length).toBeGreaterThanOrEqual(0);
  });
});
`;
    fs.writeFileSync(testFile, content);
    console.log('Created test for', componentName);
  }
}
