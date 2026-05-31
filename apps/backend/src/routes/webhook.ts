import { Router } from 'express';
import { authMiddleware, requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { testWebhook, verifyWebhook, getFailedWebhooks, retryWebhook } from '../controllers/webhookController';

const router = Router();

// M1 fix: require full authMiddleware on the test endpoint.
// Previously this endpoint was unauthenticated — anyone could POST to it.
router.post('/test', authMiddleware, requireAuth, testWebhook);
router.post('/verify', verifyWebhook);
router.get('/failed', authMiddleware, requireAuth, asyncHandler(getFailedWebhooks));
router.post('/:id/retry', authMiddleware, requireAuth, asyncHandler(retryWebhook));

export { router as webhookRoutes };
