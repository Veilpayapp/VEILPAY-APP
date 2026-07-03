const path = require('path');
const versionInfo = require('./version.json');

/**
 * VeilPay app config.
 *
 * ENV SOURCE OF TRUTH: Doppler.
 *
 *   All runtime config values (backend URL, WalletConnect ID, Sentry DSN, etc.)
 *   are injected from Doppler during EAS builds via the `preInstallHook`
 *   defined in `eas.json`. The hook downloads secrets to `.env`, which Expo CLI
 *   loads into `process.env` before this file and the JS bundler run.
 *
 *   Nothing sensitive is hardcoded in this repo. The only value kept here is
 *   `extra.eas.projectId` — a public UUID that identifies the EAS project for
 *   OTA updates (authenticated via signing keys, not secrecy).
 *
 * LOCAL DEV:
 *   Run `doppler run -- pnpm start` from `apps/consumer-app`, or copy
 *   `.env.example` to `.env.local` and fill in values. Expo CLI loads `.env`
 *   automatically in development.
 *
 * The `updates.url` and `extra.eas.projectId` can be overridden from Doppler
 * via `EXPO_PUBLIC_EAS_UPDATE_URL` / `EXPO_PUBLIC_EAS_PROJECT_ID` if you want
 * to manage them there instead of here.
 */
module.exports = () => {
  // Explicitly load .env so values are available even if Expo CLI hasn't
  // loaded them yet (e.g. when app.config.js is evaluated by EAS CLI directly).
  try {
    require('dotenv').config({ path: path.join(__dirname, '.env') });
  } catch {
    // dotenv not installed — Expo CLI's built-in loader handles .env in dev.
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
      url: 'https://u.expo.dev/b083fea1-cac0-4e6c-a07d-81ec0417cf36',
      enabled: true,
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 30000,
    },
    splash: {
      image: './assets/logo-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#0A0A0B',
    },
    assetBundlePatterns: ['**/*'],
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.veilpay.consumer',
      buildNumber: versionInfo.ios.buildNumber,
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/logo-icon.png',
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
    ],
    scheme: 'veilpay',
    extra: {
      eas: { projectId: 'b083fea1-cac0-4e6c-a07d-81ec0417cf36' },
    },
  };

  // Allow Doppler to override the EAS project ID / update URL.
  const easProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
  const easUpdateUrl = process.env.EXPO_PUBLIC_EAS_UPDATE_URL?.trim();

  if (easProjectId) {
    expoConfig.extra = {
      ...(expoConfig.extra || {}),
      eas: { projectId: easProjectId },
    };
  }

  if (easUpdateUrl) {
    expoConfig.updates = {
      ...(expoConfig.updates || {}),
      url: easUpdateUrl,
      enabled: true,
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 30000,
    };
  }

  return expoConfig;
};
