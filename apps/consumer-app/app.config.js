const path = require('path');
const appJson = require('./app.json');

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
 *   Nothing sensitive is hardcoded in this repo. The only value kept in
 *   `app.json` is `extra.eas.projectId` — a public UUID that identifies the
 *   EAS project for OTA updates (authenticated via signing keys, not secrecy).
 *
 * LOCAL DEV:
 *   Run `doppler run -- pnpm start` from `apps/consumer-app`, or copy
 *   `.env.example` to `.env.local` and fill in values. Expo CLI loads `.env`
 *   automatically in development.
 *
 * The `updates.url` and `extra.eas.projectId` can be overridden from Doppler
 * via `EXPO_PUBLIC_EAS_UPDATE_URL` / `EXPO_PUBLIC_EAS_PROJECT_ID` if you want
 * to manage them there instead of app.json.
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
    ...appJson.expo,
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
