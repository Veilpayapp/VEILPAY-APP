/**
 * Per-merchant webhook secret seeding (round 5).
 *
 * Makes the round-4 user gate self-service: merchants created before the
 * `webhookSecret` column (or before rotating) still sign with the deprecated
 * global WEBHOOK_SIGNING_SECRET fallback (src/lib/webhookSecret.ts warns
 * once per process until they are rotated). This script enumerates every
 * merchant lacking `Merchant.webhookSecret` and mints one for each, using
 * the same hygiene as API-key rotation (POST /api/v1/merchant/keys/rotate,
 * controllers/merchantController.ts):
 *
 *   - the secret is minted from crypto randomness and is NEVER hashed (it
 *     must remain readable — it is the merchant's webhook HMAC key);
 *   - the write is a compare-and-swap on `webhookSecret: null`, so a
 *     concurrent rotation/seed can never be silently clobbered — a CAS miss
 *     skips the merchant and the minted (unused) secret is discarded
 *     WITHOUT being printed;
 *   - each stored secret is printed EXACTLY ONCE, in the one-time output
 *     below — it is never sent to any logger and never printed again.
 *
 * DRY-RUN BY DEFAULT: without flags the script only reports which merchants
 * would get secrets and touches nothing (read-only queries).
 *
 * Usage:
 *   pnpm --filter @veilpay/backend exec tsx scripts/seed-webhook-secrets.ts           # dry-run
 *   pnpm --filter @veilpay/backend exec tsx scripts/seed-webhook-secrets.ts --apply   # mint + store + print once
 *   pnpm --filter @veilpay/backend exec tsx scripts/seed-webhook-secrets.ts --help
 *
 * Safety: the script uses the app's shared prisma client (src/lib/prisma)
 * and constructs no client of its own; tests mock that module, so no test
 * ever touches a live DATABASE_URL. Only --apply performs writes.
 */

import { randomBytes } from 'crypto';
import { prisma } from '../src/lib/prisma';

export interface SeedWebhookSecretsArgs {
  apply: boolean;
  help: boolean;
}

/** A merchant enumerated as lacking a webhookSecret (no secret material). */
export interface MerchantMissingSecret {
  merchantId: string;
  email: string;
}

export interface SeededWebhookSecretRow {
  merchantId: string;
  email: string;
  /** The minted secret. Present only in the report; printed exactly once. */
  secret: string;
}

export interface SeedWebhookSecretsReport {
  /** True when no writes were performed (the default, no --apply). */
  dryRun: boolean;
  /** Merchants enumerated as lacking a webhookSecret (== missing.length). */
  merchantsWithoutSecret: number;
  /** Merchants that already have a secret (context for the operator). */
  merchantsWithSecret: number;
  /** Enumerated merchants lacking a secret — populated in BOTH modes. */
  missing: MerchantMissingSecret[];
  /** Rows actually stored under --apply (empty in dry-run). */
  seeded: SeededWebhookSecretRow[];
  /** CAS misses under --apply — a secret appeared concurrently; re-run to check. */
  skippedConcurrent: number;
}

/**
 * Parse the CLI arguments. Dry-run is the default: `apply` is true ONLY
 * when `--apply` is present (`--dry-run` is accepted and explicitly does
 * not enable writes).
 */
export function parseSeedWebhookSecretsArgs(argv: string[]): SeedWebhookSecretsArgs {
  return {
    apply: argv.includes('--apply'),
    help: argv.includes('--help') || argv.includes('-h'),
  };
}

/**
 * Mint a per-merchant webhook signing secret.
 *
 * Same hygiene as API-key minting in `rotateApiKey` (crypto-random,
 * surfaced exactly once), with one deliberate difference: the webhook
 * secret is stored PLAINTEXT (not hashed) because it is the HMAC key the
 * backend itself must use to sign deliveries — `Merchant.webhookSecret`
 * has no hash column. 32 random bytes (256 bits) prefix-tagged `whsec_`.
 */
export function mintWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('hex')}`;
}

function usage(): string[] {
  return [
    'Usage: tsx scripts/seed-webhook-secrets.ts [--apply] [--help]',
    '',
    '  (no flags)  DRY-RUN: report merchants lacking Merchant.webhookSecret; write nothing.',
    '  --apply     Mint + store a per-merchant secret for each (CAS on webhookSecret: null),',
    '              printing each secret EXACTLY ONCE. Store them immediately — they are',
    '              never shown or logged again.',
    '  --dry-run   Explicit dry-run (default behavior; never enables writes).',
    '  --help, -h  Show this help.',
  ];
}

/**
 * Core seeding engine. Reads merchants lacking `webhookSecret`; when
 * `apply` is false it performs NO writes and mints NO secrets. This
 * function never logs or prints anything — the one-time secret output is
 * produced exclusively by {@link formatSeedWebhookSecretsReport} so the
 * secret surface stays auditable in one place.
 */
export async function runSeedWebhookSecrets(
  opts: { apply?: boolean } = {}
): Promise<SeedWebhookSecretsReport> {
  const missing = await prisma.merchant.findMany({
    where: { webhookSecret: null },
    select: { id: true, email: true },
    orderBy: { createdAt: 'asc' },
  });
  const merchantsWithSecret = await prisma.merchant.count({
    where: { webhookSecret: { not: null } },
  });

  const report: SeedWebhookSecretsReport = {
    dryRun: !opts.apply,
    merchantsWithoutSecret: missing.length,
    merchantsWithSecret,
    missing: missing.map((m) => ({ merchantId: m.id, email: m.email })),
    seeded: [],
    skippedConcurrent: 0,
  };

  if (!opts.apply) {
    // DRY-RUN: touch nothing beyond the reads above.
    return report;
  }

  for (const merchant of missing) {
    const secret = mintWebhookSecret();
    // CAS: only a merchant still lacking a secret can be seeded — a
    // concurrent rotate/seed that set one in the meantime must not be
    // clobbered. On a miss the minted secret was never stored, so it is
    // discarded silently (printing it would hand out a dead secret).
    const result = await prisma.merchant.updateMany({
      where: { id: merchant.id, webhookSecret: null },
      data: { webhookSecret: secret },
    });
    if (result.count !== 1) {
      report.skippedConcurrent += 1;
      continue;
    }
    report.seeded.push({ merchantId: merchant.id, email: merchant.email, secret });
  }

  return report;
}

/**
 * Render the report as console lines. Under --apply this is the ONE place
 * secrets become text: each appears exactly once across the whole output.
 */
export function formatSeedWebhookSecretsReport(report: SeedWebhookSecretsReport): string[] {
  const lines: string[] = [];

  if (report.merchantsWithoutSecret === 0) {
    lines.push(
      `[seed-webhook-secrets] OK — every merchant already has a per-merchant webhook secret (${report.merchantsWithSecret} total). Nothing to do.`
    );
    return lines;
  }

  if (report.dryRun) {
    lines.push(
      `[seed-webhook-secrets] DRY-RUN (no writes). ${report.merchantsWithoutSecret} merchant(s) are missing a per-merchant webhook secret:`
    );
    for (const row of report.missing) {
      lines.push(`  - ${row.email} (${row.merchantId})`);
    }
    lines.push(
      `[seed-webhook-secrets] ${report.merchantsWithSecret} merchant(s) already have one. Re-run with --apply to mint and store the missing secrets (each printed exactly once).`
    );
    return lines;
  }

  lines.push(
    `[seed-webhook-secrets] APPLY — minted and stored ${report.seeded.length} per-merchant webhook secret(s):`
  );
  for (const row of report.seeded) {
    lines.push(`  - ${row.email} (${row.merchantId}) secret: ${row.secret}`);
  }
  if (report.skippedConcurrent > 0) {
    lines.push(
      `[seed-webhook-secrets] ${report.skippedConcurrent} merchant(s) skipped — a secret appeared concurrently (re-run dry mode to check).`
    );
  }
  lines.push(
    `[seed-webhook-secrets] Each secret is shown EXACTLY ONCE and never logged again — deliver it to the merchant over a secure channel now.`
  );
  return lines;
}

/**
 * CLI entry. Returns the process exit code; never calls process.exit
 * itself (the require.main guard does), so tests can drive it directly.
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const { apply, help } = parseSeedWebhookSecretsArgs(argv);
  if (help) {
    for (const line of usage()) {
      // eslint-disable-next-line no-console
      console.log(line);
    }
    return 0;
  }
  const report = await runSeedWebhookSecrets({ apply });
  for (const line of formatSeedWebhookSecretsReport(report)) {
    // eslint-disable-next-line no-console
    console.log(line);
  }
  return 0;
}

if (require.main === module) {
  main()
    .then((code) => {
      process.exit(code);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[seed-webhook-secrets] error:', err);
      process.exit(2);
    });
}
