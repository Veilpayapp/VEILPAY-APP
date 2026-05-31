import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import {
  createOnrampUrl,
  getOnrampQuotes,
  handleOnrampWebhook,
  getOnrampStatus,
} from '../controllers/onrampController';

const router = Router();

router.post('/url', asyncHandler(createOnrampUrl));
router.get('/quotes', asyncHandler(getOnrampQuotes));
router.post('/webhook', asyncHandler(handleOnrampWebhook));
router.get('/status/:id', asyncHandler(getOnrampStatus));

export default router;
