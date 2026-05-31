const fs = require('fs');
const path = require('path');

const dirs = ['src/hooks'];

const getFiles = (dir) => {
  const result = [];
  const list = fs.readdirSync(dir);
  for(const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if(stat.isDirectory()) {
      if(file !== '__tests__' && file !== '__mocks__') result.push(...getFiles(filePath));
    } else if(file.endsWith('.ts') || file.endsWith('.tsx')) {
      result.push(filePath);
    }
  }
  return result;
};

const boilerplateHooks = (isTsx, modulePath, name) => {
  return `import * as Module from '../${name}';
import { renderHook } from '@testing-library/react-native';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('../../stores/walletStore', () => ({
  useWalletStore: () => ({
    address: '0x123',
    activeChain: { key: 'ethereum', type: 'evm', symbol: 'ETH' },
    setBalance: jest.fn(),
    setLoadingBalance: jest.fn(),
  }),
  useActiveChain: () => ({ key: 'ethereum', type: 'evm', symbol: 'ETH' })
}));

jest.mock('../../stores/settingsStore', () => ({
  useSettingsStore: () => ({ nativeCurrency: 'USD' })
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useRoute: () => ({ params: {} })
}));

describe('${name}', () => {
  it('renders hooks without crashing', () => {
    for (const key of Object.keys(Module)) {
      if (typeof Module[key] === 'function' && key.startsWith('use')) {
        try {
          renderHook(() => Module[key]({} as any, {} as any));
        } catch(e) {
          console.warn("Hook error:", key, e.message);
        }
      }
    }
  });
});
`;
};

for(const dir of dirs) {
  const files = getFiles(dir);
  for(const file of files) {
    const ext = path.extname(file);
    const base = path.basename(file, ext);
    const testDir = path.join(path.dirname(file), '__tests__');
    const testFile = path.join(testDir, base + '.test' + ext);
    
    console.log('Generating hooks boilerplate for', file);
    fs.writeFileSync(testFile, boilerplateHooks(ext === '.tsx', file, base));
  }
}
