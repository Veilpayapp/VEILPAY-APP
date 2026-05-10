const mockWordList = Array.from({ length: 2048 }, (_, index) => `word-${index}`);

jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn(),
}));

jest.mock('ethers', () => ({
  __esModule: true,
  wordlists: {
    en: {
      locale: 'en',
      getWord: jest.fn((index: number) => mockWordList[index]),
    },
  },
  Mnemonic: {
    fromEntropy: jest.fn(() => ({
      phrase: [
        'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'abandon',
        'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'about',
      ].join(' '),
    })),
    fromPhrase: jest.fn((phrase: string) => {
      const canonicalPhrase = [
        'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'abandon',
        'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'about',
      ].join(' ');

      if (phrase !== canonicalPhrase) {
        throw new Error('invalid checksum');
      }

      return { phrase };
    }),
  },
  HDNodeWallet: {
    fromMnemonic: jest.fn(() => ({
      address: '0x4444444444444444444444444444444444444444',
    })),
  },
}));

const expoCrypto = require('expo-crypto');
const { HDNodeWallet, Mnemonic } = require('ethers');
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

  it('generates canonical mnemonics from secure entropy', async () => {
    (expoCrypto.getRandomBytesAsync as jest.Mock).mockResolvedValue(new Uint8Array(16).fill(7));

    const words = await generateMnemonic(12);

    expect(expoCrypto.getRandomBytesAsync).toHaveBeenCalledWith(16);
    expect(Mnemonic.fromEntropy).toHaveBeenCalledTimes(1);
    expect(words).toHaveLength(12);
    expect(words[0]).toBe('abandon');
    expect(words[11]).toBe('about');
  });

  it('validates canonical phrases and rejects checksum mismatches', async () => {
    const canonicalMnemonic = [
      'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'abandon',
      'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'about',
    ];
    const invalidMnemonic = [
      'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'abandon',
      'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'abandon',
    ];

    await expect(validateMnemonic(canonicalMnemonic)).resolves.toBe(true);
    await expect(validateMnemonic(invalidMnemonic)).resolves.toBe(false);
    expect(Mnemonic.fromPhrase).toHaveBeenCalledTimes(2);
  });

  it('derives an ethereum address from a mnemonic using the standard path', async () => {
    const canonicalMnemonic = [
      'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'abandon',
      'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'about',
    ];

    const address = await deriveAddressFromMnemonic(canonicalMnemonic, { skipValidation: true });

    expect(Mnemonic.fromPhrase).toHaveBeenCalledWith(canonicalMnemonic.join(' '));
    expect(HDNodeWallet.fromMnemonic).toHaveBeenCalledWith(
      expect.objectContaining({ phrase: canonicalMnemonic.join(' ') }),
      "m/44'/60'/0'/0/0"
    );
    expect(address).toBe('0x4444444444444444444444444444444444444444');
  });

  it('throws for the deprecated synchronous generator', () => {
    expect(() => generateMnemonicSync(12)).toThrow(/deprecated/i);
  });

  it('exposes the expected BIP-39 wordlist size', () => {
    expect(BIP39_WORDLIST).toHaveLength(2048);
  });
});