import {
  createSendLink,
  createTransactionLink,
  createWalletConnectLink,
  parseDeepLink,
} from '../deepLinking';

describe('deepLinking utilities', () => {
  it('parses a send link created by createSendLink (EVM)', () => {
    const validAddress = '0x1111111111111111111111111111111111111111';
    const link = createSendLink(validAddress, '1.25', 'ETH');
    const parsed = parseDeepLink(link);

    expect(parsed).toEqual({
      action: 'send',
      address: validAddress,
      amount: '1.25',
      token: 'ETH',
    });
  });

  it('parses send links with chainType for Stellar G… addresses', () => {
    // 56-char Stellar public key (G + 55 base32)
    const stellar = 'GBU4T3ZUDWDCD3XQ2E7DNQ7V6A5FPR24LW7B5XH7LY4TMJXMITXG7ZME';
    const link = createSendLink(stellar, {
      amount: '2.5',
      token: 'XLM',
      chainType: 'xlm',
    });
    const parsed = parseDeepLink(link);
    expect(parsed).toEqual({
      action: 'send',
      address: stellar,
      amount: '2.5',
      token: 'XLM',
      chainType: 'xlm',
    });
  });

  it('parses Stellar address without chainType via unknown pattern', () => {
    const stellar = 'GBU4T3ZUDWDCD3XQ2E7DNQ7V6A5FPR24LW7B5XH7LY4TMJXMITXG7ZME';
    const link = `veilpay://send?address=${encodeURIComponent(stellar)}&amount=1`;
    expect(parseDeepLink(link)?.address).toBe(stellar);
  });

  it('parses address-only send links (no amount)', () => {
    const validAddress = '0x1111111111111111111111111111111111111111';
    const link = createSendLink(validAddress, { chainType: 'evm', token: 'ETH' });
    const parsed = parseDeepLink(link);
    expect(parsed).toEqual({
      action: 'send',
      address: validAddress,
      token: 'ETH',
      chainType: 'evm',
    });
  });

  it('parses walletconnect links with encoded uri and chain metadata', () => {
    const wcUri = 'wc:example@2?relay-protocol=irn&symKey=test';
    const link = createWalletConnectLink(wcUri, {
      address: '0x1111111111111111111111111111111111111111',
      chainType: 'evm',
    });

    const parsed = parseDeepLink(link);

    expect(parsed).toEqual({
      action: 'walletconnect',
      uri: wcUri,
      address: '0x1111111111111111111111111111111111111111',
      chainType: 'evm',
    });
  });

  it('parses transaction links and extracts transaction hash', () => {
    const validTxHash = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const link = createTransactionLink(validTxHash);

    expect(parseDeepLink(link)).toEqual({
      action: 'transactions',
      transactionHash: validTxHash,
    });
  });

  it('returns null for unsupported schemes', () => {
    expect(parseDeepLink('https://example.com/pay')).toBeNull();
  });

  it('returns null for unknown actions', () => {
    expect(parseDeepLink('veilpay://unknown?action=true')).toBeNull();
  });

  it('rejects invalid short addresses in send links', () => {
    const link = createSendLink('0xabc123', '1.25', 'ETH');
    expect(parseDeepLink(link)).toBeNull();
  });

  it('rejects invalid short transaction hashes', () => {
    const link = createTransactionLink('0xdeadbeef');
    expect(parseDeepLink(link)).toBeNull();
  });
});
