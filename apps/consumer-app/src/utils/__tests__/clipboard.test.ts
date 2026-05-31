/**
 * First-principles unit test suite for clipboard.ts
 * Covers expo-clipboard loading success, failure paths, and safe error boundaries.
 */

// Reset module registry and module state before each test to clean cachedClipboardModule
beforeEach(() => {
  jest.resetModules();
});

describe('clipboard utility tests', () => {
  describe('when expo-clipboard module is successfully loaded', () => {
    it('successfully retrieves and sets clipboard string', async () => {
      const mockGetStringAsync = jest.fn().mockResolvedValue('test-clipboard-value');
      const mockSetStringAsync = jest.fn().mockResolvedValue(undefined);

      // Mock require of expo-clipboard
      jest.mock(
        'expo-clipboard',
        () => ({
          getStringAsync: mockGetStringAsync,
          setStringAsync: mockSetStringAsync,
        }),
        { virtual: true }
      );

      // Require module after mocking
      const { getClipboardString, setClipboardString } = require('../clipboard');

      // 1. Verify getClipboardString
      const getResult = await getClipboardString();
      expect(getResult).toBe('test-clipboard-value');
      expect(mockGetStringAsync).toHaveBeenCalledTimes(1);

      // 2. Verify setClipboardString
      const setResult = await setClipboardString('new-value');
      expect(setResult).toBe(true);
      expect(mockSetStringAsync).toHaveBeenCalledWith('new-value');
    });

    it('gracefully handles internal expo-clipboard throwing errors', async () => {
      const mockGetStringAsync = jest.fn().mockRejectedValue(new Error('Internal permission error'));
      const mockSetStringAsync = jest.fn().mockRejectedValue(new Error('Internal save error'));

      jest.mock(
        'expo-clipboard',
        () => ({
          getStringAsync: mockGetStringAsync,
          setStringAsync: mockSetStringAsync,
        }),
        { virtual: true }
      );

      const { getClipboardString, setClipboardString } = require('../clipboard');

      // 1. Verify getClipboardString handles rejection
      const getResult = await getClipboardString();
      expect(getResult).toBe('');

      // 2. Verify setClipboardString handles rejection
      const setResult = await setClipboardString('failing-value');
      expect(setResult).toBe(false);
    });
  });

  describe('when expo-clipboard module is unavailable in the environment', () => {
    it('gracefully falls back and returns default values without throwing', async () => {
      // Mock expo-clipboard to throw on require (simulating module absence)
      jest.mock(
        'expo-clipboard',
        () => {
          throw new Error('Cannot find module expo-clipboard');
        },
        { virtual: true }
      );

      const { getClipboardString, setClipboardString } = require('../clipboard');

      const getResult = await getClipboardString();
      expect(getResult).toBe('');

      const setResult = await setClipboardString('fallback-val');
      expect(setResult).toBe(false);
    });
  });

  describe('when expo-clipboard module is partially loaded', () => {
    it('handles missing function properties gracefully', async () => {
      jest.mock(
        'expo-clipboard',
        () => ({
          getStringAsync: 'not-a-function',
          setStringAsync: jest.fn(),
        }),
        { virtual: true }
      );

      const { getClipboardString, setClipboardString } = require('../clipboard');

      const getResult = await getClipboardString();
      expect(getResult).toBe('');

      const setResult = await setClipboardString('val');
      expect(setResult).toBe(false);
    });
  });
});

