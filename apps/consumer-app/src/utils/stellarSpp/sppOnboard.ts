/**
 * SPP account onboarding for the consumer app.
 *
 * Pipeline:
 * 1. Sign SEP-53 key-derivation message with local Stellar keypair
 * 2. (Native later) Derive note/enc keys + ASP leaf from signature
 * 3. Permissionless insert_leaf on testnet ASP membership contract
 *
 * Never logs seeds, signatures, or private keys.
 */

import * as Crypto from 'expo-crypto';
import {
  Keypair,
  Networks,
  TransactionBuilder,
  BASE_FEE,
  Contract,
  nativeToScVal,
  Account,
} from 'stellar-sdk';
import { Server, Api, assembleTransaction } from 'stellar-sdk/rpc';
import { mnemonicToSeed } from '@scure/bip39';
import { derivePath } from 'ed25519-hd-key';
import { getStoredMnemonic } from '../transactions';
import {
  assertSppEnabled,
  type SppDeploymentConfig,
} from '../../constants/spp';
import {
  getSppAccount,
  saveSppAccount,
  markAspInserted,
  type SppAccountRecord,
} from '../../stores/sppAccountStore';
import { SppClientError } from './types';
import { sppNativeDeriveKeys } from './sppNativeBridge';

/** Must match packages/vendor/spp/sdk/prover/src/encryption.rs */
export const SPP_KEY_DERIVATION_MESSAGE = 'Privacy Pool Key Derivation [v1]';

const STELLAR_DERIVATION_PATH = "m/44'/148'/0'";

export type SppOnboardResult = {
  account: SppAccountRecord;
  /** True when leaf was computed (native) or already stored. */
  hasLeaf: boolean;
  /** True when insert_leaf succeeded this session or previously. */
  aspReady: boolean;
  message: string;
};

async function deriveStellarKeypair(mnemonicPhrase: string): Promise<Keypair> {
  const seed = await mnemonicToSeed(mnemonicPhrase);
  const { key } = derivePath(STELLAR_DERIVATION_PATH, Buffer.from(seed).toString('hex'));
  return Keypair.fromRawEd25519Seed(key as Buffer);
}

/**
 * Sign the SPP key-derivation message (Ed25519, 64 bytes).
 * Returns hex signature without 0x prefix.
 */
export async function signSppKeyDerivationMessage(): Promise<{
  signatureHex: string;
  publicKey: string;
}> {
  const words = await getStoredMnemonic();
  if (!words?.length) {
    throw new SppClientError('Wallet mnemonic unavailable', 'SPP_NO_WALLET');
  }
  const keypair = await deriveStellarKeypair(words.join(' '));
  const sig = keypair.sign(Buffer.from(SPP_KEY_DERIVATION_MESSAGE, 'utf8'));
  return {
    signatureHex: Buffer.from(sig).toString('hex'),
    publicKey: keypair.publicKey(),
  };
}

async function hashSignatureHex(signatureHex: string): Promise<string> {
  // Fingerprint only (not reversible to the signature). expo-crypto hashes utf8.
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    signatureHex.toLowerCase()
  );
}

/**
 * Persist onboarding fingerprint after signing. Full note keys + leaf require
 * native derive (CAP_ASP_LEAF); until then we only store the sig hash.
 */
export async function recordSppKeySignature(
  chainKey: string,
  ownerAddress: string,
  signatureHex: string
): Promise<SppAccountRecord> {
  assertSppEnabled(chainKey);
  if (!/^G[A-Z2-7]{55}$/.test(ownerAddress)) {
    throw new SppClientError('Invalid Stellar address', 'SPP_NO_ACCOUNT');
  }
  if (!/^[0-9a-fA-F]{128}$/.test(signatureHex)) {
    throw new SppClientError('Invalid derivation signature', 'SPP_INVALID_SIG');
  }

  const config = assertSppEnabled(chainKey);
  const existing = await getSppAccount(chainKey, ownerAddress);
  const record: SppAccountRecord = {
    chainKey,
    ownerAddress,
    derivationSigHashHex: await hashSignatureHex(signatureHex),
    notePublicKeyHex: existing?.notePublicKeyHex,
    encryptionPublicKeyHex: existing?.encryptionPublicKeyHex,
    membershipBlindingHex: existing?.membershipBlindingHex,
    aspLeafDecimal: existing?.aspLeafDecimal,
    aspInserted: existing?.aspInserted ?? false,
    aspInsertTxHash: existing?.aspInsertTxHash,
    updatedAt: Date.now(),
  };

  // Native Poseidon2 derive when libspp_native is loaded (CAP_ASP_LEAF).
  // Always attempt: Kotlin may expose deriveKeys even if capabilities.aspLeaf is false.
  const network = config.network === 'mainnet' ? 'mainnet' : 'testnet';
  const derived = await sppNativeDeriveKeys(signatureHex, network);
  if (derived.ok && derived.leafDecimal) {
    record.aspLeafDecimal = derived.leafDecimal;
    if (derived.notePublicKeyHex) record.notePublicKeyHex = derived.notePublicKeyHex;
    if (derived.encryptionPublicKeyHex) {
      record.encryptionPublicKeyHex = derived.encryptionPublicKeyHex;
    }
    if (derived.membershipBlindingHex) {
      record.membershipBlindingHex = derived.membershipBlindingHex;
    }
  }
  await saveSppAccount(record);
  return record;
}

/**
 * Permissionless ASP membership insert_leaf on testnet (Phase 0 verified).
 * Requires `aspLeafDecimal` on the account record.
 */
export async function insertAspMembershipLeaf(
  chainKey: string,
  ownerAddress: string,
  leafDecimal?: string
): Promise<{ txHash: string; account: SppAccountRecord }> {
  const config = assertSppEnabled(chainKey);
  let account = await getSppAccount(chainKey, ownerAddress);
  const leaf = leafDecimal || account?.aspLeafDecimal;
  if (!leaf || !/^\d+$/.test(leaf)) {
    throw new SppClientError(
      'ASP leaf not available yet. Private keys derive on-device next; leaf comes with native CAP_ASP_LEAF.',
      'SPP_ASP_NO_LEAF'
    );
  }

  if (account?.aspInserted && account.aspInsertTxHash) {
    return { txHash: account.aspInsertTxHash, account };
  }

  const words = await getStoredMnemonic();
  if (!words?.length) {
    throw new SppClientError('Wallet mnemonic unavailable', 'SPP_NO_WALLET');
  }
  const keypair = await deriveStellarKeypair(words.join(' '));
  if (keypair.publicKey() !== ownerAddress) {
    throw new SppClientError('Active address does not match wallet key', 'SPP_ADDRESS_MISMATCH');
  }

  const txHash = await submitInsertLeaf(config, keypair, leaf);

  if (!account) {
    account = {
      chainKey,
      ownerAddress,
      aspLeafDecimal: leaf,
      aspInserted: true,
      aspInsertTxHash: txHash,
      updatedAt: Date.now(),
    };
    await saveSppAccount(account);
  } else {
    const marked = await markAspInserted(chainKey, ownerAddress, txHash);
    account = marked ?? { ...account, aspInserted: true, aspInsertTxHash: txHash };
    if (leaf && account.aspLeafDecimal !== leaf) {
      account = { ...account, aspLeafDecimal: leaf, updatedAt: Date.now() };
      await saveSppAccount(account);
    }
  }

  return { txHash, account };
}

/** Soroban inclusion fee floor (BASE_FEE alone is often too low for invoke). */
const SOROBAN_INSERT_FEE = String(Math.max(Number(BASE_FEE) * 1000, 100_000));

async function submitInsertLeaf(
  config: SppDeploymentConfig,
  keypair: Keypair,
  leafDecimal: string
): Promise<string> {
  const server = new Server(config.sorobanRpcUrl, { allowHttp: false });
  const networkPassphrase =
    config.network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

  let sourceAccount: Account;
  try {
    sourceAccount = await server.getAccount(keypair.publicKey());
  } catch {
    throw new SppClientError(
      'Could not load account from Soroban RPC. Fund the account on testnet first (friendbot).',
      'SPP_RPC_ACCOUNT'
    );
  }

  const contract = new Contract(config.aspMembershipId);
  // U256 leaf as decimal string → ScVal
  let leafScVal;
  try {
    leafScVal = nativeToScVal(BigInt(leafDecimal), { type: 'u256' });
  } catch {
    throw new SppClientError('Invalid ASP leaf value', 'SPP_ASP_NO_LEAF');
  }

  const built = new TransactionBuilder(sourceAccount, {
    fee: SOROBAN_INSERT_FEE,
    networkPassphrase,
  })
    .addOperation(contract.call('insert_leaf', leafScVal))
    .setTimeout(180)
    .build();

  let prepared;
  try {
    const sim = await server.simulateTransaction(built);
    if (Api.isSimulationError(sim)) {
      const errText = String(sim.error || '');
      // Duplicate / already-present leaf: treat as success path for idempotency.
      if (/already|exist|duplicate|leaf/i.test(errText) && /exist|duplicate|present/i.test(errText)) {
        return `sim-idempotent-${leafDecimal.slice(0, 16)}`;
      }
      throw new SppClientError(
        errText || 'ASP insert_leaf simulation failed',
        'SPP_ASP_SIM_FAILED'
      );
    }
    if (Api.isSimulationRestore(sim)) {
      throw new SppClientError(
        'ASP contract needs footprint restore — try again in a moment',
        'SPP_ASP_SIM_FAILED'
      );
    }
    prepared = assembleTransaction(built, sim).build();
  } catch (e) {
    if (e instanceof SppClientError) throw e;
    throw new SppClientError(
      e instanceof Error ? e.message : 'ASP insert simulation failed',
      'SPP_ASP_SIM_FAILED'
    );
  }

  prepared.sign(keypair);

  const send = await server.sendTransaction(prepared);
  if (send.status === 'ERROR') {
    throw new SppClientError(
      send.errorResult?.toString() || 'ASP insert_leaf submit failed',
      'SPP_ASP_SUBMIT_FAILED'
    );
  }
  if (send.status === 'DUPLICATE') {
    // Already submitted — use returned hash if present.
    return send.hash;
  }

  const hash = send.hash;
  // Poll for success (best-effort; hash still useful if network is slow).
  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    try {
      const got = await server.getTransaction(hash);
      if (got.status === Api.GetTransactionStatus.SUCCESS) {
        return hash;
      }
      if (got.status === Api.GetTransactionStatus.FAILED) {
        throw new SppClientError(
          'ASP insert_leaf transaction failed on-chain',
          'SPP_ASP_SUBMIT_FAILED'
        );
      }
    } catch (e) {
      if (e instanceof SppClientError) throw e;
      // Transient getTransaction errors — keep polling.
    }
  }
  // Submitted but not yet confirmed — still mark as hash so UX can advance.
  return hash;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Idempotent full setup when user selects pXLM (Token Selector / Home).
 *
 * 1. Sign derivation if missing
 * 2. Re-derive leaf if missing but keys can be signed again
 * 3. insert_leaf when leaf exists and not yet on-chain
 *
 * Does not throw on ASP insert failure (returns aspReady: false + message)
 * so Home selection still succeeds; hub can retry.
 */
export async function ensureSppAccountReady(
  chainKey: string,
  ownerAddress: string
): Promise<SppOnboardResult> {
  assertSppEnabled(chainKey);
  let account = await getSppAccount(chainKey, ownerAddress);

  // No derivation fingerprint yet → full onboard (sign + derive + insert attempt).
  if (!account?.derivationSigHashHex) {
    return onboardSppAccount(chainKey, ownerAddress);
  }

  // Has signature but no leaf (e.g. first open was pre-NDK) → re-sign & re-derive.
  if (!account.aspLeafDecimal) {
    try {
      const { signatureHex, publicKey } = await signSppKeyDerivationMessage();
      if (publicKey === ownerAddress) {
        account = await recordSppKeySignature(chainKey, ownerAddress, signatureHex);
      }
    } catch (e) {
      return {
        account,
        hasLeaf: false,
        aspReady: false,
        message:
          e instanceof Error
            ? `Privacy keys signed; leaf derive failed: ${e.message}`
            : 'Privacy keys signed; leaf derive pending',
      };
    }
  }

  // Leaf ready, not inserted → permissionless testnet insert_leaf.
  if (account.aspLeafDecimal && !account.aspInserted) {
    try {
      const inserted = await insertAspMembershipLeaf(
        chainKey,
        ownerAddress,
        account.aspLeafDecimal
      );
      return {
        account: inserted.account,
        hasLeaf: true,
        aspReady: true,
        message: 'Private XLM ready — ASP membership on-chain.',
      };
    } catch (e) {
      return {
        account,
        hasLeaf: true,
        aspReady: false,
        message:
          e instanceof Error
            ? `ASP leaf ready; on-chain insert pending: ${e.message}`
            : 'ASP leaf ready; on-chain insert pending',
      };
    }
  }

  return {
    account,
    hasLeaf: Boolean(account.aspLeafDecimal),
    aspReady: Boolean(account.aspInserted),
    message: account.aspInserted
      ? 'Private XLM ready'
      : 'Private XLM set up on this device',
  };
}

/**
 * Full onboard step: sign derivation message, save fingerprint,
 * attempt ASP insert when leaf is already known.
 */
export async function onboardSppAccount(
  chainKey: string,
  ownerAddress: string
): Promise<SppOnboardResult> {
  assertSppEnabled(chainKey);
  const { signatureHex, publicKey } = await signSppKeyDerivationMessage();
  if (publicKey !== ownerAddress) {
    throw new SppClientError('Wallet public key mismatch', 'SPP_ADDRESS_MISMATCH');
  }

  let account = await recordSppKeySignature(chainKey, ownerAddress, signatureHex);
  let aspReady = account.aspInserted;
  let message = 'Privacy derivation signed and saved on device.';

  if (account.aspLeafDecimal && !account.aspInserted) {
    try {
      const inserted = await insertAspMembershipLeaf(
        chainKey,
        ownerAddress,
        account.aspLeafDecimal
      );
      account = inserted.account;
      aspReady = true;
      message = 'Privacy keys prepared and ASP membership registered on-chain.';
    } catch (e) {
      message =
        e instanceof Error
          ? `${message} ASP insert: ${e.message}`
          : `${message} ASP insert pending.`;
    }
  } else if (!account.aspLeafDecimal) {
    message =
      'Privacy derivation signed. ASP leaf compute needs the native module next — then membership can be registered automatically.';
  } else if (account.aspInserted) {
    message = 'Private XLM account already registered for ASP membership.';
    aspReady = true;
  }

  return {
    account,
    hasLeaf: Boolean(account.aspLeafDecimal),
    aspReady,
    message,
  };
}

/** Read-only connectivity check: Soroban RPC + ASP contract id present. */
export async function probeAspMembershipRoot(
  chainKey: string
): Promise<{ ok: boolean; rootHint?: string; error?: string }> {
  try {
    const config = assertSppEnabled(chainKey);
    const server = new Server(config.sorobanRpcUrl, { allowHttp: false });
    const health = await server.getHealth();
    const status = String((health as { status?: string }).status || '').toLowerCase();
    if (status && status !== 'healthy') {
      return { ok: false, error: `Soroban RPC status: ${status}` };
    }
    return {
      ok: true,
      rootHint: `ASP ${config.aspMembershipId.slice(0, 8)}… · Soroban RPC ok`,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'ASP probe failed',
    };
  }
}
