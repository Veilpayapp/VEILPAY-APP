import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';
import { OnrampService } from '../lib/onramp';
import { MoonPayService } from '../lib/moonpay';
import { logger } from '../lib/logger';
import { z, ZodError } from 'zod';
import { createStatusToken, verifyStatusToken, InvalidStatusTokenError } from '../utils/onrampStatusToken';

/**
 * Maximum age of an Onramp.money webhook event before we reject it as a
 * potential replay. Mirrors the 5-minute window used by the internal
 * webhook controller (`Math.abs(Date.now() - ts) > 300_000`).
 */
const WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Order statuses we treat as terminal. A webhook that tries to move an
 * order out of one of these states is treated as a replay or out-of-order
 * delivery and rejected, regardless of signature freshness.
 */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'cancelled',
  'failed',
]);

const CreateOrderSchema = z.object({
  userAddress: z.string(),
  fiatAmount: z.string().optional(),
  fiatCurrency: z.string().min(1),
  cryptoToken: z.string(),
  chainKey: z.string(),
  flow: z.enum(['buy', 'sell']),
  provider: z.string().optional().default('onramp_money'),
});

/**
 * Schema for the Onramp.money webhook body. We accept the canonical
 * fields plus the legacy aliases that Onramp.money has shipped across
 * releases (`partnerOrderId`, `referenceId`, `id`). Anything not in the
 * schema is silently ignored — `.passthrough()` would let unknown fields
 * leak into prisma updates, so we explicitly strip them with
 * `.strict()` is too noisy (Onramp.money occasionally adds new fields
 * without warning) and `.strip()` is the safe default for an external
 * webhook envelope.
 */
const OnrampWebhookBodySchema = z
  .object({
    status: z
      .union([
        z.literal('pending'),
        z.literal('processing'),
        z.literal('completed'),
        z.literal('success'),
        z.literal('SUCCESS'),
        z.literal('cancelled'),
        z.literal('failed'),
        z.string(), // accept any string; nextStatus mapping handles unknown values
      ])
      .optional(),
    orderId: z.string().min(1).optional(),
    partnerOrderId: z.string().min(1).optional(),
    referenceId: z.string().min(1).optional(),
    id: z.string().min(1).optional(),
    txHash: z.string().min(1).optional(),
    cryptoAmount: z.string().min(1).optional(),
    timestamp: z.union([z.number(), z.string()]).optional(),
    eventTime: z.union([z.number(), z.string()]).optional(),
    eventTimestamp: z.union([z.number(), z.string()]).optional(),
    createdAt: z.union([z.number(), z.string()]).optional(),
    sentAt: z.union([z.number(), z.string()]).optional(),
  })
  .strip();

const MoonPayWebhookBodySchema = z
  .object({
    data: z
      .object({
        externalTransactionId: z.string().optional(),
        status: z.string().optional(),
        cryptoTransactionId: z.string().optional(),
        quoteCurrencyAmount: z.string().optional(),
        createdAt: z.union([z.string(), z.number()]).optional(),
      })
      .optional(),
    createdAt: z.union([z.string(), z.number()]).optional(),
    type: z.string().optional(),
  })
  .strip();

/**
 * Best-effort timestamp extractor for an Onramp.money webhook body.
 * Onramp.money's payload shape varies by event type and version; we look
 * for the most common field names and accept either ms-epoch numbers or
 * ISO-8601 strings. If the provider ships no timestamp at all we return
 * `null` and fall back to the state-transition guard.
 */
function extractEventTimestampMs(body: unknown): number | null {
  if (body === null || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  for (const key of ['timestamp', 'eventTime', 'eventTimestamp', 'createdAt', 'sentAt']) {
    const raw = record[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      // Onramp's docs use seconds-epoch in some events and ms-epoch in others.
      // Anything below 10^12 is almost certainly seconds — promote to ms.
      return raw < 1e12 ? raw * 1000 : raw;
    }
    if (typeof raw === 'string') {
      const asInt = Number.parseInt(raw, 10);
      if (Number.isFinite(asInt) && /^\d+$/.test(raw.trim())) {
        return asInt < 1e12 ? asInt * 1000 : asInt;
      }
      const asDate = Date.parse(raw);
      if (Number.isFinite(asDate)) return asDate;
    }
  }
  return null;
}

/**
 * Normalizes a MoonPay transaction status into the vocabulary understood by
 * the `nextStatus` mapping below.
 *
 * MoonPay emits several in-progress states — `pending`, `waitingPayment`,
 * `waitingAuthorization` — that are NOT failures. Without this mapping they
 * fall through the `nextStatus` chain to `'failed'`, which is a terminal state,
 * so the first in-progress webhook would permanently mark a live order failed
 * and the later `completed` event would be ignored by the terminal-state guard.
 * We map those to `'processing'` so the order stays open until a genuine
 * terminal event (`completed` / `failed`) arrives.
 */
function normalizeMoonPayStatus(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  switch (raw) {
    case 'waitingPayment':
    case 'waitingAuthorization':
    case 'pending':
      return 'processing';
    default:
      // 'completed' and 'failed' pass through unchanged.
      return raw;
  }
}

export const createOnrampUrl = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {  try {
    const data = CreateOrderSchema.parse(req.body);
    const orderId = randomUUID();

    let url = '';
    if (data.provider === 'moonpay') {
      url = MoonPayService.generateSignedUrl({
        userAddress: data.userAddress,
        fiatAmount: data.fiatAmount,
        fiatCurrency: data.fiatCurrency,
        cryptoToken: data.cryptoToken,
        chainKey: data.chainKey,
        orderId,
      });
    } else {
      url = OnrampService.generateSignedUrl({
        userAddress: data.userAddress,
        fiatAmount: data.fiatAmount,
        fiatCurrency: data.fiatCurrency,
        cryptoToken: data.cryptoToken,
        network: OnrampService.mapNetwork(data.chainKey),
        orderId,
      });
    }

    const order = await prisma.fiatOrder.create({
      data: {
        id: orderId,
        orderId,
        provider: data.provider,
        userAddress: data.userAddress,
        fiatAmount: data.fiatAmount || '0',
        fiatCurrency: data.fiatCurrency,
        cryptoToken: data.cryptoToken,
        chainKey: data.chainKey,
        flow: data.flow,
        status: 'pending',
      },
    });

    res.json({
      url,
      orderId: order.id,
      // SEC-005: opaque signed token the consumer-app must present to poll
      // status. Keeps the raw order UUID out of status-poll URLs/logs and
      // prevents anyone without the token from reading order details.
      statusToken: createStatusToken(order.id),
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const messages = error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
      res.status(400).json({ error: 'Validation failed', details: messages });
      return;
    }
    logger.error({ err: error, event: 'onramp_url_create_failed' }, 'Failed to generate Onramp URL');
    res.status(400).json({ error: 'Failed to generate Onramp URL' });
  }
};

// ─── Live crypto rate (Binance) with timeout + short cache ──────────────────

const BINANCE_TIMEOUT_MS = 2_500;
const RATE_CACHE_TTL_MS = 30_000;
const rateCache = new Map<string, { priceInUsdt: number; expiresAt: number }>();

/**
 * Approximate USDT→fiat conversion factors for the currencies the quote ladder
 * supports. These are intentionally coarse — the ladder is a heuristic estimate,
 * not an executable price. INR additionally carries the local P2P premium at
 * which USDT trades on Indian ramps. Unknown currencies fall back to USD parity.
 */
const USDT_TO_FIAT: Record<string, number> = {
  INR: 101.5,
  USD: 1.0,
  EUR: 0.92,
  GBP: 0.79,
};

/**
 * Fetches the USDT price of `cryptoToken` from Binance, bounded by a timeout and
 * cached briefly so the hot quotes path never blocks on a slow/hung upstream.
 * Returns null when the symbol is unavailable (e.g. USDT itself, which has no
 * USDTUSDT pair) or the request fails/aborts.
 */
async function fetchCryptoUsdtPrice(token: string): Promise<number | null> {
  const symbol = `${token}USDT`;
  const cached = rateCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.priceInUsdt;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BINANCE_TIMEOUT_MS);
  try {
    const tickerRes = await fetch(
      `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`,
      { signal: controller.signal },
    );
    if (!tickerRes.ok) return null;
    const data = (await tickerRes.json()) as { price?: string };
    const priceInUsdt = data && data.price ? parseFloat(data.price) : NaN;
    if (!Number.isFinite(priceInUsdt) || priceInUsdt <= 0) return null;
    rateCache.set(symbol, { priceInUsdt, expiresAt: Date.now() + RATE_CACHE_TTL_MS });
    return priceInUsdt;
  } catch (e) {
    logger.warn({ err: e }, 'Failed to fetch live rates from Binance, using fallback');
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export const getOnrampQuotes = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  try {
    const { fiatAmount, fiatCurrency, cryptoToken = 'ETH', flow = 'buy' } = req.query;
    if (!fiatAmount) {
      res.status(400).json({ error: 'fiatAmount is required' });
      return;
    }

    if (!fiatCurrency || typeof fiatCurrency !== 'string') {
      res.status(400).json({ error: 'fiatCurrency is required' });
      return;
    }

    const amount = parseFloat(fiatAmount as string);

    // Resolve the base rate as "fiat units per 1 crypto token" in the currency
    // the caller actually requested (the quote math divides amount by baseRate).
    const currency = (typeof fiatCurrency === 'string' ? fiatCurrency : 'INR').toUpperCase();
    const usdtToFiat = USDT_TO_FIAT[currency] ?? USDT_TO_FIAT.USD;
    const token = String(cryptoToken).toUpperCase();
    const isStable = token === 'USDT' || token === 'USDC';

    // Fallback base rate (used if the live price is unavailable). Expressed in
    // USDT first, then converted to the requested fiat so non-INR quotes are
    // no longer scaled with the INR premium.
    const fallbackUsdt = isStable ? 1 : 2500;
    let baseRate = fallbackUsdt * usdtToFiat;

    // Stablecoins peg ~1 USDT, so skip the (nonexistent) USDTUSDT lookup.
    const priceInUsdt = isStable ? 1 : await fetchCryptoUsdtPrice(token);
    if (priceInUsdt && Number.isFinite(priceInUsdt)) {
      baseRate = priceInUsdt * usdtToFiat;
    }
    
    // ── Estimated quote construction ──────────────────────────────────────
    // Per-provider assumptions (as of July 2025, subject to provider API updates):
    //   spread:      markup on baseRate as a multiplier (0.01 = 1% spread).
    //   providerFeePct: percentage of fiatAmount charged by the provider.
    //   networkFeeUsd: flat USD network fee (only applies to on-chain buys;
    //                  sell settles to fiat so no on-chain send fee is quoted).
    //     onramp_money ~$0.50, moonpay ~$0.80, transak ~$0.60.
    // These are estimates for the quote comparison UI — the actual fees are
    // charged by the provider at transaction time.
    const PROVIDER_SPECS = [
      { provider: 'onramp_money', spread: 0.01, providerFeePct: 0.01, networkFeeUsd: 0.5 },
      { provider: 'moonpay', spread: 0.025, providerFeePct: 0.025, networkFeeUsd: 0.8 },
      { provider: 'transak', spread: 0.02, providerFeePct: 0.02, networkFeeUsd: 0.6 },
    ];

    const isBuy = flow === 'buy';

    const quotes = PROVIDER_SPECS.map((spec) => {
      // Effective per-token price including the provider's spread.
      //   buy:  you pay MORE fiat per token  → rate = baseRate * (1 + spread)
      //   sell: you receive LESS fiat per token → rate = baseRate * (1 - spread)
      const effectiveRate = isBuy
        ? baseRate * (1 + spec.spread)
        : baseRate * (1 - spec.spread);

      // Crypto side of the quote.
      //   buy:  amount fiat buys  amount / effectiveRate tokens (more = better)
      //   sell: amount fiat requires amount / effectiveRate tokens to be sold.
      //         A worse spread lowers effectiveRate, so MORE crypto is needed
      //         (more = worse) — the opposite direction from buy.
      const estimatedCrypto = amount / effectiveRate;

      const providerFee = amount * spec.providerFeePct;
      const networkFee = isBuy ? spec.networkFeeUsd * usdtToFiat : 0;

      // True bottom line for ranking, expressed in fiat and fee-inclusive:
      //   buy:  net fiat value of crypto received, minus fees you also pay.
      //         (higher net value for the same fiat spend = better deal)
      //   sell: total fiat cost of the crypto you hand over, plus fees.
      //         (lower cost = better deal)
      const cryptoValueFiat = estimatedCrypto * baseRate;
      const netValue = isBuy
        ? cryptoValueFiat - providerFee - networkFee
        : cryptoValueFiat + providerFee + networkFee;

      return {
        provider: spec.provider,
        estimatedCryptoAmount: estimatedCrypto.toFixed(6),
        exchangeRate: effectiveRate.toFixed(2),
        providerFee: providerFee.toFixed(2),
        networkFee: networkFee.toFixed(2),
        fiatCurrency: currency,
        // Internal ranking key — not part of the public response.
        _netValue: netValue,
      };
    });

    // Rank so index 0 is the genuine best deal (fee-inclusive):
    //   buy  → highest net value received first
    //   sell → lowest total cost first
    quotes.sort((a, b) => (isBuy ? b._netValue - a._netValue : a._netValue - b._netValue));

    // Strip the internal ranking key before returning to clients.
    const publicQuotes = quotes.map(({ _netValue, ...q }) => q);

    logger.info({
      event: 'onramp_quotes_served',
      fiatCurrency: currency,
      cryptoToken: token,
      flow,
      fiatAmount: amount,
      quoteCount: publicQuotes.length,
      providers: publicQuotes.map(q => q.provider),
    }, `Served ${publicQuotes.length} onramp quotes`);

    res.json({ quotes: publicQuotes });
  } catch (error) {
    logger.error({ err: error, event: 'onramp_quotes_failed' }, 'Failed to fetch quotes');
    res.status(500).json({ error: 'Failed to fetch quotes' });
  }
};

export const handleOnrampWebhook = async (
  req: Request & { rawBody?: string },
  res: Response,
  _next: NextFunction,
): Promise<void> => {
  try {
    const onrampSignatureHeader = req.headers['x-onramp-signature'];
    const moonpaySignatureHeader = req.headers['moonpay-signature-v2'];
    
    const onrampSignature = typeof onrampSignatureHeader === 'string' ? onrampSignatureHeader : '';
    const moonpaySignature = typeof moonpaySignatureHeader === 'string' ? moonpaySignatureHeader : '';

    // BE-M4 fix: Use properly typed rawBody for signature verification
    const payload =
      typeof req.rawBody === 'string' ? req.rawBody : JSON.stringify(req.body);

    let isValid = false;
    if (moonpaySignature) {
      isValid = MoonPayService.verifyWebhook(payload, moonpaySignature);
    } else {
      isValid = OnrampService.verifyWebhook(payload, onrampSignature);
    }

    if (!isValid) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    // Schema validation.
    // For Moonpay, their webhook payload looks like: { data: { id, externalTransactionId, cryptoTransactionId, baseCurrencyAmount, status ... }, type: "transaction.updated" }
    let gatewayOrderId = '';
    let status: unknown;
    let txHash: unknown;
    let cryptoAmount: unknown;
    let eventTimestampMs: number | null = null;

    if (moonpaySignature) {
      // Moonpay webhook extraction
      const parsedMoonpay = MoonPayWebhookBodySchema.safeParse(req.body);
      if (parsedMoonpay.success && parsedMoonpay.data.data?.externalTransactionId) {
        const mpData = parsedMoonpay.data.data;
        gatewayOrderId = mpData.externalTransactionId || '';
        // MoonPay emits: 'completed', 'failed', 'pending', 'waitingPayment',
        // 'waitingAuthorization'. Normalize the in-progress states so the
        // nextStatus mapping below doesn't terminalize a live order (see
        // normalizeMoonPayStatus).
        status = normalizeMoonPayStatus(mpData.status);
        txHash = mpData.cryptoTransactionId;
        cryptoAmount = mpData.quoteCurrencyAmount;
        // MoonPay nests the event timestamp under `data` (top-level `createdAt`
        // is not part of the envelope). Fall back to the top level defensively
        // so a freshness window still applies if the shape ever changes.
        const rawCreatedAt = mpData.createdAt ?? parsedMoonpay.data.createdAt;
        const parsedCreatedAt = rawCreatedAt ? new Date(rawCreatedAt).getTime() : NaN;
        eventTimestampMs = Number.isFinite(parsedCreatedAt) ? parsedCreatedAt : null;
      }
    } else {
      // Onramp.money webhook extraction
      eventTimestampMs = extractEventTimestampMs(req.body);
      const parsedBody = OnrampWebhookBodySchema.safeParse(req.body);
      if (!parsedBody.success) {
        res.status(400).json({
          error: 'Invalid webhook body',
          details: parsedBody.error.flatten(),
        });
        return;
      }
      
      const body = parsedBody.data;
      status = body.status;
      txHash = body.txHash;
      cryptoAmount = body.cryptoAmount;
      
      gatewayOrderId =
        typeof body.orderId === 'string' && body.orderId.length > 0
          ? body.orderId
          : typeof body.partnerOrderId === 'string' && body.partnerOrderId.length > 0
            ? body.partnerOrderId
            : typeof body.referenceId === 'string' && body.referenceId.length > 0
              ? body.referenceId
              : typeof body.id === 'string' && body.id.length > 0
                ? body.id
                : '';
    }

    if (!gatewayOrderId) {
      res.status(400).json({ error: 'Missing order identifier' });
      return;
    }

    // Replay protection (defense in depth, runs only after signature passes):
    if (eventTimestampMs !== null) {
      if (Math.abs(Date.now() - eventTimestampMs) > WEBHOOK_MAX_AGE_MS) {
        res.status(401).json({ error: 'Invalid or expired timestamp' });
        return;
      }
    }



    const existingOrder = await prisma.fiatOrder.findFirst({
      where: {
        OR: [{ id: gatewayOrderId }, { orderId: gatewayOrderId }],
      },
    });

    if (!existingOrder) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    // Terminal-state replay guard. Even when the body carried no usable
    // timestamp, a replayed event cannot move an order *out* of a
    // terminal state — that's the actual harm of a replay attack on
    // this endpoint. Returning 200 keeps the provider from retrying.
    if (TERMINAL_STATUSES.has(existingOrder.status)) {
      res.json({ received: true, ignored: 'order already in terminal state' });
      return;
    }

    const normalizedStatus = typeof status === 'string' ? status.toLowerCase() : '';
    const nextStatus =
      normalizedStatus === 'completed' || normalizedStatus === 'success'
        ? 'completed'
        : normalizedStatus === 'processing' || normalizedStatus === 'pending'
          ? normalizedStatus
          : normalizedStatus === 'cancelled'
            ? 'cancelled'
            : 'failed';

    await prisma.fiatOrder.update({
      where: { id: existingOrder.id },
      data: {
        status: nextStatus,
        txHash: typeof txHash === 'string' ? txHash : existingOrder.txHash,
        cryptoAmount: typeof cryptoAmount === 'string' ? cryptoAmount : existingOrder.cryptoAmount,
      },
    });

    // eslint-disable-next-line no-console
    logger.info({
      event: 'onramp_webhook_processed',
      gatewayOrderId,
      previousStatus: existingOrder.status,
      nextStatus,
      txHash: typeof txHash === 'string' ? txHash : undefined,
    }, `Order ${gatewayOrderId} updated to ${nextStatus}`);

    res.json({ received: true });
  } catch (error) {
    logger.error({ err: error, event: 'onramp_webhook_failed' }, 'Onramp webhook processing error');
    res.status(500).json({ error: 'Failed to process webhook' });
  }
};

export const getOnrampStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id: token } = req.params;

    // SEC-005 fix: require a signed opaque status token instead of the raw
    // order UUID. The token is issued once from `POST /api/v1/onramp/url` and
    // verifies an HMAC over the order ID so an attacker who only has the UUID
    // cannot read order details.
    let orderId: string;
    try {
      orderId = verifyStatusToken(token);
    } catch (e) {
      if (e instanceof InvalidStatusTokenError) {
        res.status(401).json({ error: 'Invalid or expired status token' });
        return;
      }
      throw e;
    }

    const order = await prisma.fiatOrder.findFirst({
      where: { OR: [{ id: orderId }, { orderId }] },
    });

    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    // SEC-005 fix: return only the fields the consumer-app needs to render
    // status. `userAddress` is intentionally omitted — the consumer-app
    // already knows the wallet address it submitted at order creation, and
    // exposing it by order ID lets anyone with the token harvest addresses
    // tied to fiat purchases.
    res.json({
      id: order.id,
      orderId: order.orderId,
      provider: order.provider,
      status: order.status,
      flow: order.flow,
      fiatAmount: order.fiatAmount,
      fiatCurrency: order.fiatCurrency,
      cryptoToken: order.cryptoToken,
      cryptoAmount: order.cryptoAmount,
      chainKey: order.chainKey,
      txHash: order.txHash,
    });
  } catch (error) {
    next(error);
  }
};
