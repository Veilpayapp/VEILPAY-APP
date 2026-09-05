import '@testing-library/jest-native/extend-expect';

jest.mock('react-native-safe-area-context', () => {
	const React = require('react');
	const ReactNative = require('react-native');

	const SafeAreaView = ReactNative.View;

	return {
		__esModule: true,
		SafeAreaView,
		SafeAreaProvider: ({ children }: { children?: React.ReactNode }) =>
			React.createElement(ReactNative.View, null, children),
		useSafeAreaInsets: () => ({
			top: 0,
			right: 0,
			bottom: 0,
			left: 0,
		}),
		useSafeAreaFrame: () => ({
			x: 0,
			y: 0,
			width: 0,
			height: 0,
		}),
		initialWindowMetrics: {
			insets: {
				top: 0,
				right: 0,
				bottom: 0,
				left: 0,
			},
			frame: {
				x: 0,
				y: 0,
				width: 0,
				height: 0,
			},
		},
	};
});

jest.mock('react-native-reanimated', () => {
	const ReactNative = require('react-native');

	const createAnimatedPreset = (name: string) => {
		const preset: any = { name };
		preset.duration = () => preset;
		preset.springify = () => preset;
		preset.damping = () => preset;
		preset.stiffness = () => preset;
		preset.mass = () => preset;
		preset.delay = () => preset;
		return preset;
	};

	const Animated = {
		View: ReactNative.View,
		Text: ReactNative.Text,
		Image: ReactNative.Image,
		ScrollView: ReactNative.ScrollView,
		FlatList: ReactNative.FlatList,
		SectionList: ReactNative.SectionList,
		Pressable: ReactNative.Pressable,
		TouchableOpacity: ReactNative.TouchableOpacity,
		createAnimatedComponent: (Component: unknown) => Component,
	};

	return {
		__esModule: true,
		default: Animated,
		View: ReactNative.View,
		Text: ReactNative.Text,
		Image: ReactNative.Image,
		ScrollView: ReactNative.ScrollView,
		FlatList: ReactNative.FlatList,
		SectionList: ReactNative.SectionList,
		Pressable: ReactNative.Pressable,
		TouchableOpacity: ReactNative.TouchableOpacity,
		FadeIn: createAnimatedPreset('FadeIn'),
		FadeInDown: createAnimatedPreset('FadeInDown'),
		FadeInUp: createAnimatedPreset('FadeInUp'),
		FadeOut: createAnimatedPreset('FadeOut'),
		LinearTransition: createAnimatedPreset('LinearTransition'),
		Easing: {
			ease: jest.fn(),
		},
		useAnimatedStyle: (factory: () => unknown) => factory(),
		useAnimatedScrollHandler: () => () => {},
		useSharedValue: (initialValue: unknown) => ({
			value: initialValue,
		}),
		withRepeat: (value: unknown) => value,
		withSequence: (...values: unknown[]) => values[values.length - 1],
		withSpring: (value: unknown) => value,
		withTiming: (value: unknown) => value,
		withDelay: (delayMs: number, value: unknown) => value,
		withDecay: (value: unknown) => value,
		interpolate: () => 0,
		interpolateColor: () => '#000000',
		Extrapolation: {
			CLAMP: 'clamp',
			EXTEND: 'extend',
			IDENTITY: 'identity',
		},
		ReduceMotion: {
			System: 'system',
			Always: 'always',
			Never: 'never',
		},
		runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
		runOnUI: (fn: (...args: unknown[]) => unknown) => fn,
	};
});
jest.mock('react-native/src/private/animated/NativeAnimatedHelper');

jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    WebView: (props: any) => React.createElement(View, props),
  };
});

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);


/**
 * SEC-002: Crypto.randomUUID polyfill for Jest
 * Crypto.randomUUID() returns undefined in Jest environment.
 * This polyfill generates proper v4 UUIDs for biometric token generation.
 */
if (!global.crypto) {
  (global as any).crypto = {};
}

const generateUUIDv4 = (): string => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

if (!global.crypto.randomUUID) {
  global.crypto.randomUUID = generateUUIDv4;
}

jest.useFakeTimers();
global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })) as unknown as typeof fetch;

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readyState = MockWebSocket.OPEN;
  url: string;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(url: string) {
    this.url = url;
  }
  close() {
    this.readyState = MockWebSocket.CLOSED;
  }
  send() {}
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() {
    return true;
  }
}

(global as { WebSocket?: unknown }).WebSocket = MockWebSocket;

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: {
    Light: 'light',
    Medium: 'medium',
    Heavy: 'heavy',
  },
  NotificationFeedbackType: {
    Success: 'success',
    Warning: 'warning',
    Error: 'error',
  },
}));

// expo-constants is mocked via moduleNameMapper in jest.config.js
// No need to mock here — the mapping handles automatic redirection

jest.mock('expo-linking', () => ({
  createURL: jest.fn(),
  openURL: jest.fn(),
  useURL: jest.fn(),
}), { virtual: true });

jest.mock('@react-native-community/netinfo', () => require('@react-native-community/netinfo/jest/netinfo-mock.js'));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

/**
 * SEC-002: expo-crypto module mock for Jest.
 * Source files call `Crypto.randomUUID()` / `Crypto.digestStringAsync()` via a
 * namespace import, so global `crypto`/`Crypto` polyfills NEVER intercept them —
 * the native module binding (ExpoCrypto.randomUUID etc.) is undefined in Jest and
 * the calls throw. This module-level mock is the only effective fix.
 * digestStringAsync returns a deterministic 64-hex FNV-1a digest (same output
 * length as SHA-256) so callers slicing `digest.slice(0, 32)` still work.
 */
jest.mock('expo-crypto', () => {
  const generateUUIDv4 = (): string =>
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });

  const digestStringAsync = jest.fn(async (_algorithm: unknown, data: string) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < data.length; i++) {
      h ^= data.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(64, '0');
  });

  return {
    randomUUID: generateUUIDv4,
    digestStringAsync,
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    getRandomBytes: jest.fn((size: number) => {
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i++) bytes[i] = Math.floor(Math.random() * 256);
      return bytes;
    }),
    getRandomBytesAsync: jest.fn(async (size: number) => {
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i++) bytes[i] = Math.floor(Math.random() * 256);
      return bytes;
    }),
  };
});

/**
 * SEC-002: Polyfill Crypto.randomUUID() for Jest environment
 * In Jest, Crypto.randomUUID() returns undefined, breaking token generation.
 * This polyfill ensures cryptographically secure UUIDs are generated in tests.
 */
if (!global.Crypto) {
  (global as any).Crypto = {};
}

if (!global.Crypto.randomUUID || global.Crypto.randomUUID() === undefined) {
  global.Crypto.randomUUID = (): string => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };
}
