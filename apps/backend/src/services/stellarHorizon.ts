/**
 * Stellar payment verification via Horizon (native XLM + classic assets).
 * Used when GoldRush has no Stellar slug (SEC review residual).
 */

import { amountsMatch } from '../jobs/chainIndexer';
import { getHorizonUrl } from '../lib/rpcEndpoints';
import type { GoldrushTxResponse } from './goldrush';

export class StellarHorizonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StellarHorizonError';
  }
}

interface HorizonPayment {
  id?: string;
  transaction_hash?: string;
  type?: string;
  type_i?: number;
  from?: string;
  to?: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  paging_token?: string;
  transaction_successful?: boolean;
}

/**
 * Fetch payments for a Stellar account and map credits **to** that account
 * into the same shape as GoldRush rows (human amounts).
 */
export async function fetchStellarPayments(
  chainKey: string,
  paymentAddress: string
): Promise<GoldrushTxResponse[]> {
  const base = getHorizonUrl(chainKey);
  if (!base) {
    throw new StellarHorizonError(`Unsupported Stellar chainKey: ${chainKey}`);
  }

  const account = paymentAddress.trim();
  const url =
    `${base}/accounts/${encodeURIComponent(account)}/payments` +
    `?order=desc&limit=50&include_failed=false`;

  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new StellarHorizonError(`Horizon network error: ${msg}`);
  }

  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new StellarHorizonError(
      `Horizon HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`
    );
  }

  const json = (await response.json()) as {
    _embedded?: { records?: HorizonPayment[] };
  };
  const records = json._embedded?.records ?? [];
  const out: GoldrushTxResponse[] = [];

  for (const p of records) {
    if (p.type !== 'payment' && p.type_i !== 1) continue;
    if (p.transaction_successful === false) continue;
    const to = (p.to || '').trim();
    if (!to || to.toLowerCase() !== account.toLowerCase()) continue;

    const txHash = (p.transaction_hash || p.id || '').trim();
    if (!txHash) continue;

    const { symbol, tokenAddress } = assetFromPayment(p);
    out.push({
      txHash,
      fromAddress: (p.from || '').trim(),
      toAddress: to,
      amount: String(p.amount ?? '0'),
      tokenSymbol: symbol,
      blockNumber: 0,
      tokenAddress,
    });
  }

  return out;
}

/**
 * Verify a single Stellar payment by transaction hash against invoice facts.
 */
export async function verifyStellarPayment(args: {
  chainKey: string;
  txHash: string;
  paymentAddress: string;
  amount: string;
  tokenSymbol: string;
  tokenAddress?: string | null;
}): Promise<
  | { ok: true; tx: GoldrushTxResponse }
  | { ok: false; error: string }
> {
  const base = getHorizonUrl(args.chainKey);
  if (!base) {
    return { ok: false, error: `Unsupported Stellar chainKey: ${args.chainKey}` };
  }

  const hash = args.txHash.trim();
  if (!/^[a-fA-F0-9]{64}$/.test(hash)) {
    return { ok: false, error: 'Invalid Stellar transaction hash format' };
  }

  const url =
    `${base}/transactions/${encodeURIComponent(hash)}/payments?limit=50`;

  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Horizon network error: ${msg}` };
  }

  if (response.status === 404) {
    return { ok: false, error: 'Stellar transaction not found on Horizon' };
  }
  if (!response.ok) {
    return { ok: false, error: `Horizon HTTP ${response.status}` };
  }

  const json = (await response.json()) as {
    _embedded?: { records?: HorizonPayment[] };
  };
  const records = json._embedded?.records ?? [];
  const expectedTo = args.paymentAddress.trim();
  const wantSymbol = args.tokenSymbol.trim().toUpperCase();
  const wantIssuer = args.tokenAddress?.trim().toUpperCase() || null;

  for (const p of records) {
    if (p.type !== 'payment' && p.type_i !== 1) continue;
    if (p.transaction_successful === false) continue;
    const to = (p.to || '').trim();
    if (to.toLowerCase() !== expectedTo.toLowerCase()) continue;

    const { symbol, tokenAddress } = assetFromPayment(p);
    if (symbol !== wantSymbol) continue;

    if (wantSymbol !== 'XLM') {
      const issuer = (tokenAddress || '').toUpperCase();
      if (wantIssuer && issuer !== wantIssuer) continue;
      if (!wantIssuer && !issuer) continue;
    }

    if (!amountsMatch(p.amount, args.amount)) continue;

    return {
      ok: true,
      tx: {
        txHash: hash,
        fromAddress: (p.from || '').trim(),
        toAddress: to,
        amount: String(p.amount ?? '0'),
        tokenSymbol: symbol,
        blockNumber: 0,
        tokenAddress: tokenAddress || undefined,
      },
    };
  }

  return {
    ok: false,
    error:
      'No matching Stellar payment to invoice address with amount/token in transaction',
  };
}

function assetFromPayment(p: HorizonPayment): {
  symbol: string;
  tokenAddress?: string;
} {
  if (!p.asset_type || p.asset_type === 'native') {
    return { symbol: 'XLM' };
  }
  const code = (p.asset_code || 'UNKNOWN').toUpperCase();
  const issuer = p.asset_issuer?.trim();
  return { symbol: code, tokenAddress: issuer };
}
