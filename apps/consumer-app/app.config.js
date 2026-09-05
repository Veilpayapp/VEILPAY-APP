// Read version from version.json (single source of truth) so this file can
// never drift from the native build (versionCode). Plain data require — no
// expo import at parse time.
const appJson = require('./version.json');

module.exports = {
  name: 'Veilpay',
  slug: 'veilpay',
  version: appJson.version || '1.0.2',
  orientation: 'portrait',
  icon: './assets/logo-icon.png',
  userInterfaceStyle: 'automatic',
  runtimeVersion: { policy: 'appVersion' },
  updates: {
    url: 'https://u.expo.dev/b083fea1-cac0-4e6c-a07d-81ec0417cf36',
    enabled: true,
    checkAutomatically: 'NEVER',
    fallbackToCacheTimeout: 0,
  },
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.veilpay.consumer',
    buildNumber: (appJson.ios && appJson.ios.buildNumber != null) ? String(appJson.ios.buildNumber) : '13',
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
      backgroundColor: '#0A0A0B',
    },
    package: 'com.veilpay.consumer',
    permissions: ['CAMERA', 'INTERNET', 'VIBRATE', 'POST_NOTIFICATIONS'],
  },
  web: { favicon: './assets/favicon.png' },
  plugins: [
    'expo-camera',
    'expo-secure-store',
    'expo-font',
    ['expo-notifications', { icon: './assets/icon.png', color: '#6366F1' }],
    'expo-updates',
    '@react-native-community/datetimepicker',
    [
      'expo-splash-screen',
      {
        image: './assets/logo-icon.png',
        resizeMode: 'contain',
        backgroundColor: '#0A0A0B',
        imageWidth: 200,
      },
    ],
  ],
  scheme: 'veilpay',
  extra: {
    eas: { projectId: 'b083fea1-cac0-4e6c-a07d-81ec0417cf36' },
  },
  owner: 'coderedx07',
};
