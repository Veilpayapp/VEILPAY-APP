/**
 * Ensure policy_tx_2_2 circuit files exist under app documentDirectory.
 *
 * Until Expo asset unpack ships the ~14MB blobs, paths can be pre-seeded via
 * EXPO_PUBLIC_SPP_CIRCUITS_DIR or a one-time adb push to spp/circuits/.
 * This module only ensures directories exist and reports readiness.
 */

import { getSppCircuitsDir } from './sppPoolSession';

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

/**
 * Best-effort readiness (native open still validates file presence).
 * Does not download secrets or keys over the network.
 */
export async function getCircuitsReadiness(): Promise<CircuitsReadiness> {
  const dir = getSppCircuitsDir();
  const missing: string[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const FS = require('expo-file-system') as {
      getInfoAsync?: (uri: string) => Promise<{ exists: boolean }>;
    };
    if (FS.getInfoAsync) {
      for (const name of REQUIRED) {
        const path = dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
        const info = await FS.getInfoAsync(path);
        if (!info.exists) missing.push(name);
      }
      const ready = missing.length === 0;
      return {
        dir,
        ready,
        missing,
        message: ready
          ? 'Circuit assets present'
          : `Missing: ${missing.join(', ')}. Stage via packages/spp-native/scripts/stage-circuit-assets.* then adb push to device ${dir}`,
      };
    }
  } catch {
    // Jest / no FS module
  }
  return {
    dir,
    ready: false,
    missing: [...REQUIRED],
    message: `Stage ${REQUIRED.join(', ')} into ${dir} (or EXPO_PUBLIC_SPP_CIRCUITS_DIR). Native pool_open fails closed if missing.`,
  };
}
