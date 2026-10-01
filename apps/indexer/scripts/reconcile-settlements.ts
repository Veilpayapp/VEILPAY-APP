/**
 * One-time settlement reconciliation runner (round-4 stream C, task (a)).
 *
 * Usage (mirrors how `dev` runs tsx):
 *   pnpm --filter @veilpay/indexer reconcile:settlements            # DRY-RUN (report only)
 *   pnpm --filter @veilpay/indexer reconcile:settlements -- --apply  # perform the repair
 *
 * DRY-RUN BY DEFAULT: without --apply nothing is written to the database.
 * The repair never rewrites Payment.txHash (the @@unique([chainKey, txHash])
 * constraint must not be violated) and CAS-flips pending invoices to paid
 * only while they are still pending.
 *
 * Requires DATABASE_URL in the environment (the scanner reads the real
 * database; tests for the reconciliation logic itself mock prisma and
 * never touch this script's runtime path).
 *
 * Typechecked by `pnpm --filter @veilpay/indexer typecheck:scripts`
 * (tsc -p scripts) — the main tsconfig covers src/ only.
 */

import { runSettlementReconciliation } from "../src/jobs/settlementReconciliation";
import { parseReconcileArgs, formatReconciliationReport, USAGE } from "../src/jobs/reconcileCli";
import { prisma } from "../src/lib/prisma";

async function main(): Promise<number> {
  const args = parseReconcileArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  if (!process.env.DATABASE_URL) {
    console.error(
      "[reconcile-settlements] DATABASE_URL must be set in the environment — this script reads the settlement database."
    );
    return 1;
  }

  try {
    const report = await runSettlementReconciliation({ apply: args.apply });
    for (const line of formatReconciliationReport(report)) {
      console.log(line);
    }
    return 0;
  } catch (err) {
    console.error(
      "[reconcile-settlements] Fatal:",
      err instanceof Error ? err.message : String(err)
    );
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

// Guarded so tests can import the CLI helpers (src/jobs/reconcileCli.ts)
// without executing main().
if (require.main === module) {
  void main().then((code) => {
    process.exit(code);
  });
}
