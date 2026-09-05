import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { playIntegrityAuth } from '../middleware/playIntegrityAuth';
import {
  createOnrampUrl,
  getOnrampQuotes,
  handleOnrampWebhook,
  getOnrampStatus,
} from '../controllers/onrampController';

const router = Router();

// Hardening #2: the /url (writes a FiatOrder + mints a provider URL) and
// /quotes (fires an upstream Binance fetch) endpoints were fully
// unauthenticated. Gate them behind Google Play Integrity app attestation so
// only genuine app builds can drive DB writes and upstream fetch costs. The
// webhook uses its own provider signature and /status is HMAC-token-gated, so
// they are intentionally left outside the attestation gate.
router.post('/url', playIntegrityAuth, asyncHandler(createOnrampUrl));
router.get('/quotes', playIntegrityAuth, asyncHandler(getOnrampQuotes));
router.post('/webhook', asyncHandler(handleOnrampWebhook));
router.get('/status/:id', asyncHandler(getOnrampStatus));

export default router;
