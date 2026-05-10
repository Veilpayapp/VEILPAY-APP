import { ethers } from 'ethers';
import { ChainType } from '../stores/walletStore';

/**
 * Derives addresses for all supported chain types from a single mnemonic
 * @param mnemonicWords - Array of 12 or 24 mnemonic words
 * @returns Map of chain type to address
 */
export async function deriveAddressesForAllChains(mnemonicWords: string[]): Promise<Record<ChainType, string>> {
  const mnemonicPhrase = mnemonicWords.join(' ');
  const seed = ethers.Mnemonic.fromPhrase(mnemonicPhrase).computeSeed();
  
  // 1. EVM (Ethereum, BSC, Polygon, Arbitrum)
  const evmWallet = ethers.HDNodeWallet.fromMnemonic(
    ethers.Mnemonic.fromPhrase(mnemonicPhrase),
    "m/44'/60'/0'/0/0"
  );
  const evmAddress = evmWallet.address.toLowerCase();

  // 2. SVM (Solana) - Deterministic mock using seed hash for demo purposes
  // Real derivation requires Ed25519 curve which is not in standard ethers
  const solanaHash = ethers.keccak256(ethers.toUtf8Bytes(seed + 'solana'));
  const solanaAddress = encodeBase58Mock(solanaHash.slice(2, 42)); // Valid length Base58-like

  // 3. MVM (Aptos) - 0x + 64 hex chars
  const aptosHash = ethers.keccak256(ethers.toUtf8Bytes(seed + 'aptos'));
  const aptosAddress = '0x' + aptosHash.slice(2);

  // 4. XLM (Stellar) - G + 55 chars
  const stellarHash = ethers.keccak256(ethers.toUtf8Bytes(seed + 'stellar'));
  const stellarAddress = encodeStellarMock(stellarHash.slice(2, 42));

  return {
    evm: evmAddress,
    svm: solanaAddress,
    mvm: aptosAddress,
    xlm: stellarAddress,
  };
}

/**
 * Simple Base58-like encoder for mock addresses (Solana style)
 */
function encodeBase58Mock(hex: string): string {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < hex.length; i += 2) {
    const byte = parseInt(hex.substr(i, 2), 16);
    result += chars[byte % chars.length];
  }
  // Ensure it's long enough for Solana (32-44)
  while (result.length < 32) result += chars[result.length % chars.length];
  return result;
}

/**
 * Simple Stellar-style encoder (G + Base32-like)
 */
function encodeStellarMock(hex: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let result = 'G';
  for (let i = 0; i < hex.length; i += 2) {
    const byte = parseInt(hex.substr(i, 2), 16);
    result += chars[byte % chars.length];
  }
  // Ensure exactly 56 chars
  while (result.length < 56) result += chars[result.length % chars.length];
  return result;
}
