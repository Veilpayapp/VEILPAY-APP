import {
  isValidTokenAddressForChain,
  isValidEvmTokenAddress,
  isValidSolanaMint,
  isValidStellarIssuer,
  chainFamily,
} from '../tokenAddress';

describe('tokenAddress validation', () => {
  it('classifies chain families', () => {
    expect(chainFamily('ethereum')).toBe('evm');
    expect(chainFamily('solana')).toBe('svm');
    expect(chainFamily('stellar-testnet')).toBe('xlm');
  });

  it('accepts EVM 0x addresses', () => {
    expect(isValidEvmTokenAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')).toBe(true);
    expect(isValidTokenAddressForChain('ethereum', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48').ok).toBe(
      true
    );
  });

  it('rejects Stellar issuer on EVM chain', () => {
    const r = isValidTokenAddressForChain(
      'ethereum',
      'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
    );
    expect(r.ok).toBe(false);
  });

  it('accepts Solana mint base58', () => {
    expect(
      isValidSolanaMint('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
    ).toBe(true);
    expect(
      isValidTokenAddressForChain(
        'solana',
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      ).ok
    ).toBe(true);
  });

  it('accepts Stellar G issuer', () => {
    expect(
      isValidStellarIssuer('GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN')
    ).toBe(true);
    expect(
      isValidTokenAddressForChain(
        'stellar',
        'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
      ).ok
    ).toBe(true);
  });

  it('rejects S secret seeds as Stellar tokenAddress', () => {
    // S… is 56 chars of base32 too — but must start with G
    const r = isValidTokenAddressForChain(
      'stellar',
      'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    );
    expect(r.ok).toBe(false);
  });
});
