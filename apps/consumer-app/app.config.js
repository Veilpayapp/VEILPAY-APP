const path = require('path');

// Load version.json — must be present for builds
let versionInfo;
try {
  versionInfo = require('./version.json');
} catch (err) {
  console.error('Failed to load version.json:', err.message);
  // Fallback to prevent build failure
  versionInfo = {
    version: '1.0.0',
    ios: { buildNumber: '1' },
    android: { versionCode: 1 }
  };
}

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
      // JS-CONTROLLED UPDATES. We deliberately DISABLE the native auto-check.
      //   - 'ON_LOAD' made expo-updates silently download the update and apply
      //     it on the next launch, pre-empting our branded UpdatePromptModal so
      //     the user never saw a prompt.
      //   - fallbackToCacheTimeout: 30000 blocked cold launch for up to 30s
      //     while it fetched an update, showing a blank/near-black screen.
      // With 'NEVER' + timeout 0, the app launches instantly from cache and the
      // `useOTAUpdates` hook (App.tsx) is the SOLE update path: it checks,
      // shows the prompt, and only downloads + reloads when the user opts in.
      // NOTE: these map to native AndroidManifest meta-data
      // (EXPO_UPDATES_CHECK_ON_LAUNCH / EXPO_UPDATES_LAUNCH_WAIT_MS), so this
      // change only takes effect in a NEW BUILD — it cannot ship over OTA.
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
        // Use the purpose-built adaptive-icon assets (content sits inside the
        // Android safe zone). Pointing this at the full-bleed logo-icon.png made
        // the launcher icon look cropped/deformed under the circular/squircle mask.
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
      // Branded native splash (SDK 55 config-plugin form; replaces the legacy
      // top-level `splash` key). `index.ts` holds it up via
      // preventAutoHideAsync() and App.tsx hides it on first paint so there is
      // no grey window-background flash before the JS BootSplash appears.
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
      // Keep the JS-controlled behavior even when the URL comes from Doppler.
      // See the primary `updates` block above for the full rationale.
      checkAutomatically: 'NEVER',
      fallbackToCacheTimeout: 0,
    };
  }

  return expoConfig;
};
