import { Router } from 'express';
import { issueAttestationNonce, isPlayIntegrityConfigured } from '../lib/playIntegrity';

const router = Router();

/**
 * POST /api/v1/attestation/nonce
 *
 * Issues a short-lived, HMAC-signed nonce the consumer-app feeds into its Play
 * Integrity token request. The backend later checks that the nonce Play echoed
 * inside the decoded verdict matches the one issued here, binding each
 * attestation to a fresh request window and blocking replay of older tokens.
 *
 * This endpoint is intentionally public (minting a nonce is harmless); the
 * enforcement happens on the attested endpoints themselves.
 */
router.post('/nonce', (req, res) => {
  if (!isPlayIntegrityConfigured()) {
    res.status(503).json({
      error: 'Play Integrity attestation is not configured.',
      code: 'ATTESTATION_NOT_CONFIGURED',
    });
    return;
  }
  res.json({ nonce: issueAttestationNonce(), ttlSeconds: 120 });
});

export default router;
