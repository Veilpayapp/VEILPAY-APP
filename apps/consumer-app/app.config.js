const path = require('path');

let versionInfo = {
  version: '1.0.2',
  ios: { buildNumber: '13' },
  android: { versionCode: 13 }
};

try {
  versionInfo = require('./version.json');
} catch (err) {
  console.warn('⚠️  Failed to load version.json, using fallback:', err.message);
}

module.exports = () => {
  // Load .env if available (dev only)
  try {
    require('dotenv').config({ path: path.join(__dirname, '.env') });
  } catch {
    // dotenv not installed or .env missing
  }

  const expoConfig = {
    name: 'Veilpay',
    slug: 'veilpay',
    version: versionInfo.version,
    orientation: 'portrait',
    icon: './assets/logo-icon.png',
    userInterfaceStyle: 'automatic',
    runtimeVersion: { policy: 'appVersion' },
    updates: {
      url: process.env.EXPO_PUBLIC_EAS_UPDATE_URL || 'https://u.expo.dev/b083fea1-cac0-4e6c-a07d-81ec0417cf36',
      enabled: true,
      checkAutomatically: 'NEVER',
      fallbackToCacheTimeout: 0,
    },
    assetBundlePatterns: ['**/*'],
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.veilpay.consumer',
      buildNumber: versionInfo.ios.buildNumber,
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
      eas: {
        projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID || 'b083fea1-cac0-4e6c-a07d-81ec0417cf36'
      },
    },
  };

  return expoConfig;
};
