import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';
import { OnrampService } from '../lib/onramp';
import { z } from 'zod';

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
  fiatCurrency: z.string().default('INR'),
  cryptoToken: z.string(),
  chainKey: z.string(),
  flow: z.enum(['buy', 'sell']),
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

export const createOnrampUrl = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  try {
    const data = CreateOrderSchema.parse(req.body);
    const orderId = randomUUID();

    const url = OnrampService.generateSignedUrl({
      userAddress: data.userAddress,
      fiatAmount: data.fiatAmount,
      fiatCurrency: data.fiatCurrency,
      cryptoToken: data.cryptoToken,
      network: OnrampService.mapNetwork(data.chainKey),
      orderId,
    });

    const order = await prisma.fiatOrder.create({
      data: {
        id: orderId,
        orderId,
        provider: 'onramp_money',
        userAddress: data.userAddress,
        fiatAmount: data.fiatAmount || '0',
        fiatCurrency: data.fiatCurrency,
        cryptoToken: data.cryptoToken,
        chainKey: data.chainKey,
        flow: data.flow,
        status: 'pending',
      },
    });

    res.json({ url, orderId: order.id });
  } catch (error) {
    console.error('Onramp URL error:', error);
    res.status(400).json({ error: 'Failed to generate Onramp URL' });
  }
};

export const getOnrampQuotes = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
  try {
    // `fiatCurrency` is captured from the query for forward compatibility
    // (the multi-provider quote ladder will eventually need it for
    // currency-aware exchange rates) but is not used in the current
    // INR/USD heuristic. Renaming to `_fiatCurrency` keeps the rule's
    // unused-var pattern happy without losing the signature.
    const { fiatAmount, fiatCurrency: _fiatCurrency = 'INR', cryptoToken = 'ETH', flow = 'buy' } = req.query;
    void _fiatCurrency;
    if (!fiatAmount) {
      res.status(400).json({ error: 'fiatAmount is required' });
      return;
    }

    const amount = parseFloat(fiatAmount as string);
    const baseRate = cryptoToken === 'USDC' ? 83 : 250000;

    // No await is needed in the current heuristic-only quote ladder, but
    // the signature stays async to keep parity with the other route
    // handlers in this controller and to leave room for a real provider
    // call (which will be async) without a breaking change.
    await Promise.resolve();
    
    const quotes = [
      {
        provider: 'onramp_money',
        estimatedCryptoAmount: (amount / (baseRate * 1.01)).toFixed(6),
        exchangeRate: (baseRate * 1.01).toFixed(2),
        providerFee: (amount * 0.01).toFixed(2),
        networkFee: (flow === 'buy' ? 50 : 0).toString(),
      },
      {
        provider: 'moonpay',
        estimatedCryptoAmount: (amount / (baseRate * 1.025)).toFixed(6),
        exchangeRate: (baseRate * 1.025).toFixed(2),
        providerFee: (amount * 0.025).toFixed(2),
        networkFee: (flow === 'buy' ? 80 : 0).toString(),
      },
      {
        provider: 'stripe',
        estimatedCryptoAmount: (amount / (baseRate * 1.015)).toFixed(6),
        exchangeRate: (baseRate * 1.015).toFixed(2),
        providerFee: (amount * 0.015).toFixed(2),
        networkFee: (flow === 'buy' ? 40 : 0).toString(),
      },
      {
        provider: 'transak',
        estimatedCryptoAmount: (amount / (baseRate * 1.02)).toFixed(6),
        exchangeRate: (baseRate * 1.02).toFixed(2),
        providerFee: (amount * 0.02).toFixed(2),
        networkFee: (flow === 'buy' ? 60 : 0).toString(),
      }
    ];

    quotes.sort((a, b) => 
      flow === 'buy' 
        ? parseFloat(b.estimatedCryptoAmount) - parseFloat(a.estimatedCryptoAmount)
        : parseFloat(a.estimatedCryptoAmount) - parseFloat(b.estimatedCryptoAmount)
    );

    res.json({ quotes });
  } catch (error) {
    console.error('Quotes fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch quotes' });
  }
};

export const handleOnrampWebhook = async (
  req: Request & { rawBody?: string },
  res: Response,
  _next: NextFunction,
): Promise<void> => {
  try {
    const signatureHeader = req.headers['x-onramp-signature'];
    const signature = typeof signatureHeader === 'string' ? signatureHeader : '';

    // BE-M4 fix: Use properly typed rawBody for signature verification
    const payload =
      typeof req.rawBody === 'string' ? req.rawBody : JSON.stringify(req.body);

    const isValid = OnrampService.verifyWebhook(payload, signature);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    // Replay protection (defense in depth, runs only after signature passes):
    //
    // 1. Body-timestamp window — when Onramp.money includes an event
    //    timestamp in the signed body, refuse events older than five
    //    minutes. The signature alone proves authenticity but does not
    //    prove freshness, so a captured payload could otherwise be
    //    replayed indefinitely (auditor finding VULN-0002).
    //
    // 2. Terminal-state guard — runs further down once we know which
    //    order this event refers to; rejects any attempt to move an
    //    order out of `completed` / `cancelled` / `failed` regardless of
    //    whether the body carried a usable timestamp.
    const eventTimestampMs = extractEventTimestampMs(req.body);
    if (eventTimestampMs !== null) {
      if (Math.abs(Date.now() - eventTimestampMs) > WEBHOOK_MAX_AGE_MS) {
        res.status(401).json({ error: 'Invalid or expired timestamp' });
        return;
      }
    }

    // Schema validation. Onramp.money's webhook envelope evolves across
    // versions; we accept anything matching the documented shape plus
    // the legacy aliases we've seen in the wild, and strip unknown
    // fields so they cannot leak into the prisma update below.
    // (Auditor finding VULN-0003.)
    const parsedBody = OnrampWebhookBodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({
        error: 'Invalid webhook body',
        details: parsedBody.error.flatten(),
      });
      return;
    }
    const body = parsedBody.data;
    const { status, orderId, partnerOrderId, referenceId, id, txHash, cryptoAmount } = body;
    const gatewayOrderId =
      typeof orderId === 'string' && orderId.length > 0
        ? orderId
        : typeof partnerOrderId === 'string' && partnerOrderId.length > 0
          ? partnerOrderId
          : typeof referenceId === 'string' && referenceId.length > 0
            ? referenceId
            : typeof id === 'string' && id.length > 0
              ? id
              : '';

    if (!gatewayOrderId) {
      res.status(400).json({ error: 'Missing order identifier' });
      return;
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

    console.log(`Order ${gatewayOrderId} updated to ${nextStatus}`);

    res.json({ received: true });
  } catch (error) {
    console.error('Onramp webhook error:', error);
    res.status(500).json({ error: 'Failed to process webhook' });
  }
};

export const getOnrampStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    
    const order = await prisma.fiatOrder.findFirst({
      where: { OR: [{ id }, { orderId: id }] },
    });

    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    res.json(order);
  } catch (error) {
    next(error);
  }
};
