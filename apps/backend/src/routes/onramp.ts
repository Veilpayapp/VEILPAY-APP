import { randomUUID } from 'crypto';
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { OnrampService } from '../lib/onramp';
import { z } from 'zod';

const router = Router();

/**
 * Validates the request for a signed Onramp URL.
 */
const CreateOrderSchema = z.object({
  userAddress: z.string(),
  fiatAmount: z.string().optional(),
  fiatCurrency: z.string().default('INR'),
  cryptoToken: z.string(),
  chainKey: z.string(),
  flow: z.enum(['buy', 'sell']),
});

/**
 * POST /api/v1/onramp/url
 * Generates a signed widget URL and pre-registers the order in our DB.
 */
router.post('/url', async (req, res) => {
  try {
    const data = CreateOrderSchema.parse(req.body);
    const orderId = randomUUID();

    // 1. Generate the secure URL
    const url = OnrampService.generateSignedUrl({
      userAddress: data.userAddress,
      fiatAmount: data.fiatAmount,
      fiatCurrency: data.fiatCurrency,
      cryptoToken: data.cryptoToken,
      network: OnrampService.mapNetwork(data.chainKey),
      orderId,
    });

    // 2. Pre-register the order for tracking (The "Full-Proof" fallback)
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

    return res.json({ url, orderId: order.id });
  } catch (error) {
    console.error('Onramp URL error:', error);
    return res.status(400).json({ error: 'Failed to generate Onramp URL' });
  }
});

/**
 * POST /api/v1/onramp/webhook
 * Handlers success/failure updates from Onramp.money.
 */
router.post('/webhook', async (req, res) => {
  const signatureHeader = req.headers['x-onramp-signature'];
  const signature = typeof signatureHeader === 'string' ? signatureHeader : '';
  const payload = typeof req.rawBody === 'string' ? req.rawBody : JSON.stringify(req.body);

  // 1. Verify it's actually from Onramp.money
  const isValid = OnrampService.verifyWebhook(payload, signature);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { status, orderId, partnerOrderId, referenceId, id, txHash, cryptoAmount } = req.body;
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
    return res.status(400).json({ error: 'Missing order identifier' });
  }

  try {
    const existingOrder = await prisma.fiatOrder.findFirst({
      where: {
        OR: [{ id: gatewayOrderId }, { orderId: gatewayOrderId }],
      },
    });

    if (!existingOrder) {
      return res.status(404).json({ error: 'Order not found' });
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

    // 2. Update the order in our database
    // Note: We use the provider's orderId to find the record we created in /url
    await prisma.fiatOrder.update({
      where: { id: existingOrder.id },
      data: {
        status: nextStatus,
        txHash: typeof txHash === 'string' ? txHash : existingOrder.txHash,
        cryptoAmount: typeof cryptoAmount === 'string' ? cryptoAmount : existingOrder.cryptoAmount,
      },
    });

    // 3. Logic for Push Notifications could go here...
    console.log(`Order ${gatewayOrderId} updated to ${nextStatus}`);

    return res.json({ received: true });
  } catch (error) {
    console.error('Onramp webhook error:', error);
    return res.status(500).json({ error: 'Failed to process webhook' });
  }
});

/**
 * GET /api/v1/onramp/status/:id
 * Allows the mobile app to poll for the status of a specific order.
 */
router.get('/status/:id', async (req, res) => {
  const { id } = req.params;
  
  const order = await prisma.fiatOrder.findFirst({
    where: { OR: [{ id }, { orderId: id }] },
  });

  if (!order) return res.status(404).json({ error: 'Order not found' });

  return res.json(order);
});

export default router;
