const path = require('path');

module.exports = () => {
  // Load version.json with absolute path
  const versionPath = path.join(__dirname, 'version.json');
  const versionInfo = require(versionPath);

  // Load dotenv if available (for dev)
  try {
    require('dotenv').config({ path: path.join(__dirname, '.env') });
  } catch (e) {
    // dotenv not available in EAS build
  }

  return {
    name: 'Veilpay',
    slug: 'veilpay',
    version: versionInfo.version,
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
      buildNumber: String(versionInfo.ios.buildNumber),
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
        backgroundColor: '#0A0A0B',
      },
      package: 'com.veilpay.consumer',
      versionCode: versionInfo.android.versionCode,
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
  };
};
