// Mock for expo-file-system/legacy
module.exports = {
  getInfoAsync: jest.fn().mockResolvedValue({
    exists: true,
    isDirectory: false,
    size: 1024,
    modificationTime: Date.now(),
  }),
  readAsStringAsync: jest.fn().mockResolvedValue(''),
  readAsArrayAsync: jest.fn().mockResolvedValue(new Uint8Array()),
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  copyAsync: jest.fn().mockResolvedValue(undefined),
  moveAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
  readDirectoryAsync: jest.fn().mockResolvedValue([]),
  downloadAsync: jest.fn().mockResolvedValue({ uri: 'file://test' }),
  uploadAsync: jest.fn().mockResolvedValue({ body: '{}' }),
};
