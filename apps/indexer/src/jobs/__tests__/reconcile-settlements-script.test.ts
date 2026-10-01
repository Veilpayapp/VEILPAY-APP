import {
  parseReconcileArgs,
  formatReconciliationReport,
} from '../reconcileCli';
import { prisma } from '../../lib/prisma';
import { runSettlementReconciliation } from '../settlementReconciliation';

// The runner script (scripts/reconcile-settlements.ts) only wires these
// helpers to process.argv + prisma; everything testable lives here in src.
// prisma is the global jest mock — nothing here touches a live database.

describe('parseReconcileArgs', () => {
  it('defaults to dry-run (no apply, no help)', () => {
    expect(parseReconcileArgs([])).toEqual({ apply: false, help: false });
    expect(parseReconcileArgs([]).apply).toBe(false);
  });

  it('enables apply only with --apply', () => {
    expect(parseReconcileArgs(['--apply'])).toEqual({ apply: true, help: false });
    expect(parseReconcileArgs(['--dry-run']).apply).toBe(false);
  });

  it('recognizes --help and -h', () => {
    expect(parseReconcileArgs(['--help'])).toEqual({ apply: false, help: true });
    expect(parseReconcileArgs(['-h'])).toEqual({ apply: false, help: true });
    expect(parseReconcileArgs(['--apply', '--help'])).toEqual({ apply: true, help: true });
  });
});

describe('formatReconciliationReport', () => {
  it('labels dry-run runs loudly and omits applied counts', () => {
    const lines = formatReconciliationReport({
      dryRun: true,
      applied: null,
      scannedPayments: 3,
      scannedInvoices: 2,
      findings: [
        {
          kind: 'payment-amount-base-units',
          paymentId: 'pay-1',
          invoiceId: 'inv-1',
          chainKey: 'ethereum',
          txHash: '0xabc',
          description: 'payment.amount is base units',
        },
      ],
      orphanPayments: [{ paymentId: 'pay-2', invoiceId: 'inv-gone' }],
    });

    expect(lines[0]).toMatch(/DRY-RUN \(no writes/);
    expect(lines.join('\n')).toContain('scanned 3 payment(s), 2 invoice(s)');
    expect(lines.join('\n')).toContain('findings: 1');
    expect(lines.join('\n')).toContain('[payment-amount-base-units]');
    expect(lines.join('\n')).toContain('orphan payments');
    expect(lines.join('\n')).not.toContain('applied:');
  });

  it('reports applied counts for --apply runs', () => {
    const lines = formatReconciliationReport({
      dryRun: false,
      applied: { paymentsUpdated: 2, invoicesUpdated: 1 },
      scannedPayments: 3,
      scannedInvoices: 2,
      findings: [],
      orphanPayments: [],
    });

    expect(lines[0]).toMatch(/APPLY/);
    expect(lines.join('\n')).toMatch(/applied: 2 payment row\(s\), 1 invoice row\(s\)/);
  });
});

describe('script wiring (runSettlementReconciliation is the script engine)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.payment.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.invoice.findMany as jest.Mock).mockResolvedValue([]);
  });

  it('the engine the script calls is dry-run by default (no writes without --apply)', async () => {
    const report = await runSettlementReconciliation();
    expect(report.dryRun).toBe(true);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });

  it('the apply flag the script parses maps to the engine apply option', async () => {
    const { apply } = parseReconcileArgs(['--apply']);
    const report = await runSettlementReconciliation({ apply });
    expect(report.dryRun).toBe(false);
    // no findings → no writes
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });
});
