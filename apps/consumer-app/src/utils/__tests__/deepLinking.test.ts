import {
  createSendLink,
  createTransactionLink,
  createWalletConnectLink,
  parseDeepLink,
} from '../deepLinking';

describe('deepLinking utilities', () => {
  it('parses a send link created by createSendLink', () => {
    // Use a valid EVM address (0x + 40 hex chars) so validation passes
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
    // Use a valid EVM tx hash (0x + 64 hex chars) so validation passes
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
