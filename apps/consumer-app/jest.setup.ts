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

	const createAnimatedPreset = (name: string) => ({
		duration: () => ({
			name,
		}),
	});

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
		useSharedValue: (initialValue: unknown) => ({
			value: initialValue,
		}),
		withRepeat: (value: unknown) => value,
		withSequence: (...values: unknown[]) => values[values.length - 1],
		withSpring: (value: unknown) => value,
		withTiming: (value: unknown) => value,
		interpolate: () => 0,
		interpolateColor: () => '#000000',
		runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
		runOnUI: (fn: (...args: unknown[]) => unknown) => fn,
	};
});
jest.mock('react-native/src/private/animated/NativeAnimatedHelper');
