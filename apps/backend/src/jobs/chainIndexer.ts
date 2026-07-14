/**
 * Veilpay Multi-Chain Indexer (Solana, Stellar)
 *
 * Periodically polls the Goldrush API for incoming transactions matching
 * pending invoices on SVM / XLM chains.
 *
 * REL-001 / PERF-002:
 *  - group invoices by (chainKey, paymentAddress) so each address is fetched once
 *  - normalize token amounts for decimal-safe matching
 *  - cap concurrent address fetches
 */

import { prisma } from '../lib/prisma';
import { fetchGoldrushTransactions } from '../services/goldrush';
import { fetchStellarPayments } from '../services/stellarHorizon';
import { processPaymentMatch } from '../services/paymentProcessor';
import { withRedisLock } from '../lib/redisLock';
import type { GoldrushTxResponse } from '../services/goldrush';

let indexerInterval: NodeJS.Timeout | null = null;
const POLL_INTERVAL_MS = 15_000; // 15 seconds
const MAX_CONCURRENT_ADDRESS_FETCHES = 8;
/**
 * PERF-002: cap how many pending invoices we load per sweep so a large
 * backlog cannot force a full-table scan + Goldrush fan-out every 15s.
 * Prefer soonest-to-expire invoices so payments near deadline are not starved.
 */
export const MAX_PENDING_INVOICES_PER_SWEEP = 200;

/**
 * Normalize a decimal amount string for comparison (strip trailing zeros,
 * fix leading zeros, treat empty as "0"). Avoids exact-string mismatches
 * like "1.0" vs "1.00" vs "1".
 */
export function normalizeAmountString(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return '0';
  const s = String(raw).trim();
  if (!s) return '0';
  if (!/^-?\d+(\.\d+)?$/.test(s)) return s.toLowerCase();
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const [wholeRaw, fracRaw = ''] = body.split('.');
  const whole = wholeRaw.replace(/^0+(?=\d)/, '') || '0';
  const frac = fracRaw.replace(/0+$/, '');
  const out = frac ? `${whole}.${frac}` : whole;
  return neg && out !== '0' ? `-${out}` : out;
}

export function amountsMatch(
  a: string | number | null | undefined,
  b: string | number | null | undefined
): boolean {
  return normalizeAmountString(a) === normalizeAmountString(b);
}

function symbolsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a || '').trim().toUpperCase() === (b || '').trim().toUpperCase();
}

/** Case-insensitive payment address equality (EVM hex / SVM base58 / XLM). */
export function addressesMatch(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

export async function sweepPendingInvoices(): Promise<void> {
  try {
    const now = new Date();
    const pendingInvoices = await prisma.invoice.findMany({
      where: {
        status: 'pending',
        chainKey: {
          in: [
            'solana',
            'solana-devnet',
            'stellar',
            'stellar-testnet',
          ],
        },
        paymentAddress: { not: null },
        // Skip already-expired invoices (expiry worker owns cancel); reduces noise.
        expiresAt: { gt: now },
      },
      orderBy: [
        { expiresAt: 'asc' },
        { createdAt: 'asc' },
      ],
      take: MAX_PENDING_INVOICES_PER_SWEEP,
      include: {
        merchant: true,
      },
    });

    if (pendingInvoices.length === 0) return;

    // Group by chain+address so we fetch each address once per sweep.
    type Inv = (typeof pendingInvoices)[number];
    const groups = new Map<string, Inv[]>();
    for (const invoice of pendingInvoices) {
      if (!invoice.paymentAddress) continue;
      const key = `${invoice.chainKey}::${invoice.paymentAddress.toLowerCase()}`;
      const list = groups.get(key) || [];
      list.push(invoice);
      groups.set(key, list);
    }

    const groupEntries = Array.from(groups.entries());

    await mapPool(groupEntries, MAX_CONCURRENT_ADDRESS_FETCHES, async ([key, invoices]) => {
      const [chainKey, address] = key.split('::');
      // address was lowercased for the key — prefer original paymentAddress casing
      const paymentAddress = invoices[0]?.paymentAddress || address;
      try {
        const txs = await fetchPaymentsForChain(chainKey, paymentAddress);
        for (const invoice of invoices) {
          const invoicePaymentAddress = invoice.paymentAddress || paymentAddress;
          for (const tx of txs) {
            // Recipient is load-bearing: never confirm on amount/symbol alone
            // (multi-leg txs can include an unrelated Transfer of the same size).
            if (!addressesMatch(tx.toAddress, invoicePaymentAddress)) {
              continue;
            }
            if (
              amountsMatch(tx.amount, invoice.amount) &&
              symbolsMatch(tx.tokenSymbol, invoice.tokenSymbol)
            ) {
              // eslint-disable-next-line no-console
              console.log(
                `[ChainIndexer] Found matching payment for invoice ${invoice.id} on ${invoice.chainKey}`
              );
              await processPaymentMatch(
                {
                  id: invoice.id,
                  merchantId: invoice.merchantId,
                  chainKey: invoice.chainKey,
                  tokenSymbol: invoice.tokenSymbol,
                  amount: invoice.amount.toString(),
                  privacyLevel: invoice.privacyLevel,
                },
                tx
              );
              break; // one match per invoice per sweep
            }
          }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          `[ChainIndexer] Fetch failed for ${chainKey}/${paymentAddress}:`,
          err
        );
      }
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[ChainIndexer] Error sweeping invoices:`, error);
  }
}

async function fetchPaymentsForChain(
  chainKey: string,
  paymentAddress: string
): Promise<GoldrushTxResponse[]> {
  const key = chainKey.trim().toLowerCase();
  if (key === 'stellar' || key === 'stellar-testnet') {
    return fetchStellarPayments(chainKey, paymentAddress);
  }
  return fetchGoldrushTransactions(chainKey, paymentAddress);
}

export function startChainIndexer(): void {
  if (indexerInterval) return;
  // eslint-disable-next-line no-console
  console.log(`[ChainIndexer] Starting Goldrush polling worker...`);
  indexerInterval = setInterval(() => {
    withRedisLock('chain_indexer', 10000, async () => {
      await sweepPendingInvoices();
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[ChainIndexer] Unhandled sweep error:', err);
    });
  }, POLL_INTERVAL_MS);
}

export function stopChainIndexer(): void {
  if (indexerInterval) {
    clearInterval(indexerInterval);
    indexerInterval = null;
    // eslint-disable-next-line no-console
    console.log(`[ChainIndexer] Polling worker stopped.`);
  }
}
