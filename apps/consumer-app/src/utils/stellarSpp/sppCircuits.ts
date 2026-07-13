/**
 * Ensure policy_tx_2_2 circuit files exist under app documentDirectory.
 *
 * Until Expo asset unpack ships the ~14MB blobs, paths can be pre-seeded via
 * EXPO_PUBLIC_SPP_CIRCUITS_DIR or a one-time adb push to spp/circuits/.
 * This module only ensures directories exist and reports readiness.
 */

export type CircuitsReadiness = {
  dir: string;
  ready: boolean;
  missing: string[];
  message: string;
};

const REQUIRED = [
  'policy_tx_2_2_proving_key.bin',
  'policy_tx_2_2.wasm',
  'policy_tx_2_2.r1cs',
] as const;

export const REQUIRED_SPP_CIRCUIT_FILES = REQUIRED;

async function trySeedBundledCircuitAssets(): Promise<string | null> {
  try {
    // Native Android copies assets/spp/circuits/* from the APK into app data.
    // Lazy require avoids a module cycle with sppPoolSession/sppNativeBridge.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { sppNativeEnsureCircuitAssets } = require('./sppNativeBridge') as {
      sppNativeEnsureCircuitAssets?: () => Promise<{
        ok: boolean;
        code?: string;
        message?: string;
      }>;
    };
    const result = await sppNativeEnsureCircuitAssets?.();
    if (!result || result.ok) return null;
    // JS stub / iOS pending simply means there is no native asset seeder.
    if (result.code === 'SPP_OPS_NOT_READY') return null;
    return result.message || 'Bundled circuit asset seeding failed';
  } catch {
    return null;
  }
}

/**
 * Best-effort readiness (native open still validates file presence).
 * Does not download secrets or keys over the network.
 */
export async function getCircuitsReadiness(): Promise<CircuitsReadiness> {
  // Lazy require avoids a module cycle when sppPoolSession uses the dir-specific checker.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getSppCircuitsDir } = require('./sppPoolSession') as {
    getSppCircuitsDir: () => string;
  };
  return getCircuitsReadinessForDir(getSppCircuitsDir());
}

export async function getCircuitsReadinessForDir(dir: string): Promise<CircuitsReadiness> {
  const missing: string[] = [];
  const seedError = await trySeedBundledCircuitAssets();
  try {
    // Expo SDK 55: getInfoAsync is on legacy; main export throws if used.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const FS = require('expo-file-system/legacy') as {
      getInfoAsync?: (uri: string) => Promise<{ exists: boolean }>;
    };
    if (FS.getInfoAsync) {
      for (const name of REQUIRED) {
        const path = dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
        const uri = path.startsWith('file:')
          ? path
          : path.startsWith('/')
            ? `file://${path}`
            : path;
        const info = await FS.getInfoAsync(uri);
        if (!info.exists) missing.push(name);
      }
      const ready = missing.length === 0;
      return {
        dir,
        ready,
        missing,
        message: ready
          ? 'Circuit assets present'
          : seedError ||
            `Missing: ${missing.join(', ')}. Rebuild the Android APK with bundled circuit assets or stage via adb push to ${dir}`,
      };
    }
  } catch {
    // Jest / no FS module
  }
  return {
    dir,
    ready: false,
    missing: [...REQUIRED],
    message:
      seedError ||
      `Stage ${REQUIRED.join(', ')} into ${dir} (or EXPO_PUBLIC_SPP_CIRCUITS_DIR). Native pool_open fails closed if missing.`,
  };
}
