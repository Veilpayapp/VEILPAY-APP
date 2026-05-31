/**
 * First-principles unit test suite for multiChainDerivation.ts
 * Emphasizes deterministic multi-chain address derivation from mnemonics (EVM, SVM, MVM, XLM).
 */

import { deriveAddressesForAllChains } from '../multiChainDerivation';

describe('multiChainDerivation utility tests', () => {
  // A standard 12-word bip39 mnemonic for deterministic testing
  const mnemonicWords = [
    'abandon', 'abandon', 'abandon', 'abandon',
    'abandon', 'abandon', 'abandon', 'abandon',
    'abandon', 'abandon', 'abandon', 'about'
  ];

  it('correctly derives deterministic addresses for all supported chains from mnemonic', async () => {
    const addresses = await deriveAddressesForAllChains(mnemonicWords);

    // Assert overall shape
    expect(addresses).toHaveProperty('evm');
    expect(addresses).toHaveProperty('svm');
    expect(addresses).toHaveProperty('mvm');
    expect(addresses).toHaveProperty('xlm');

    // 1. EVM check: Standard hex starting with 0x, length 42, all lowercase
    expect(addresses.evm).toMatch(/^0x[a-f0-9]{40}$/);

    // 2. SVM check: Solana base58-like format, length should be between 32 and 44 characters
    expect(addresses.svm.length).toBeGreaterThanOrEqual(32);
    expect(addresses.svm.length).toBeLessThanOrEqual(44);
    // Base58 charset validation (no 0, O, I, l)
    expect(addresses.svm).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);

    // 3. MVM check: Aptos-like address format, hex string of 0x + 64 hex characters (total 66 chars)
    expect(addresses.mvm).toMatch(/^0x[a-f0-9]{64}$/);

    // 4. XLM check: Stellar-like address format, starting with 'G' followed by 55 alphanumeric chars (total 56)
    expect(addresses.xlm).toHaveLength(56);
    expect(addresses.xlm.startsWith('G')).toBe(true);
    // Base32 charset check (A-Z, 2-7)
    expect(addresses.xlm).toMatch(/^G[A-Z2-7]{55}$/);
  });
});
