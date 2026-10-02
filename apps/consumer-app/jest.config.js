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
  // ~54.8 / screens 50.8). Round-5 (2026-10-02): the 11 line-1
  // `istanbul ignore file` directives (7 screens, 3 hooks, utils/analytics.ts)
  // were removed — every source file now counts in the denominator.
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
