# Settlement reconciliation runbook

> Status: **landed (round 4, 2026-10-02)** — the scanner and repair script ship with the
> indexer; the CLI surface below matches the implementation
> (`apps/indexer/src/jobs/reconcileCli.ts`, `--help` verified).

The indexer reconciles settled invoices and payments against the backend's
database state. When the two drift (missed chain events, delivery failures,
manual state changes), reconciliation finds and repairs the mismatch from a
script rather than by hand-editing rows.

## Script

The reconciliation lives at
[`apps/indexer/scripts/reconcile-settlements.ts`](../../apps/indexer/scripts/reconcile-settlements.ts)
in the indexer workspace. Run it through the package script (it is TypeScript,
executed with tsx); it requires `DATABASE_URL` in the environment because the
scanner reads the real settlement database.

## Operating rules

- **Dry-run first, always.** The default invocation reports what it would
  change without writing anything (no prisma write is issued at all).
- **`--apply` is user-executed by design.** Applying repairs is a deliberate
  human action, never something a scheduled job or CI step does silently.
- **The repair never rewrites `Payment.txHash`** (the
  `@@unique([chainKey, txHash])` constraint must hold) and only flips invoices
  still `pending` (compare-and-swap via `updateMany({ status: 'pending' })`).

```bash
# Inspect drift (no writes; requires DATABASE_URL):
pnpm --filter @veilpay/indexer reconcile:settlements

# Repair, after reviewing the dry-run report:
pnpm --filter @veilpay/indexer reconcile:settlements -- --apply
```

Flags: `--apply` (perform the repair), `--help` (usage). Repairs cover the
pre-round-4 indexer disease: base-unit payment amounts (recomputed to human
units via the token registry), 42-hex token "symbols" (fixed via the registry),
to-addresses stored in `Invoice.paymentTxHash` (replaced by the real tx hash
from the payment row), and invoices stuck `pending` whose payments settled
(flipped to `paid` with `paidAt`).

## Periodic drift check

The indexer can also monitor for drift continuously:
`RECONCILIATION_DRIFT_CHECK_INTERVAL_MS` (default `0` = **off**) starts a
read-only interval job at startup that compares payments ↔ invoices and logs
drift, plus `WebhookDelivery` rows stuck undelivered. Enable it in the
indexer's environment when you want standing drift telemetry.

## Related

- [Indexer and jobs](../architecture/indexer-and-jobs.md)
- [Production checklist](../security/production-checklist.md)
