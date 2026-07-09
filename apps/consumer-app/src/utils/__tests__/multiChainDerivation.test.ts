/**
 * Multi-chain address derivation from mnemonics (EVM, SVM, XLM).
 */

import { deriveAddressesForAllChains } from '../multiChainDerivation';

describe('multiChainDerivation utility tests', () => {
  const mnemonicWords = [
    'abandon',
    'abandon',
    'abandon',
    'abandon',
    'abandon',
    'abandon',
    'abandon',
    'abandon',
    'abandon',
    'abandon',
    'abandon',
    'about',
  ];

  it('correctly derives deterministic addresses for all supported chains from mnemonic', async () => {
    const addresses = await deriveAddressesForAllChains(mnemonicWords);

    expect(addresses).toHaveProperty('evm');
    expect(addresses).toHaveProperty('svm');
    expect(addresses).toHaveProperty('xlm');
    expect(addresses).not.toHaveProperty('mvm');

    expect(addresses.evm).toMatch(/^0x[a-f0-9]{40}$/);

    expect(addresses.svm.length).toBeGreaterThanOrEqual(32);
    expect(addresses.svm.length).toBeLessThanOrEqual(44);
    expect(addresses.svm).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);

    expect(addresses.xlm).toHaveLength(56);
    expect(addresses.xlm.startsWith('G')).toBe(true);
    expect(addresses.xlm).toMatch(/^G[A-Z2-7]{55}$/);
  });
});
