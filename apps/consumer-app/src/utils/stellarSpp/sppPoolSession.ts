/**
 * Open / close native SPP pool session (sdk/pool via CAP_POOL_OPS).
 *
 * Loads circuit assets path + Stellar secret seed, then calls native `pool_open`.
 * Never logs secret keys.
 */

import { Keypair } from 'stellar-sdk';
import { mnemonicToSeed } from '@scure/bip39';
import { derivePath } from 'ed25519-hd-key';
import {
  assertSppEnabled,
  type SppDeploymentConfig,
} from '../../constants/spp';
import { getStoredMnemonic } from '../transactions';
import { SppClientError } from './types';
import {
  sppNativeAppDataDir,
  sppNativeCapabilities,
  sppNativePoolClose,
  sppNativePoolOpen,
  type SppNativeOpResult,
} from './sppNativeBridge';
import { signSppKeyDerivationMessage } from './sppOnboard';
import { getCircuitsReadinessForDir } from './sppCircuits';

const STELLAR_DERIVATION_PATH = "m/44'/148'/0'";

/**
 * Convert Expo `file://…` URIs (and odd `file:/…` forms) to absolute OS paths
 * that Rust `std::fs` understands.
 */
export function toNativeFsPath(uriOrPath: string): string {
  let p = uriOrPath.trim();
  if (!p) return '';
  if (p.startsWith('file://')) {
    p = p.slice('file://'.length);
    // file:///data/... → /data/...  (keep leading slash)
    // file://localhost/data/... → strip host if present
    if (p.startsWith('localhost/')) p = p.slice('localhost'.length);
  } else if (p.startsWith('file:')) {
    p = p.slice('file:'.length);
  }
  try {
    p = decodeURIComponent(p);
  } catch {
    // keep raw
  }
  // Collapse accidental double slashes except leading // on Windows UNC (not used on Android).
  if (p.startsWith('/') && !p.startsWith('//')) {
    p = p.replace(/\/{2,}/g, '/');
  }
  return p.replace(/\/+$/, '') || (p.startsWith('/') ? '/' : p);
}

async function deriveStellarKeypair(mnemonicPhrase: string): Promise<Keypair> {
  const seed = await mnemonicToSeed(mnemonicPhrase);
  const { key } = derivePath(STELLAR_DERIVATION_PATH, Buffer.from(seed).toString('hex'));
  return Keypair.fromRawEd25519Seed(key as Buffer);
}

/**
 * Writable app data root for native SQLite + circuits.
 *
 * Order:
 * 1. EXPO_PUBLIC_SPP_DATA_DIR
 * 2. Native SppNative.appDataDir() (preferred on device — absolute, no file://)
 * 3. expo-file-system/legacy document/cache (Expo 55+ moved constants off main export)
 * 4. Android package external files fallback (matches adb push dogfood path)
 *
 * Never returns a relative path — that causes Rust create_dir_all under `/` → EROFS.
 */
export function getAppDataRoot(): string {
  const envDir =
    typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_SPP_DATA_DIR
      ? String(process.env.EXPO_PUBLIC_SPP_DATA_DIR).trim()
      : '';
  if (envDir) {
    return `${toNativeFsPath(envDir)}/`;
  }

  const nativeDir = sppNativeAppDataDir();
  if (nativeDir) {
    return `${toNativeFsPath(nativeDir)}/`;
  }

  try {
    // Expo SDK 55+: documentDirectory lives on legacy export, not main package.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const legacy = require('expo-file-system/legacy') as {
      documentDirectory?: string | null;
      cacheDirectory?: string | null;
    };
    const root = legacy.documentDirectory || legacy.cacheDirectory;
    if (root) {
      return `${toNativeFsPath(root)}/`;
    }
  } catch {
    // missing module / Jest
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const FS = require('expo-file-system') as {
      documentDirectory?: string | null;
      cacheDirectory?: string | null;
      Paths?: { document?: { uri?: string }; cache?: { uri?: string } };
    };
    const root =
      FS.documentDirectory ||
      FS.cacheDirectory ||
      FS.Paths?.document?.uri ||
      FS.Paths?.cache?.uri;
    if (root) {
      return `${toNativeFsPath(root)}/`;
    }
  } catch {
    // JS stub / tests
  }

  // Last-resort dogfood path (package id from android applicationId).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require('react-native') as { Platform?: { OS?: string } };
    if (Platform?.OS === 'android') {
      return '/storage/emulated/0/Android/data/com.veilpay.consumer/files/';
    }
  } catch {
    // non-RN
  }

  return '';
}

/**
 * Directory expected to contain:
 * - policy_tx_2_2_proving_key.bin
 * - policy_tx_2_2.wasm
 * - policy_tx_2_2.r1cs
 *
 * Override with EXPO_PUBLIC_SPP_CIRCUITS_DIR. On device, defaults under app data root.
 */
export function getSppCircuitsDir(): string {
  const envDir =
    typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_SPP_CIRCUITS_DIR
      ? String(process.env.EXPO_PUBLIC_SPP_CIRCUITS_DIR).trim()
      : '';
  if (envDir) return toNativeFsPath(envDir);
  const root = getAppDataRoot();
  if (!root) {
    // Relative fallback only for unit tests — ensurePoolSession fails closed on device.
    return 'spp/circuits';
  }
  // root already ends with /
  return `${root}spp/circuits`;
}

export function getSppWalletDbPath(ownerAddress: string): string {
  const safe = ownerAddress.replace(/[^A-Z0-9]/gi, '').slice(0, 12);
  const root = getAppDataRoot();
  if (!root) {
    return `spp/wallet-${safe || 'default'}.sqlite`;
  }
  // root already ends with /
  return `${root}spp/wallet-${safe || 'default'}.sqlite`;
}

export type EnsurePoolSessionOptions = {
  /** Absolute circuits dir override. */
  circuitsDir?: string;
  /** Absolute sqlite path override. */
  storagePath?: string;
};

/**
 * Bind native PrivatePool session for prove/submit.
 * Idempotent: re-opens when called again (replaces prior session).
 */
export async function ensurePoolSession(
  chainKey: string,
  ownerAddress: string,
  options?: EnsurePoolSessionOptions
): Promise<SppNativeOpResult> {
  const config = assertSppEnabled(chainKey);
  if (!/^G[A-Z2-7]{55}$/.test(ownerAddress)) {
    throw new SppClientError('Invalid Stellar address', 'SPP_NO_ACCOUNT');
  }

  const caps = sppNativeCapabilities();
  if (!caps.poolOps) {
    return {
      ok: false,
      code: 'SPP_OPS_NOT_READY',
      op: 'pool_open',
      message:
        'Native poolOps not linked in this APK (derive/ASP only — OTA-safe). Ship preview with SPP_NATIVE_POOL_OPS=1 + appVersion bump for prove/submit.',
    };
  }

  const circuitsDir = toNativeFsPath(options?.circuitsDir ?? getSppCircuitsDir());
  const storagePath = toNativeFsPath(options?.storagePath ?? getSppWalletDbPath(ownerAddress));

  if (!storagePath.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(storagePath)) {
    return {
      ok: false,
      code: 'SPP_STORAGE_PATH',
      op: 'pool_open',
      message:
        'No writable app data directory for SPP SQLite (would hit read-only /). Rebuild with SppNative.appDataDir or set EXPO_PUBLIC_SPP_DATA_DIR.',
    };
  }

  const circuits = await getCircuitsReadinessForDir(circuitsDir);
  if (!circuits.ready) {
    return {
      ok: false,
      code: 'SPP_CIRCUITS_MISSING',
      op: 'pool_open',
      message: circuits.message,
    };
  }

  const words = await getStoredMnemonic();
  if (!words?.length) {
    throw new SppClientError('Wallet mnemonic unavailable', 'SPP_NO_WALLET');
  }

  const keypair = await deriveStellarKeypair(words.join(' '));
  if (keypair.publicKey() !== ownerAddress) {
    throw new SppClientError(
      'Stellar keypair does not match owner address',
      'SPP_ACCOUNT_MISMATCH'
    );
  }

  const secretKey = keypair.secret();

  // First open seeds SDK SQLite privacy keys (same derive as ASP leaf / CLI onboard).
  const { signatureHex } = await signSppKeyDerivationMessage();

  const openConfig = {
    rpcUrl: config.sorobanRpcUrl,
    networkPassphrase: config.networkPassphrase,
    secretKey,
    userAddress: ownerAddress,
    poolContractId: config.poolId,
    storagePath,
    circuitsDir,
    contractConfig: contractConfigFor(config),
    derivationSigHex: signatureHex,
    network: config.network,
    acceptDisclaimer: true,
  };

  return sppNativePoolOpen(JSON.stringify(openConfig));
}

export async function closePoolSession(): Promise<SppNativeOpResult> {
  return sppNativePoolClose();
}

export function contractConfigFor(config: SppDeploymentConfig): Record<string, unknown> {
  return {
    network: config.network,
    deployer: config.deployer,
    admin: config.admin,
    asp_membership: config.aspMembershipId,
    asp_non_membership: config.aspNonMembershipId,
    verifier: config.verifierId,
    public_key_registry: config.registryId,
    pools: [
      {
        poolContractId: config.poolId,
        tokenContractId: config.nativeTokenContractId,
        deploymentLedger: config.deploymentLedger,
        enabled: true,
        asset: { kind: 'native' },
      },
    ],
  };
}
