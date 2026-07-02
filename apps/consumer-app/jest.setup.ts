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

jest.mock('expo-constants', () => ({
  expoConfig: {
    extra: {
      transakApiKey: 'test-transak-key',
    },
  },
  manifest: {},
}));

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
