/**
 * SPP account onboarding for the consumer app.
 *
 * Pipeline:
 * 1. Sign SEP-53 key-derivation message with local Stellar keypair
 * 2. Derive note/enc keys + ASP leaf from signature (native)
 * 3. Permissionless insert_leaf on testnet ASP membership contract
 * 4. Register note + encryption public keys on the public-key registry
 *    so any other Veilpay account can private-transfer to this G… address
 *
 * Never logs seeds, signatures, or private keys.
 */

import * as Crypto from 'expo-crypto';
import {
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
  BASE_FEE,
  Contract,
  Operation,
  nativeToScVal,
  Account,
} from '@stellar/stellar-sdk';
import { Server, Api, assembleTransaction } from '@stellar/stellar-sdk/rpc';
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
  clearAspInserted,
  markKeysRegistered,
  clearKeysRegistered,
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
  /**
   * True when note+enc public keys are on the public-key registry for this
   * deploy (required to receive private transfers at the G… address).
   */
  keysRegistered: boolean;
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
    aspMembershipContractId: existing?.aspMembershipContractId,
    keysRegistered: existing?.keysRegistered ?? false,
    keysRegisterTxHash: existing?.keysRegisterTxHash,
    registryContractId: existing?.registryContractId,
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

  // Only skip if already registered on *this* ASP contract (redeploy invalidates).
  const sameContract =
    account?.aspMembershipContractId &&
    account.aspMembershipContractId === config.aspMembershipId;
  if (account?.aspInserted && account.aspInsertTxHash && sameContract) {
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
      aspMembershipContractId: config.aspMembershipId,
      keysRegistered: false,
      updatedAt: Date.now(),
    };
    await saveSppAccount(account);
  } else {
    const marked = await markAspInserted(
      chainKey,
      ownerAddress,
      txHash,
      config.aspMembershipId
    );
    account =
      marked ??
      {
        ...account,
        aspInserted: true,
        aspInsertTxHash: txHash,
        aspMembershipContractId: config.aspMembershipId,
      };
    if (leaf && account.aspLeafDecimal !== leaf) {
      account = { ...account, aspLeafDecimal: leaf, updatedAt: Date.now() };
      await saveSppAccount(account);
    }
  }

  return { txHash, account };
}

/**
 * Publish note + encryption public keys to the on-chain public-key registry.
 * Required so other users can private-transfer to this account's G… address.
 * Idempotent for the current registry contract id.
 */
export async function registerPublicKeysOnChain(
  chainKey: string,
  ownerAddress: string
): Promise<{ txHash: string; account: SppAccountRecord }> {
  const config = assertSppEnabled(chainKey);
  let account = await getSppAccount(chainKey, ownerAddress);
  if (!account) {
    throw new SppClientError(
      'Private account not set up yet. Select pXLM first.',
      'SPP_NO_ACCOUNT'
    );
  }

  const noteHex = account.notePublicKeyHex?.replace(/^0x/i, '');
  const encHex = account.encryptionPublicKeyHex?.replace(/^0x/i, '');
  if (!noteHex || !encHex || !/^[0-9a-fA-F]{64}$/.test(noteHex) || !/^[0-9a-fA-F]{64}$/.test(encHex)) {
    throw new SppClientError(
      'Note/encryption public keys not derived yet. Re-select pXLM to finish privacy setup.',
      'SPP_NO_PUBLIC_KEYS'
    );
  }

  const sameRegistry =
    account.registryContractId && account.registryContractId === config.registryId;
  if (account.keysRegistered && account.keysRegisterTxHash && sameRegistry) {
    return { txHash: account.keysRegisterTxHash, account };
  }

  const words = await getStoredMnemonic();
  if (!words?.length) {
    throw new SppClientError('Wallet mnemonic unavailable', 'SPP_NO_WALLET');
  }
  const keypair = await deriveStellarKeypair(words.join(' '));
  if (keypair.publicKey() !== ownerAddress) {
    throw new SppClientError('Active address does not match wallet key', 'SPP_ADDRESS_MISMATCH');
  }

  const txHash = await submitRegisterPublicKeys(
    config,
    keypair,
    ownerAddress,
    noteHex,
    encHex
  );

  const marked = await markKeysRegistered(
    chainKey,
    ownerAddress,
    txHash,
    config.registryId
  );
  account =
    marked ??
    {
      ...account,
      keysRegistered: true,
      keysRegisterTxHash: txHash,
      registryContractId: config.registryId,
      updatedAt: Date.now(),
    };
  if (!marked) {
    await saveSppAccount(account);
  }

  // Index PublicKeyEvent so this device (and soon peers after their sync)
  // can resolve G… → note/enc keys for private transfer.
  try {
    const { ensurePoolSession } = await import('./sppPoolSession');
    const { sppNativePoolSync } = await import('./sppNativeBridge');
    await ensurePoolSession(chainKey, ownerAddress);
    await sppNativePoolSync();
    await new Promise((r) => setTimeout(r, 1500));
    await sppNativePoolSync();
  } catch {
    /* transfer path will sync again */
  }

  return { txHash, account };
}

/** Soroban inclusion fee floor (BASE_FEE alone is often too low for invoke). */
const SOROBAN_INSERT_FEE = String(Math.max(Number(BASE_FEE) * 1000, 100_000));

/**
 * Encode public-key-registry `Account` as ScVal map (symbol keys sorted).
 * Matches packages/vendor/spp/sdk/stellar/src/soroban_encode.rs::register_account_to_scval.
 */
export function encodeRegistryAccountScVal(
  ownerAddress: string,
  notePublicKeyHex: string,
  encryptionPublicKeyHex: string
) {
  const noteHex = notePublicKeyHex.replace(/^0x/i, '');
  const encHex = encryptionPublicKeyHex.replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(noteHex) || !/^[0-9a-fA-F]{64}$/.test(encHex)) {
    throw new SppClientError('Invalid note/encryption public key hex', 'SPP_NO_PUBLIC_KEYS');
  }
  return nativeToScVal(
    {
      encryption_key: Buffer.from(encHex, 'hex'),
      note_key: Buffer.from(noteHex, 'hex'),
      owner: ownerAddress,
    },
    {
      type: {
        encryption_key: ['symbol', 'bytes'],
        note_key: ['symbol', 'bytes'],
        owner: ['symbol', 'address'],
      },
    }
  );
}

async function submitRegisterPublicKeys(
  config: SppDeploymentConfig,
  keypair: Keypair,
  ownerAddress: string,
  notePublicKeyHex: string,
  encryptionPublicKeyHex: string
): Promise<string> {
  const server = new Server(config.sorobanRpcUrl, { allowHttp: false });
  const networkPassphrase =
    config.network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

  let sourceAccount: Account;
  try {
    sourceAccount = await server.getAccount(keypair.publicKey());
  } catch {
    throw new SppClientError(
      config.network === 'mainnet'
        ? 'Could not load account from Soroban RPC. Send at least 2 XLM to this address on the Stellar public network first.'
        : 'Could not load account from Soroban RPC. Fund the account on testnet first (friendbot).',
      'SPP_RPC_ACCOUNT'
    );
  }

  const contract = new Contract(config.registryId);
  let accountScVal;
  try {
    accountScVal = encodeRegistryAccountScVal(
      ownerAddress,
      notePublicKeyHex,
      encryptionPublicKeyHex
    );
  } catch (e) {
    if (e instanceof SppClientError) throw e;
    throw new SppClientError(
      e instanceof Error ? e.message : 'Failed to encode registry account',
      'SPP_NO_PUBLIC_KEYS'
    );
  }

  const built = new TransactionBuilder(sourceAccount, {
    fee: SOROBAN_INSERT_FEE,
    networkPassphrase,
  })
    .addOperation(contract.call('register', accountScVal))
    .setTimeout(180)
    .build();

  let prepared: Transaction;
  try {
    const sim = await server.simulateTransaction(built);
    if (Api.isSimulationError(sim)) {
      const errText = String(sim.error || '');
      // Re-register with same keys is a no-op on-chain; treat as success.
      if (/already|exist|duplicate|noop|no.?op/i.test(errText)) {
        return `sim-idempotent-registry-${ownerAddress.slice(0, 8)}`;
      }
      throw new SppClientError(
        errText || 'Public key registry simulation failed',
        'SPP_REGISTRY_SIM_FAILED'
      );
    }
    if (Api.isSimulationRestore(sim)) {
      throw new SppClientError(
        'Public key registry needs footprint restore — try again in a moment',
        'SPP_REGISTRY_SIM_FAILED'
      );
    }
    prepared = prepareSorobanInvoke(built, sim, networkPassphrase);
  } catch (e) {
    if (e instanceof SppClientError) throw e;
    const msg = e instanceof Error ? e.message : 'Registry register simulation failed';
    if (/Bad union switch/i.test(msg)) {
      throw new SppClientError(
        'Registry register failed: Stellar SDK XDR mismatch (need @stellar/stellar-sdk ≥14.6 for protocol 27). Rebuild the app.',
        'SPP_REGISTRY_SIM_FAILED'
      );
    }
    throw new SppClientError(msg, 'SPP_REGISTRY_SIM_FAILED');
  }

  prepared.sign(keypair);

  const send = await server.sendTransaction(prepared);
  if (send.status === 'ERROR') {
    throw new SppClientError(
      send.errorResult?.toString() || 'Public key registry submit failed',
      'SPP_REGISTRY_SUBMIT_FAILED'
    );
  }
  if (send.status === 'DUPLICATE') {
    return send.hash;
  }

  const hash = send.hash;
  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    try {
      const got = await server.getTransaction(hash);
      if (got.status === Api.GetTransactionStatus.SUCCESS) {
        return hash;
      }
      if (got.status === Api.GetTransactionStatus.FAILED) {
        throw new SppClientError(
          'Public key registry transaction failed on-chain',
          'SPP_REGISTRY_SUBMIT_FAILED'
        );
      }
    } catch (e) {
      if (e instanceof SppClientError) throw e;
    }
  }
  return hash;
}

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
      config.network === 'mainnet'
        ? 'Could not load account from Soroban RPC. Send at least 2 XLM to this address on the Stellar public network first.'
        : 'Could not load account from Soroban RPC. Fund the account on testnet first (friendbot).',
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

  let prepared: Transaction;
  try {
    const sim = await server.simulateTransaction(built);
    if (Api.isSimulationError(sim)) {
      const errText = String(sim.error || '');
      // Duplicate / already-present leaf: treat as success path for idempotency.
      if (/already|exist|duplicate/i.test(errText)) {
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
    // RN/Metro can load two stellar-base copies so `instanceof Transaction`
    // fails inside assembleTransaction.cloneFrom with:
    //   expected a 'Transaction', got: [object Object]
    // Rehydrate via XDR so the envelope is re-parsed by the same Transaction
    // class the app imports (matches cloneFrom's type check in practice).
    prepared = prepareSorobanInvoke(built, sim, networkPassphrase);
  } catch (e) {
    if (e instanceof SppClientError) throw e;
    const msg = e instanceof Error ? e.message : 'ASP insert simulation failed';
    // Protocol XDR mismatch (seen on stellar-sdk 13 vs testnet protocol 27).
    if (/Bad union switch/i.test(msg)) {
      throw new SppClientError(
        'ASP insert failed: Stellar SDK XDR mismatch (need @stellar/stellar-sdk ≥14.6 for protocol 27). Rebuild the app.',
        'SPP_ASP_SIM_FAILED'
      );
    }
    throw new SppClientError(msg, 'SPP_ASP_SIM_FAILED');
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
 * Apply simulation footprint/auth to a Soroban invoke tx.
 *
 * Primary path: SDK `assembleTransaction` (works when a single stellar-base
 * copy is loaded). Fallback rebuilds the tx without `TransactionBuilder.cloneFrom`,
 * which throws `expected a 'Transaction', got: [object Object]` under RN/Metro
 * dual-package resolution.
 */
function prepareSorobanInvoke(
  built: Transaction,
  sim: Api.SimulateTransactionResponse,
  networkPassphrase: string
): Transaction {
  try {
    const viaXdr = new Transaction(built.toXDR(), networkPassphrase);
    return assembleTransaction(viaXdr, sim).build();
  } catch {
    // Manual assemble — no instanceof cloneFrom
  }

  if (!Api.isSimulationSuccess(sim)) {
    throw new SppClientError(
      'ASP simulation did not succeed',
      'SPP_ASP_SIM_FAILED'
    );
  }

  const classicFee = Number.parseInt(built.fee, 10) || 0;
  const resourceFee = Number.parseInt(sim.minResourceFee, 10) || 0;
  // cloneFrom decrements sequence then builder re-increments — match that.
  const sequenceNum = (BigInt(built.sequence) - 1n).toString();
  const source = new Account(built.source, sequenceNum);

  const invokeOp = built.operations[0] as {
    type: string;
    source?: string;
    func?: unknown;
    auth?: unknown[];
  };
  if (!invokeOp || invokeOp.type !== 'invokeHostFunction' || !invokeOp.func) {
    throw new SppClientError(
      'ASP prepare expected a single invokeHostFunction op',
      'SPP_ASP_SIM_FAILED'
    );
  }

  const existingAuth = Array.isArray(invokeOp.auth) ? invokeOp.auth : [];
  const simAuth =
    sim.result && Array.isArray((sim.result as { auth?: unknown[] }).auth)
      ? (sim.result as { auth: unknown[] }).auth
      : [];

  const builder = new TransactionBuilder(source, {
    fee: String(classicFee + resourceFee),
    networkPassphrase,
    // simulation success always carries SorobanDataBuilder
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sorobanData: (sim as any).transactionData.build(),
  });

  builder.addOperation(
    Operation.invokeHostFunction({
      source: invokeOp.source,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      func: invokeOp.func as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      auth: (existingAuth.length > 0 ? existingAuth : simAuth) as any,
    })
  );

  // Required: manual rebuild skips cloneFrom which copies timebounds from `built`.
  return builder.setTimeout(180).build();
}

function isAspReady(account: SppAccountRecord | null, aspMembershipId: string): boolean {
  return Boolean(
    account?.aspInserted && account.aspMembershipContractId === aspMembershipId
  );
}

function isKeysRegistered(
  account: SppAccountRecord | null,
  registryId: string
): boolean {
  return Boolean(
    account?.keysRegistered && account.registryContractId === registryId
  );
}

function finalizeOnboardResult(
  account: SppAccountRecord,
  config: SppDeploymentConfig,
  message: string
): SppOnboardResult {
  const aspReady = isAspReady(account, config.aspMembershipId);
  const keysRegistered = isKeysRegistered(account, config.registryId);
  return {
    account,
    hasLeaf: Boolean(account.aspLeafDecimal),
    aspReady,
    keysRegistered,
    message,
  };
}

/**
 * Soft attempt to publish note/enc keys on the public-key registry.
 * Does not throw — returns updated account + optional error suffix for UX.
 */
async function tryRegisterPublicKeysSoft(
  chainKey: string,
  ownerAddress: string,
  account: SppAccountRecord,
  registryId: string
): Promise<{ account: SppAccountRecord; error?: string }> {
  if (isKeysRegistered(account, registryId)) {
    return { account };
  }
  if (!account.notePublicKeyHex || !account.encryptionPublicKeyHex) {
    return {
      account,
      error:
        'Receive keys not derived yet — re-select pXLM after native privacy setup.',
    };
  }
  try {
    const registered = await registerPublicKeysOnChain(chainKey, ownerAddress);
    return { account: registered.account };
  } catch (e) {
    return {
      account,
      error:
        e instanceof Error
          ? `Receive keys register pending: ${e.message}`
          : 'Receive keys register pending',
    };
  }
}

/**
 * Idempotent full setup when user selects pXLM (Token Selector / Home).
 *
 * 1. Sign derivation if missing
 * 2. Re-derive leaf if missing but keys can be signed again
 * 3. insert_leaf when leaf exists and not yet on-chain
 * 4. register note+enc pubkeys on public-key registry (receive private transfers)
 *
 * Does not throw on ASP/registry failure (returns flags + message)
 * so Home selection still succeeds; hub can retry.
 */
export async function ensureSppAccountReady(
  chainKey: string,
  ownerAddress: string
): Promise<SppOnboardResult> {
  const config = assertSppEnabled(chainKey);
  let account = await getSppAccount(chainKey, ownerAddress);

  // Redeploy: SecureStore may still say "inserted" for an old ASP contract.
  if (
    account?.aspInserted &&
    account.aspMembershipContractId &&
    account.aspMembershipContractId !== config.aspMembershipId
  ) {
    account = (await clearAspInserted(chainKey, ownerAddress)) ?? {
      ...account,
      aspInserted: false,
      aspInsertTxHash: undefined,
      aspMembershipContractId: undefined,
    };
  } else if (account?.aspInserted && !account.aspMembershipContractId) {
    // Legacy record without contract id (pre-redeploy-aware builds) — force re-register.
    account = (await clearAspInserted(chainKey, ownerAddress)) ?? {
      ...account,
      aspInserted: false,
      aspInsertTxHash: undefined,
    };
  }

  // Redeploy: clear registry flags when contract id changed.
  if (
    account?.keysRegistered &&
    account.registryContractId &&
    account.registryContractId !== config.registryId
  ) {
    account = (await clearKeysRegistered(chainKey, ownerAddress)) ?? {
      ...account,
      keysRegistered: false,
      keysRegisterTxHash: undefined,
      registryContractId: undefined,
    };
  } else if (account?.keysRegistered && !account.registryContractId) {
    account = (await clearKeysRegistered(chainKey, ownerAddress)) ?? {
      ...account,
      keysRegistered: false,
      keysRegisterTxHash: undefined,
    };
  }

  // No derivation fingerprint yet → full onboard (sign + derive + insert + register).
  // Soft-fail: deposit/home paths treat ensure as best-effort; never throw wallet/RPC gaps.
  if (!account?.derivationSigHashHex) {
    try {
      return await onboardSppAccount(chainKey, ownerAddress);
    } catch (e) {
      const empty: SppAccountRecord = account ?? {
        chainKey,
        ownerAddress,
        aspInserted: false,
        keysRegistered: false,
        updatedAt: Date.now(),
      };
      return finalizeOnboardResult(
        empty,
        config,
        e instanceof Error ? e.message : 'Private account setup pending'
      );
    }
  }

  // Narrowed: derivation fingerprint exists.
  let current = account;

  // Has signature but no leaf (e.g. first open was pre-NDK) → re-sign & re-derive.
  if (!current.aspLeafDecimal || !current.notePublicKeyHex || !current.encryptionPublicKeyHex) {
    try {
      const { signatureHex, publicKey } = await signSppKeyDerivationMessage();
      if (publicKey === ownerAddress) {
        current = await recordSppKeySignature(chainKey, ownerAddress, signatureHex);
      }
    } catch (e) {
      return finalizeOnboardResult(
        current,
        config,
        e instanceof Error
          ? `Privacy keys signed; leaf derive failed: ${e.message}`
          : 'Privacy keys signed; leaf derive pending'
      );
    }
  }

  // Leaf ready, not inserted on this ASP contract → permissionless testnet insert_leaf.
  const needsInsert =
    Boolean(current.aspLeafDecimal) &&
    (!current.aspInserted ||
      current.aspMembershipContractId !== config.aspMembershipId);

  if (needsInsert && current.aspLeafDecimal) {
    try {
      const inserted = await insertAspMembershipLeaf(
        chainKey,
        ownerAddress,
        current.aspLeafDecimal
      );
      current = inserted.account;
      // Index LeafAdded into native sqlite so prove can see membership.
      try {
        const { ensurePoolSession } = await import('./sppPoolSession');
        const { sppNativePoolSync } = await import('./sppNativeBridge');
        await ensurePoolSession(chainKey, ownerAddress);
        await sppNativePoolSync();
        // Second pass — first sync right after insert can miss the new page.
        await new Promise((r) => setTimeout(r, 1500));
        await sppNativePoolSync();
      } catch {
        /* deposit will sync again */
      }
    } catch (e) {
      return finalizeOnboardResult(
        current,
        config,
        e instanceof Error
          ? `ASP leaf ready; on-chain insert pending: ${e.message}`
          : 'ASP leaf ready; on-chain insert pending'
      );
    }
  }

  // Publish keys so other Veilpay accounts can private-transfer to this G… address.
  const reg = await tryRegisterPublicKeysSoft(
    chainKey,
    ownerAddress,
    current,
    config.registryId
  );
  current = reg.account;

  if (reg.error) {
    const aspReady = isAspReady(current, config.aspMembershipId);
    return finalizeOnboardResult(
      current,
      config,
      aspReady
        ? `Private XLM ready to send — ${reg.error}`
        : reg.error
    );
  }

  const aspReady = isAspReady(current, config.aspMembershipId);
  const keysRegistered = isKeysRegistered(current, config.registryId);
  let message = 'Private XLM set up on this device';
  if (aspReady && keysRegistered) {
    message = 'Private XLM ready — can send and receive private transfers';
  } else if (aspReady) {
    message = 'Private XLM ready';
  }

  return finalizeOnboardResult(current, config, message);
}

/**
 * Full onboard step: sign derivation message, save fingerprint,
 * attempt ASP insert + public-key registry when keys are known.
 */
export async function onboardSppAccount(
  chainKey: string,
  ownerAddress: string
): Promise<SppOnboardResult> {
  const config = assertSppEnabled(chainKey);
  const { signatureHex, publicKey } = await signSppKeyDerivationMessage();
  if (publicKey !== ownerAddress) {
    throw new SppClientError('Wallet public key mismatch', 'SPP_ADDRESS_MISMATCH');
  }

  let account = await recordSppKeySignature(chainKey, ownerAddress, signatureHex);
  let message = 'Privacy derivation signed and saved on device.';

  if (account.aspLeafDecimal && !account.aspInserted) {
    try {
      const inserted = await insertAspMembershipLeaf(
        chainKey,
        ownerAddress,
        account.aspLeafDecimal
      );
      account = inserted.account;
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
  }

  // Always try registry when pubkeys exist (even if ASP insert failed — receive
  // path only needs registry; send still needs ASP).
  if (account.notePublicKeyHex && account.encryptionPublicKeyHex) {
    const reg = await tryRegisterPublicKeysSoft(
      chainKey,
      ownerAddress,
      account,
      config.registryId
    );
    account = reg.account;
    if (reg.error) {
      message = `${message} ${reg.error}`;
    } else if (isKeysRegistered(account, config.registryId)) {
      message = `${message} Receive keys published on-chain.`;
    }
  }

  return finalizeOnboardResult(account, config, message);
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
