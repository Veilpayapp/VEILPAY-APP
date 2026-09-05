import { bytesToHex } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { ChainType } from '../stores/walletStore';
import { mnemonicToSeed } from '@scure/bip39';
import { derivePath } from 'ed25519-hd-key';
import { Keypair } from '@solana/web3.js';
import { Buffer } from 'buffer';
import * as StellarSdk from 'stellar-sdk';
import { sppNativeMnemonicToSeed } from '../utils/stellarSpp/sppNativeBridge';

// Cache seed to avoid massive blocking delay on every account derivation
let cachedMnemonic: string | null = null;
let cachedSeed: Uint8Array | null = null;

/**
 * Returns the cached BIP39 seed for the given mnemonic, if it was already
 * derived this session. SPP modules (sppOnboard, sppPoolSession) call this
 * to avoid redundant ~1.5s Pbkdf2 calls after the bootstrap path already
 * derived the seed.
 */
export function getCachedMnemonicSeed(mnemonicPhrase: string): Uint8Array | null {
  if (cachedMnemonic === mnemonicPhrase && cachedSeed) {
    return cachedSeed;
  }
  return null;
}

export async function deriveAddressesForAllChains(mnemonicWords: string[], accountIndex: number = 0): Promise<Record<ChainType, string>> {
  const mnemonicPhrase = mnemonicWords.join(' ');
  // EVM standard path: m/44'/60'/0'/0/accountIndex
  const account = mnemonicToAccount(mnemonicPhrase, { path: `m/44'/60'/0'/0/${accountIndex}` });

  // 1. EVM
  const evmAddress = account.address.toLowerCase();

  // Cache the seed derivation because mnemonicToSeed takes ~1.5s on mobile JS thread.
  // Prefer the native (Kotlin) PBKDF2 implementation via the Expo module bridge,
  // which runs on a background thread and completes in ~10-50ms instead of ~1,500ms.
  let seed: Uint8Array;
  if (cachedMnemonic === mnemonicPhrase && cachedSeed) {
    seed = cachedSeed;
  } else {
    const nativeHex = await sppNativeMnemonicToSeed(mnemonicPhrase);
    if (nativeHex) {
      seed = Buffer.from(nativeHex, 'hex');
    } else {
      seed = await mnemonicToSeed(mnemonicPhrase);
    }
    cachedMnemonic = mnemonicPhrase;
    cachedSeed = seed;
  }

  // 2. SVM (Genuine Solana Derivation)
  // Solana standard path: m/44'/501'/accountIndex'/0'
  const derivedSeed = derivePath(`m/44'/501'/${accountIndex}'/0'`, Buffer.from(seed).toString('hex')).key;
  const solanaKeypair = Keypair.fromSeed(derivedSeed);
  const solanaAddress = solanaKeypair.publicKey.toBase58();

  // 3. XLM (Genuine Stellar Derivation)
  // Derive Stellar standard path: m/44'/148'/${accountIndex}'
  const stellarDerivedSeed = derivePath(`m/44'/148'/${accountIndex}'`, Buffer.from(seed).toString('hex')).key;
  const stellarKeypair = StellarSdk.Keypair.fromRawEd25519Seed(stellarDerivedSeed as Buffer);
  const stellarAddress = stellarKeypair.publicKey();

  return {
    evm: evmAddress,
    svm: solanaAddress,
    xlm: stellarAddress,
  };
}
