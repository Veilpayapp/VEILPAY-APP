module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/'],
  transformIgnorePatterns: [
    'node_modules/(?!(?:.*\\.pnpm/)?(?:(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|viem|@scure|@noble|@noble/hashes|@solana|uuid|jayson|ed25519-hd-key|moti|@motify|@web3icons|circomlibjs.*))',
  ],
  transform: {
    '^.+\\.(js|jsx|ts|tsx|mjs)$': 'babel-jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'mjs'],
  moduleNameMapper: {
    '^rpc-websockets$': '<rootDir>/__mocks__/rpc-websockets.js',
    '^expo-constants$': '<rootDir>/__mocks__/expo-constants.js',
    '^expo-file-system/legacy$': '<rootDir>/__mocks__/expo-file-system-legacy.js',
    '^@noble/hashes/sha3$': '<rootDir>/__mocks__/@noble/hashes/sha3.js',
    '^circomlibjs$': '<rootDir>/__mocks__/circomlibjs.ts',
  },
  // Coverage scope: the utils/stores/hooks core, re-expanded (2026-10-02) to
  // screens + components after per-dir branch coverage reached ≥50% in every
  // directory (measured: utils 62.6 / stores 66.4 / hooks 50.6 / components
  // ~54.8 / screens 50.8). DEBT (see REMEDIATION_PROGRESS.md): 11 source
  // files carry a line-1 `/* istanbul ignore file */` directive (7 screens —
  // AddCustomNetwork, HomeDashboard, QRScanner, ReceiveQR, SendPayment,
  // TransactionHistory, TransakWebView — plus hooks useBalancePolling /
  // usePushNotifications / useSessionBootstrap and utils/analytics.ts) and
  // are therefore INVISIBLE to this gate: istanbul emits no coverage data
  // for them, so they neither count in the denominator nor fail thresholds.
  // Removing those directives is source-level work for the debt register;
  // tests exist for several of them already.
  collectCoverageFrom: [
    'src/utils/**/*.{ts,tsx}',
    'src/stores/**/*.{ts,tsx}',
    'src/hooks/**/*.{ts,tsx}',
    'src/screens/**/*.{ts,tsx}',
    'src/components/**/*.{ts,tsx}',
    '!src/**/__tests__/**',
    '!src/**/*.test.{ts,tsx}',
    '!src/**/*.property.test.{ts,tsx}',
  ],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50,
    },
  },

};
