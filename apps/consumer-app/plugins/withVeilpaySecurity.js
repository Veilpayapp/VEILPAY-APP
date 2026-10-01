/**
 * Veilpay security config plugin (PRIV-201, PRIV-202).
 *
 * Android: disables OS Auto Backup for the whole app so plaintext AsyncStorage
 * (transaction history incl. private SPP rows, address book, onramp metadata,
 * diagnostics) and the SPP SQLite wallet files are never included in device
 * backups. Secrets already live in SecureStore/Keystore, which do not need OS
 * backup. Requires a native rebuild (expo prebuild) to take effect.
 */
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withVeilpaySecurity(config) {
  return withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application?.[0];
    if (app) {
      app.$['android:allowBackup'] = 'false';
    }
    return config;
  });
};
