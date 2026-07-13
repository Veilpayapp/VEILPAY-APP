/**
 * Pre-deploy webhook URL audit.
 *
 * SEC-002: the webhook delivery path now rejects http:// URLs in
 * production and rejects redirects. Any merchant whose stored
 * `webhookUrl` still points at http:// (or a redirect that the old
 * fetch happily followed) will start failing every delivery the moment
 * we deploy. Run this script BEFORE deploying the SSRF-guard changes
 * and either reach out to the affected merchants to update their URLs
 * or accept the temporary delivery failure.
 *
 * Usage:
 *   pnpm --filter @veilpay/backend webhook-url-audit
 *
 * Exits non-zero when any merchant currently has a webhook URL that
 * would be rejected by the new guard, so this can be wired into a
 * one-off deploy job.
 */

import { config } from '../src/config';
import { assertSafeWebhookUrl } from '../src/utils/urlSafety';

interface MerchantRecord {
  id: string;
  email: string;
  webhookUrl: string | null;
}

async function loadMerchants(): Promise<MerchantRecord[]> {
  // Lazy import so the script can also be run without Prisma being
  // fully wired (e.g. against a SQL dump). The production Prisma client
  // is the canonical source; nothing here is a re-implementation.
  const { prisma } = await import('../src/lib/prisma');
  return prisma.merchant.findMany({
    where: { webhookUrl: { not: null } },
    select: { id: true, email: true, webhookUrl: true },
  });
}

interface AuditRow {
  merchantId: string;
  email: string;
  webhookUrl: string;
  reason: string;
}

async function auditWebhookUrl(url: string): Promise<string | null> {
  try {
    await assertSafeWebhookUrl(url);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'unknown error';
  }
}

async function main(): Promise<number> {
  const isProd = config.nodeEnv === 'production';
  if (!isProd) {
    // eslint-disable-next-line no-console
    console.log(
      `[webhook-url-audit] WARNING: NODE_ENV is '${config.nodeEnv}', not 'production'.`
    );
  }

  const merchants = await loadMerchants();
  const rows: AuditRow[] = [];

  for (const merchant of merchants) {
    if (!merchant.webhookUrl) continue;
    const reason = await auditWebhookUrl(merchant.webhookUrl);
    if (reason) {
      rows.push({
        merchantId: merchant.id,
        email: merchant.email,
        webhookUrl: merchant.webhookUrl,
        reason,
      });
    }
  }

  if (rows.length === 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[webhook-url-audit] OK — ${merchants.length} merchant URLs all pass the new guard.`
    );
    return 0;
  }

  // eslint-disable-next-line no-console
  console.error(
    `[webhook-url-audit] FAIL — ${rows.length} merchant URL(s) would be rejected by the new webhook-delivery guard.`
  );
  // eslint-disable-next-line no-console
  console.error(
    `These merchants will start failing every delivery the moment the SSRF guard ships.`
  );
  // eslint-disable-next-line no-console
  console.error(`Coordinate the migration BEFORE deploying, or accept temporary delivery failures.`);
  // eslint-disable-next-line no-console
  for (const row of rows) {
    console.error(`  - ${row.merchantId} (${row.email})`);
    console.error(`      url=${row.webhookUrl}`);
    console.error(`      reason="${row.reason}"`);
  }
  return 1;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[webhook-url-audit] error:', err);
    process.exit(2);
  });
