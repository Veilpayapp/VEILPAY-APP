/**
 * Tests for scripts/seed-webhook-secrets.ts (round 5).
 *
 * Prisma is mocked with a jest.mock factory — the same pattern as
 * src/controllers/__tests__/merchantController.test.ts — so the real
 * src/lib/prisma (and PrismaClient) never loads: even though
 * tests/setup.ts configures a DATABASE_URL, nothing here can connect to
 * any database. Nothing touches a live DB; the dry-run/apply semantics,
 * the CAS write, and the print-exactly-once contract are all asserted
 * against the mock.
 */

import {
  parseSeedWebhookSecretsArgs,
  mintWebhookSecret,
  runSeedWebhookSecrets,
  formatSeedWebhookSecretsReport,
  main,
} from '../scripts/seed-webhook-secrets';
import { prisma } from '../src/lib/prisma';

jest.mock('../src/lib/prisma', () => ({
  prisma: {
    merchant: {
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

const mockedPrisma = prisma as unknown as {
  merchant: {
    findMany: jest.Mock;
    count: jest.Mock;
    updateMany: jest.Mock;
  };
};

const MERCHANTS_MISSING = [
  { id: 'merchant-1', email: 'alice@example.com' },
  { id: 'merchant-2', email: 'bob@example.com' },
  { id: 'merchant-3', email: 'carol@example.com' },
];

function seedMerchantMocks(): void {
  mockedPrisma.merchant.findMany.mockResolvedValue(MERCHANTS_MISSING);
  mockedPrisma.merchant.count.mockResolvedValue(7);
  mockedPrisma.merchant.updateMany.mockResolvedValue({ count: 1 });
}

describe('parseSeedWebhookSecretsArgs', () => {
  it('defaults to dry-run (apply false)', () => {
    expect(parseSeedWebhookSecretsArgs([])).toEqual({ apply: false, help: false });
  });

  it('enables apply only with --apply', () => {
    expect(parseSeedWebhookSecretsArgs(['--apply']).apply).toBe(true);
    expect(parseSeedWebhookSecretsArgs(['--dry-run']).apply).toBe(false);
    expect(parseSeedWebhookSecretsArgs(['--apply', '--dry-run']).apply).toBe(true);
  });

  it('recognizes --help and -h', () => {
    expect(parseSeedWebhookSecretsArgs(['--help']).help).toBe(true);
    expect(parseSeedWebhookSecretsArgs(['-h']).help).toBe(true);
    expect(parseSeedWebhookSecretsArgs(['--apply', '--help'])).toEqual({
      apply: true,
      help: true,
    });
  });
});

describe('mintWebhookSecret', () => {
  it('mints whsec_-prefixed 256-bit hex secrets', () => {
    for (let i = 0; i < 50; i++) {
      expect(mintWebhookSecret()).toMatch(/^whsec_[0-9a-f]{64}$/);
    }
  });

  it('never repeats (crypto-random)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(mintWebhookSecret());
    }
    expect(seen.size).toBe(200);
  });
});

describe('runSeedWebhookSecrets — dry-run (default)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seedMerchantMocks();
  });

  it('enumerates merchants lacking webhookSecret and writes nothing', async () => {
    const report = await runSeedWebhookSecrets();

    expect(mockedPrisma.merchant.findMany).toHaveBeenCalledWith({
      where: { webhookSecret: null },
      select: { id: true, email: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(report.dryRun).toBe(true);
    expect(report.merchantsWithoutSecret).toBe(3);
    expect(report.missing).toEqual([
      { merchantId: 'merchant-1', email: 'alice@example.com' },
      { merchantId: 'merchant-2', email: 'bob@example.com' },
      { merchantId: 'merchant-3', email: 'carol@example.com' },
    ]);
    // DRY-RUN TOUCHES NOTHING: no write, no minted secret.
    expect(mockedPrisma.merchant.updateMany).not.toHaveBeenCalled();
    expect(report.seeded).toEqual([]);
  });

  it('mints no secrets and logs nothing (never logged beyond the one-time output)', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const report = await runSeedWebhookSecrets();
      expect(logSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
      expect(report.seeded).toEqual([]);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

describe('runSeedWebhookSecrets — --apply', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seedMerchantMocks();
  });

  it('stores one CAS-guarded secret per merchant and returns each exactly once', async () => {
    const report = await runSeedWebhookSecrets({ apply: true });

    expect(report.dryRun).toBe(false);
    expect(report.seeded).toHaveLength(3);
    expect(mockedPrisma.merchant.updateMany).toHaveBeenCalledTimes(3);

    for (const row of report.seeded) {
      // CAS hygiene: the write only targets a merchant STILL lacking a secret.
      const call = mockedPrisma.merchant.updateMany.mock.calls.find(
        (c) => (c[0] as { where: { id: string } }).where.id === row.merchantId
      );
      expect(call).toBeDefined();
      expect((call![0] as { where: { webhookSecret: string | null } }).where.webhookSecret).toBeNull();
      expect((call![0] as { data: { webhookSecret: string } }).data.webhookSecret).toBe(row.secret);
      expect(row.secret).toMatch(/^whsec_[0-9a-f]{64}$/);
    }

    // Distinct per merchant — one merchant's secret can never sign another's.
    const secrets = report.seeded.map((r) => r.secret);
    expect(new Set(secrets).size).toBe(3);
  });

  it('discards (does not report or print) a secret whose CAS write lost a race', async () => {
    // merchant-2 gains a secret concurrently: its updateMany returns count 0.
    mockedPrisma.merchant.updateMany.mockImplementation(async (args: { where: { id: string } }) =>
      args.where.id === 'merchant-2' ? { count: 0 } : { count: 1 }
    );

    const report = await runSeedWebhookSecrets({ apply: true });

    expect(report.seeded.map((r) => r.merchantId)).toEqual(['merchant-1', 'merchant-3']);
    expect(report.skippedConcurrent).toBe(1);
    // The raced (never-stored) secret must not be handed out anywhere.
    const output = formatSeedWebhookSecretsReport(report).join('\n');
    expect(report.seeded.map((r) => r.secret)).toHaveLength(2);
    for (const line of formatSeedWebhookSecretsReport(report)) {
      expect(line).not.toContain('merchant-2');
    }
    expect(output).toContain('skipped');
  });
});

describe('formatSeedWebhookSecretsReport', () => {
  it('dry-run output lists merchants but contains no secret material', () => {
    const report = {
      dryRun: true,
      merchantsWithoutSecret: 2,
      merchantsWithSecret: 5,
      missing: [
        { merchantId: 'm-1', email: 'a@example.com' },
        { merchantId: 'm-2', email: 'b@example.com' },
      ],
      seeded: [],
      skippedConcurrent: 0,
    };
    const lines = formatSeedWebhookSecretsReport(report);
    const text = lines.join('\n');

    expect(lines[0]).toMatch(/DRY-RUN \(no writes\)/);
    expect(text).toContain('a@example.com (m-1)');
    expect(text).toContain('b@example.com (m-2)');
    expect(text).toContain('--apply');
    expect(text).not.toMatch(/whsec_/);
  });

  it('apply output prints each stored secret EXACTLY ONCE', () => {
    const report = {
      dryRun: false,
      merchantsWithoutSecret: 2,
      merchantsWithSecret: 5,
      missing: [
        { merchantId: 'm-1', email: 'a@example.com' },
        { merchantId: 'm-2', email: 'b@example.com' },
      ],
      seeded: [
        { merchantId: 'm-1', email: 'a@example.com', secret: 'whsec_' + 'a'.repeat(64) },
        { merchantId: 'm-2', email: 'b@example.com', secret: 'whsec_' + 'b'.repeat(64) },
      ],
      skippedConcurrent: 0,
    };
    const lines = formatSeedWebhookSecretsReport(report);
    const text = lines.join('\n');

    expect(lines[0]).toMatch(/APPLY/);
    // Each secret appears exactly once across the entire output.
    expect(text.split('whsec_' + 'a'.repeat(64)).length - 1).toBe(1);
    expect(text.split('whsec_' + 'b'.repeat(64)).length - 1).toBe(1);
    expect(text).toMatch(/EXACTLY ONCE/i);
  });

  it('reports nothing-to-do when every merchant already has a secret', () => {
    const lines = formatSeedWebhookSecretsReport({
      dryRun: true,
      merchantsWithoutSecret: 0,
      merchantsWithSecret: 9,
      missing: [],
      seeded: [],
      skippedConcurrent: 0,
    });
    expect(lines.join('\n')).toMatch(/OK — every merchant already has/);
  });
});

describe('main (script wiring)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seedMerchantMocks();
  });

  it('prints help and touches no prisma method with --help', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const code = await main(['--help']);
      expect(code).toBe(0);
      expect(logSpy).toHaveBeenCalled();
      const text = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(text).toMatch(/Usage: tsx scripts\/seed-webhook-secrets\.ts/);
      expect(mockedPrisma.merchant.findMany).not.toHaveBeenCalled();
      expect(mockedPrisma.merchant.updateMany).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it('default argv is a dry-run: reports, never writes', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const code = await main([]);
      expect(code).toBe(0);
      expect(mockedPrisma.merchant.updateMany).not.toHaveBeenCalled();
      const text = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(text).toMatch(/DRY-RUN \(no writes\)/);
      expect(text).not.toMatch(/whsec_/);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('--apply writes via prisma and prints each secret exactly once', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const code = await main(['--apply']);
      expect(code).toBe(0);
      expect(mockedPrisma.merchant.updateMany).toHaveBeenCalledTimes(3);

      const text = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(text).toMatch(/APPLY/);
      // Each minted secret appears exactly once in the script's output.
      const storedSecrets = (mockedPrisma.merchant.updateMany.mock.calls as unknown as [
        { data: { webhookSecret: string } }
      ][]).map((c) => c[0].data.webhookSecret);
      expect(storedSecrets).toHaveLength(3);
      for (const secret of storedSecrets) {
        const occurrences = text.split(secret).length - 1;
        expect(occurrences).toBe(1);
      }
      expect(text).toMatch(/EXACTLY ONCE/i);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('is safe with a configured DATABASE_URL: the prisma module is fully mocked (no client, no connection)', async () => {
    // tests/setup.ts configures a (dummy) DATABASE_URL before this runs —
    // the safety property is that the script only ever talks to prisma
    // through the mocked module, so no PrismaClient is constructed and no
    // connection is attempted, in either mode.
    expect(process.env.DATABASE_URL).toBeTruthy();
    await main([]);
    await main(['--apply']);
    // Only the three mocked methods were ever callable; updateMany is the
    // sole write path and it is a mock.
    expect(mockedPrisma.merchant.updateMany).toHaveBeenCalledTimes(3);
  });
});
