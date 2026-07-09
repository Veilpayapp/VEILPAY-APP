import { bytesToHex } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { ChainType } from '../stores/walletStore';
import { mnemonicToSeed } from '@scure/bip39';
import { derivePath } from 'ed25519-hd-key';
import { Keypair } from '@solana/web3.js';
import { Buffer } from 'buffer';
import * as StellarSdk from 'stellar-sdk';

// Cache seed to avoid massive blocking delay on every account derivation
let cachedMnemonic: string | null = null;
let cachedSeed: Uint8Array | null = null;

export async function deriveAddressesForAllChains(mnemonicWords: string[], accountIndex: number = 0): Promise<Record<ChainType, string>> {
  const mnemonicPhrase = mnemonicWords.join(' ');
  // EVM standard path: m/44'/60'/0'/0/accountIndex
  const account = mnemonicToAccount(mnemonicPhrase, { path: `m/44'/60'/0'/0/${accountIndex}` });

  // 1. EVM
  const evmAddress = account.address.toLowerCase();

  // Cache the seed derivation because mnemonicToSeed takes ~1.5s on mobile JS thread
  let seed: Uint8Array;
  if (cachedMnemonic === mnemonicPhrase && cachedSeed) {
    seed = cachedSeed;
  } else {
    seed = await mnemonicToSeed(mnemonicPhrase);
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
