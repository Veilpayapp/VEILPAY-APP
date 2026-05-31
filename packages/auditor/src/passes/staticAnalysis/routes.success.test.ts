import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { runRouteVerifier } from './routes';

describe('routes success', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'auditor-routes-ws-'));
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('runs route verifier successfully', async () => {
    // Webhook route
    const webhookDir = path.join(workspaceRoot, 'apps', 'backend', 'src', 'routes');
    await fs.mkdir(webhookDir, { recursive: true });
    await fs.writeFile(path.join(webhookDir, 'webhook.ts'), `
      import { verifySignature } from '../middleware/auth';
      const maxAge = 300000;
      router.post('/', verifySignature, handler);
    `);
    await fs.mkdir(path.join(workspaceRoot, 'apps', 'backend', 'src', 'middleware'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'apps', 'backend', 'src', 'middleware', 'auth.ts'), `
      export function verifySignature() {}
    `);

    // Merchant route
    await fs.writeFile(path.join(webhookDir, 'merchant.ts'), `
      import { authMiddleware } from '../middleware/auth';
      import { z } from 'zod';
      router.get('/', authMiddleware, (req) => {
        if (req.user.merchantId !== 1) throw new Error();
      });
    `);

    // Bootstrap file
    await fs.writeFile(path.join(workspaceRoot, 'apps', 'backend', 'src', 'index.ts'), `
      import rateLimit from 'express-rate-limit';
      app.use(cors({ origin: 'http://localhost' }));
    `);

    // JWT config
    await fs.writeFile(path.join(workspaceRoot, 'apps', 'backend', 'src', 'auth.ts'), \`
      import jwt from 'jsonwebtoken';
      jwt.sign({ algorithm: 'RS256', expiresIn: '1h' });
      const refreshToken = 'abc';
    \`);

    const result = await runRouteVerifier({
      workspaceRoot,
      backendRoutes: {
        webhooks: ['apps/backend/src/routes/webhook.ts'],
        merchant: ['apps/backend/src/routes/merchant.ts'],
        invoice: [],
        admin: []
      }
    });

    expect(result.results.length).toBeGreaterThan(0);

    // Assert webhook checks
    const webhookSig = result.results.find(r => r.routePath.includes('webhook.ts') && r.check === 'webhook-signature');
    expect(webhookSig?.pass).toBe(true);
    const webhookTime = result.results.find(r => r.routePath.includes('webhook.ts') && r.check === 'webhook-timestamp');
    expect(webhookTime?.pass).toBe(true);

    // Assert merchant checks
    const merchantAuth = result.results.find(r => r.routePath.includes('merchant.ts') && r.check === 'auth');
    expect(merchantAuth?.pass).toBe(true);
    const merchantScope = result.results.find(r => r.routePath.includes('merchant.ts') && r.check === 'scope');
    expect(merchantScope?.pass).toBe(true);
    const merchantSchema = result.results.find(r => r.routePath.includes('merchant.ts') && r.check === 'schema-validation');
    expect(merchantSchema?.pass).toBe(true);

    // Assert bootstrap checks
    expect(result.bootstrap.rateLimiting.pass).toBe(true);
    expect(result.bootstrap.cors.pass).toBe(true);

    // Assert JWT checks
    expect(result.jwt.alg.pass).toBe(true);
    expect(result.jwt.ttl.pass).toBe(true);
    expect(result.jwt.refresh.pass).toBe(true);
  });
});
