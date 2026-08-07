module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/'],
  transformIgnorePatterns: [
    'node_modules/(?!(?:.*\\.pnpm/)?(?:(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|viem|@scure|@noble|@solana|uuid|jayson|ed25519-hd-key|moti|@motify|@web3icons.*))',
  ],
  transform: {
    '^.+\\.(js|jsx|ts|tsx|mjs)$': 'babel-jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'mjs'],
  moduleNameMapper: {
    '^rpc-websockets$': '<rootDir>/__mocks__/rpc-websockets.js',
    '^expo-constants$': '<rootDir>/__mocks__/expo-constants.js',
    '^stellar-sdk$': '<rootDir>/__mocks__/stellar-sdk.js',
    '^stellar-sdk/rpc$': '<rootDir>/__mocks__/stellar-sdk-rpc.js',
    '^expo-file-system/legacy$': '<rootDir>/__mocks__/expo-file-system-legacy.js',
    '^@noble/hashes/sha3$': '<rootDir>/__mocks__/@noble/hashes/sha3.js',
  },
  collectCoverageFrom: [
    'src/utils/**/*.{ts,tsx}',
    'src/stores/**/*.{ts,tsx}',
    'src/hooks/**/*.{ts,tsx}',
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
