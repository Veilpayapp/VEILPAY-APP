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
  sppNativeCapabilities,
  sppNativePoolClose,
  sppNativePoolOpen,
  type SppNativeOpResult,
} from './sppNativeBridge';

const STELLAR_DERIVATION_PATH = "m/44'/148'/0'";

/** Testnet deployments.json body (matches packages/vendor/spp). */
export const SPP_TESTNET_CONTRACT_CONFIG = {
  network: 'testnet',
  deployer: 'GDF4BXPQY5N4BEO24UIHM4NVB62MW7HDWH7SVHKLVZAMLP5IIHCFQORC',
  admin: 'GDF4BXPQY5N4BEO24UIHM4NVB62MW7HDWH7SVHKLVZAMLP5IIHCFQORC',
  asp_membership: 'CDSJXWV5JITIQLXNM4AEI53RY2UQLOQBCG6WKYCFPWS5AHBAD3FWAVNH',
  asp_non_membership: 'CBG3BT6KHJM3UQGSUP2GHPQE5FLPEYBFVF47DCDHH6UOYQ6KDT5URJTI',
  verifier: 'CCKNCZXDGM7Z7EHL7PVQEYRDK636TZJIDODO5TSAS5BME2JYGMFR3MU3',
  public_key_registry: 'CB3IAFWZPU5H5MQ4NEMQCWLZJ6PAYZWLAA4DZIRZZCWXSI2WV6C7L556',
  pools: [
    {
      poolContractId: 'CCR7KZOFBDLS3BR6X5YUR4WP7YL4VZIWHXXNFCXTZPRLRODK5U4P4ESH',
      tokenContractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      deploymentLedger: 3479862,
      enabled: true,
      asset: { kind: 'native' },
    },
    {
      poolContractId: 'CAS6HJRISNXG72EOJ4V4YIS4TQOJRIRCZSJRPIBEDN2ALZMJEVAIGPWU',
      tokenContractId: 'CCUUDM434BMZMYWYDITHFXHDMIVTGGD6T2I5UKNX5BSLXLW7HVR4MCGZ',
      deploymentLedger: 3479864,
      enabled: true,
      asset: {
        kind: 'classic',
        code: 'EURC',
        issuer: 'GB3Q6QDZYTHWT7E5PVS3W7FUT5GVAFC5KSZFFLPU25GO7VTC3NM2ZTVO',
      },
    },
  ],
} as const;

async function deriveStellarKeypair(mnemonicPhrase: string): Promise<Keypair> {
  const seed = await mnemonicToSeed(mnemonicPhrase);
  const { key } = derivePath(STELLAR_DERIVATION_PATH, Buffer.from(seed).toString('hex'));
  return Keypair.fromRawEd25519Seed(key as Buffer);
}

/** Optional document/cache root (expo-file-system when linked). */
function getAppDataRoot(): string {
  const envDir =
    typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_SPP_DATA_DIR
      ? String(process.env.EXPO_PUBLIC_SPP_DATA_DIR).trim()
      : '';
  if (envDir) return envDir.replace(/\/?$/, '/');
  try {
    // Optional peer — present in Expo prebuild / release; missing in some Jest setups.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const FS = require('expo-file-system') as {
      documentDirectory?: string | null;
      cacheDirectory?: string | null;
    };
    const root = FS.documentDirectory || FS.cacheDirectory;
    if (root) return root.endsWith('/') ? root : `${root}/`;
  } catch {
    // JS stub / tests
  }
  return '';
}

/**
 * Directory expected to contain:
 * - policy_tx_2_2_proving_key.bin
 * - policy_tx_2_2.wasm
 * - policy_tx_2_2.r1cs
 *
 * Override with EXPO_PUBLIC_SPP_CIRCUITS_DIR. On device, defaults under documentDirectory.
 */
export function getSppCircuitsDir(): string {
  const envDir =
    typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_SPP_CIRCUITS_DIR
      ? String(process.env.EXPO_PUBLIC_SPP_CIRCUITS_DIR).trim()
      : '';
  if (envDir) return envDir;
  const root = getAppDataRoot();
  return root ? `${root}spp/circuits` : 'spp/circuits';
}

export function getSppWalletDbPath(ownerAddress: string): string {
  const safe = ownerAddress.replace(/[^A-Z0-9]/gi, '').slice(0, 12);
  const root = getAppDataRoot();
  const base = root ? `${root}spp` : 'spp';
  return `${base}/wallet-${safe || 'default'}.sqlite`;
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
  const circuitsDir = options?.circuitsDir ?? getSppCircuitsDir();
  const storagePath = options?.storagePath ?? getSppWalletDbPath(ownerAddress);

  const openConfig = {
    rpcUrl: config.sorobanRpcUrl,
    networkPassphrase: config.networkPassphrase,
    secretKey,
    userAddress: ownerAddress,
    poolContractId: config.poolId,
    storagePath,
    circuitsDir,
    contractConfig: contractConfigFor(config),
  };

  return sppNativePoolOpen(JSON.stringify(openConfig));
}

export async function closePoolSession(): Promise<SppNativeOpResult> {
  return sppNativePoolClose();
}

function contractConfigFor(
  config: SppDeploymentConfig
): typeof SPP_TESTNET_CONTRACT_CONFIG | Record<string, unknown> {
  if (config.network === 'testnet') {
    return SPP_TESTNET_CONTRACT_CONFIG;
  }
  return {
    network: config.network,
    deployer: '',
    admin: '',
    asp_membership: config.aspMembershipId,
    asp_non_membership: config.aspNonMembershipId,
    verifier: config.verifierId,
    public_key_registry: config.registryId,
    pools: [
      {
        poolContractId: config.poolId,
        tokenContractId: config.nativeTokenContractId,
        deploymentLedger: 1,
        enabled: true,
        asset: { kind: 'native' },
      },
    ],
  };
}
