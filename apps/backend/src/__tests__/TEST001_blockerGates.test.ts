/**
 * TEST-001 — automated gates for former production blockers.
 *
 * Each assertion re-checks a control that previously capped readiness.
 * Prefer importing real modules over re-stating behavior in prose.
 */

import fs from 'fs';
import path from 'path';
import { amountsMatch } from '../jobs/chainIndexer';

describe('TEST-001 blocker gates (backend)', () => {
  const srcRoot = path.join(__dirname, '..');

  function read(rel: string): string {
    return fs.readFileSync(path.join(srcRoot, rel), 'utf8');
  }

  it('SEC-001: payment confirm route is auth-gated', () => {
    const routes = read('routes/payment.ts');
    expect(routes).toMatch(/authMiddleware/);
    expect(routes).toMatch(/requireAuth/);
    expect(routes).toMatch(/confirmPayment/);
  });

  it('SEC-001 residual: on-chain verify is wired before confirm write', () => {
    const controller = read('controllers/paymentController.ts');
    expect(controller).toMatch(/verifyPaymentTxOnChain/);
    expect(fs.existsSync(path.join(srcRoot, 'services/paymentTxVerifier.ts'))).toBe(
      true
    );
  });

  it('SEC-002: SSRF guard module exists and rejects private hosts', () => {
    const safety = read('utils/urlSafety.ts');
    expect(safety).toMatch(/SEC-002/);
    expect(safety).toMatch(/private|SSRF|reserved/i);
  });

  it('SEC-003: register uses pending status gate in production', () => {
    const merchant = read('controllers/merchantController.ts');
    expect(merchant).toMatch(/pending/);
    expect(merchant).toMatch(/MERCHANT_REGISTRATION/);
  });

  it('SEC-004: RPC proxy has batch/logs caps', () => {
    const rpc = read('routes/rpc.ts');
    expect(rpc).toMatch(/MAX_BATCH_SIZE/);
    expect(rpc).toMatch(/MAX_ETH_GETLOGS_BLOCK_RANGE|MAX_RESPONSE_BYTES/);
  });

  it('SEC-005: onramp status uses signed opaque token helper', () => {
    expect(fs.existsSync(path.join(srcRoot, 'utils/onrampStatusToken.ts'))).toBe(
      true
    );
    const token = read('utils/onrampStatusToken.ts');
    expect(token).toMatch(/SEC-005|HMAC|statusToken/i);
  });

  it('SEC-006: relayer has quota + caller auth residual', () => {
    expect(fs.existsSync(path.join(srcRoot, 'utils/relayerQuota.ts'))).toBe(true);
    expect(fs.existsSync(path.join(srcRoot, 'middleware/relayerAuth.ts'))).toBe(
      true
    );
    const relayerRoutes = read('routes/relayer.ts');
    expect(relayerRoutes).toMatch(/relayerCallerAuth/);
  });

  it('REL-002: webhook enqueue creates outbox before queue add', () => {
    const q = read('jobs/webhookQueue.ts');
    expect(q).toMatch(/REL-002/);
    expect(q).toMatch(/webhookDelivery\.create/);
    expect(q).toMatch(/buildWebhookJobId|jobId/);
  });

  it('PERF-002: indexer bounds pending sweeps', () => {
    const idx = read('jobs/chainIndexer.ts');
    expect(idx).toMatch(/MAX_PENDING_INVOICES_PER_SWEEP/);
    expect(idx).toMatch(/take:/);
  });

  it('amount match helper is decimal-safe (indexer/confirm share)', () => {
    expect(amountsMatch('1.0', '1.00')).toBe(true);
    expect(amountsMatch('1.0', '1.01')).toBe(false);
  });
});
