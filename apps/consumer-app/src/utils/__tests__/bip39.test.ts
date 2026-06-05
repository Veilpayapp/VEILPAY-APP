const mockWordList = Array.from({ length: 2048 }, (_, index) => `word-${index}`);

jest.mock('viem/accounts', () => ({
  __esModule: true,
  english: mockWordList,
  generateMnemonic: jest.fn(() => [
    'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'abandon',
    'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'about',
  ].join(' ')),
  mnemonicToAccount: jest.fn(() => ({
    address: '0x4444444444444444444444444444444444444444',
  })),
}));

const { generateMnemonic: viemGenerate, mnemonicToAccount } = require('viem/accounts');
const {
  BIP39_WORDLIST,
  deriveAddressFromMnemonic,
  generateMnemonic,
  generateMnemonicSync,
  validateMnemonic,
} = require('../bip39');

describe('bip39 utility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('generates canonical mnemonics using viem', async () => {
    const words = await generateMnemonic(12);

    expect(viemGenerate).toHaveBeenCalledTimes(1);
    expect(words).toHaveLength(12);
    expect(words[0]).toBe('abandon');
    expect(words[11]).toBe('about');
  });

  it('validates canonical phrases', async () => {
    const canonicalMnemonic = [
      'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'abandon',
      'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'about',
    ];

    await expect(validateMnemonic(canonicalMnemonic)).resolves.toBe(true);
  });

  it('derives an ethereum address from a mnemonic using viem', async () => {
    const canonicalMnemonic = [
      'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'abandon',
      'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'about',
    ];

    const address = await deriveAddressFromMnemonic(canonicalMnemonic, { skipValidation: true });

    expect(mnemonicToAccount).toHaveBeenCalledWith(canonicalMnemonic.join(' '), { path: "m/44'/60'/0'/0/0" });
    expect(address).toBe('0x4444444444444444444444444444444444444444');
  });

  it('throws for the deprecated synchronous generator', () => {
    expect(() => generateMnemonicSync(12)).toThrow(/deprecated/i);
  });

  it('exposes the expected BIP-39 wordlist size', () => {
    expect(BIP39_WORDLIST).toHaveLength(2048);
  });
});
