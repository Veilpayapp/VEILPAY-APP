/**
 * CLI helpers for the one-time settlement reconciliation runner
 * (scripts/reconcile-settlements.ts). Kept in src/ so they are covered by
 * the main tsconfig and unit-tested without executing the script itself.
 */

import type { ReconciliationReport } from "./settlementReconciliation";

export interface ReconcileCliOptions {
  apply: boolean;
  help: boolean;
}

export const USAGE = [
  "Usage: tsx scripts/reconcile-settlements.ts [--apply]",
  "",
  "  (no flags)  DRY-RUN: scan payments/invoices and print the repair report",
  "             without writing anything.",
  "  --apply     Perform the repair: fix base-unit amounts, fix address-shaped",
  "             token symbols via the registry, write real txHashes onto",
  "             invoices, CAS-flip matching pending invoices to paid.",
  "  --help, -h  Show this help.",
].join("\n");

/**
 * Argument parsing for the runner: DRY-RUN unless `--apply` is passed.
 */
export function parseReconcileArgs(argv: string[]): ReconcileCliOptions {
  const apply = argv.includes("--apply");
  const help = argv.includes("--help") || argv.includes("-h");
  return { apply, help };
}

/** Human-readable report lines (unit-tested). */
export function formatReconciliationReport(report: ReconciliationReport): string[] {
  const mode = report.dryRun
    ? "DRY-RUN (no writes; pass --apply to repair)"
    : "APPLY (repairs written)";
  const lines: string[] = [
    `[reconcile-settlements] mode: ${mode}`,
    `[reconcile-settlements] scanned ${report.scannedPayments} payment(s), ${report.scannedInvoices} invoice(s)`,
    `[reconcile-settlements] findings: ${report.findings.length}`,
  ];
  for (const finding of report.findings) {
    lines.push(
      `[reconcile-settlements]   - [${finding.kind}] payment ${finding.paymentId}${finding.invoiceId ? ` / invoice ${finding.invoiceId}` : ""}: ${finding.description}`
    );
  }
  if (report.orphanPayments.length > 0) {
    lines.push(
      `[reconcile-settlements] orphan payments (invoiceId → missing invoice, not auto-repairable): ${report.orphanPayments.length}`
    );
    for (const orphan of report.orphanPayments) {
      lines.push(
        `[reconcile-settlements]   - payment ${orphan.paymentId} → missing invoice ${orphan.invoiceId}`
      );
    }
  }
  if (report.applied) {
    lines.push(
      `[reconcile-settlements] applied: ${report.applied.paymentsUpdated} payment row(s), ${report.applied.invoicesUpdated} invoice row(s) updated`
    );
  }
  return lines;
}
