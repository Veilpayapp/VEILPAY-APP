import { generateMnemonic as viemGenerateMnemonic, english, mnemonicToAccount } from 'viem/accounts';

export const BIP39_WORDLIST: readonly string[] = english;

export async function generateMnemonic(wordCount: 12 | 24 = 12): Promise<string[]> {
  const strength = wordCount === 12 ? 128 : 256;
  const phrase = viemGenerateMnemonic(english, strength);
  return phrase.split(' ');
}

export async function validateMnemonic(words: string[]): Promise<boolean> {
  if (words.length !== 12 && words.length !== 24) return false;
  try {
    mnemonicToAccount(words.join(' '));
    return true;
  } catch {
    return false;
  }
}

export function generateMnemonicSync(wordCount: 12 | 24 = 12): string[] {
  throw new Error('generateMnemonicSync is deprecated.');
}

export async function deriveAddressFromMnemonic(
  mnemonic: string[],
  options: { skipValidation?: boolean } = {}
): Promise<string> {
  if (!options.skipValidation) {
    const isValid = await validateMnemonic(mnemonic);
    if (!isValid) throw new Error('Invalid mnemonic phrase');
  }
  const account = mnemonicToAccount(mnemonic.join(' '), { path: "m/44'/60'/0'/0/0" });
  return account.address;
}

export async function deriveMultipleAddressesFromMnemonic(
  mnemonic: string[],
  count: number = 5
): Promise<string[]> {
  const isValid = await validateMnemonic(mnemonic);
  if (!isValid) throw new Error('Invalid mnemonic phrase');
  const phrase = mnemonic.join(' ');
  const addresses: string[] = [];
  for (let i = 0; i < count; i++) {
    addresses.push(mnemonicToAccount(phrase, { path: `m/44'/60'/0'/0/${i}` }).address);
  }
  return addresses;
}

export default {
  generateMnemonic,
  generateMnemonicSync,
  validateMnemonic,
  deriveAddressFromMnemonic,
  deriveMultipleAddressesFromMnemonic,
  BIP39_WORDLIST,
};
