import { keccak256, stringToBytes, bytesToHex } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { ChainType } from '../stores/walletStore';
import { mnemonicToSeed } from '@scure/bip39';
import { derivePath } from 'ed25519-hd-key';
import { Keypair } from '@solana/web3.js';
import { Ed25519Account } from '@aptos-labs/ts-sdk';
import { Buffer } from 'buffer';

export async function deriveAddressesForAllChains(mnemonicWords: string[], accountIndex: number = 0): Promise<Record<ChainType, string>> {
  const mnemonicPhrase = mnemonicWords.join(' ');
  // EVM standard path: m/44'/60'/0'/0/accountIndex
  const account = mnemonicToAccount(mnemonicPhrase, { path: `m/44'/60'/0'/0/${accountIndex}` });
  
  // Use private key hex as seed for mock derivation (for remaining mocks)
  const hdKey = account.getHdKey();
  const seedHex = bytesToHex(hdKey.privateKey!);

  // 1. EVM
  const evmAddress = account.address.toLowerCase();

  // 2. SVM (Genuine Solana Derivation)
  // Derive seed asynchronously to avoid blocking the main thread and ensure RN compatibility
  const seed = await mnemonicToSeed(mnemonicPhrase);
  // Solana standard path: m/44'/501'/accountIndex'/0'
  const derivedSeed = derivePath(`m/44'/501'/${accountIndex}'/0'`, Buffer.from(seed).toString('hex')).key;
  const solanaKeypair = Keypair.fromSeed(derivedSeed);
  const solanaAddress = solanaKeypair.publicKey.toBase58();

  // 3. MVM (Genuine Aptos Derivation)
  // Derive Aptos standard path: m/44'/637'/${accountIndex}'/0'/0'
  const aptosAccount = Ed25519Account.fromDerivationPath({ path: `m/44'/637'/${accountIndex}'/0'/0'`, mnemonic: mnemonicPhrase });
  const aptosAddress = aptosAccount.accountAddress.toString();

  // 4. XLM (Genuine Stellar Derivation)
  // Derive Stellar standard path: m/44'/148'/${accountIndex}'
  const stellarDerivedSeed = derivePath(`m/44'/148'/${accountIndex}'`, Buffer.from(seed).toString('hex')).key;
  // We use dynamic import for stellar-sdk to keep initial bundle size small, 
  // just like we do in multiChainSigner.ts
  const StellarSdk = await import('stellar-sdk');
  const stellarKeypair = StellarSdk.Keypair.fromRawEd25519Seed(stellarDerivedSeed as Buffer);
  const stellarAddress = stellarKeypair.publicKey();

  return {
    evm: evmAddress,
    svm: solanaAddress,
    mvm: aptosAddress,
    xlm: stellarAddress,
  };
}

function encodeBase58Mock(hex: string): string {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < hex.length; i += 2) {
    const byte = parseInt(hex.substring(i, i + 2), 16);
    result += chars[byte % chars.length];
  }
  while (result.length < 32) result += chars[result.length % chars.length];
  return result;
}

function encodeStellarMock(hex: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let result = 'G';
  for (let i = 0; i < hex.length; i += 2) {
    const byte = parseInt(hex.substring(i, i + 2), 16);
    result += chars[byte % chars.length];
  }
  while (result.length < 56) result += chars[result.length % chars.length];
  return result;
}
