import { verifyStellarPayment, fetchStellarPayments } from '../stellarHorizon';

describe('stellarHorizon', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it('verifyStellarPayment matches native XLM payment to invoice address', async () => {
    const to = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWX';
    // Valid-looking 56-char G keys for tests (format only)
    const from = 'GZYXWVUTSRQPONMLKJIHGFEDCBA987654ZYXWVUTSRQPONMLKJIHGFED';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        _embedded: {
          records: [
            {
              type: 'payment',
              type_i: 1,
              from,
              to,
              amount: '12.5',
              asset_type: 'native',
              transaction_hash: 'a'.repeat(64),
              transaction_successful: true,
            },
          ],
        },
      }),
    });

    const r = await verifyStellarPayment({
      chainKey: 'stellar-testnet',
      txHash: 'a'.repeat(64),
      paymentAddress: to,
      amount: '12.50',
      tokenSymbol: 'XLM',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tx.tokenSymbol).toBe('XLM');
      expect(r.tx.amount).toBe('12.5');
    }
  });

  it('verifyStellarPayment binds USDC issuer when provided', async () => {
    const to = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWX';
    const issuer = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        _embedded: {
          records: [
            {
              type: 'payment',
              from: 'GOTHER',
              to,
              amount: '1.00',
              asset_type: 'credit_alphanum4',
              asset_code: 'USDC',
              asset_issuer: issuer,
              transaction_hash: 'b'.repeat(64),
              transaction_successful: true,
            },
          ],
        },
      }),
    });

    const ok = await verifyStellarPayment({
      chainKey: 'stellar',
      txHash: 'b'.repeat(64),
      paymentAddress: to,
      amount: '1',
      tokenSymbol: 'USDC',
      tokenAddress: issuer,
    });
    expect(ok.ok).toBe(true);

    const wrongIssuer = await verifyStellarPayment({
      chainKey: 'stellar',
      txHash: 'b'.repeat(64),
      paymentAddress: to,
      amount: '1',
      tokenSymbol: 'USDC',
      tokenAddress: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    });
    expect(wrongIssuer.ok).toBe(false);
  });

  it('fetchStellarPayments only returns credits to the watched account', async () => {
    const watched = 'GWATCHEDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        _embedded: {
          records: [
            {
              type: 'payment',
              to: 'GOTHER',
              from: watched,
              amount: '5',
              asset_type: 'native',
              transaction_hash: 'c'.repeat(64),
            },
            {
              type: 'payment',
              to: watched,
              from: 'GOTHER',
              amount: '3',
              asset_type: 'native',
              transaction_hash: 'd'.repeat(64),
            },
          ],
        },
      }),
    });

    const rows = await fetchStellarPayments('stellar', watched);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe('3');
    expect(rows[0].toAddress).toBe(watched);
  });
});
