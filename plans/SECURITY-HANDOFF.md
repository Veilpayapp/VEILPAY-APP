# VeilPay Security Remediation — Session Handoff

_Last updated: 2026-07-14. Working from the provisional audit (56/100 mainnet, 74/100 dogfood)._
_Directive: fix P0 findings efficiently. Priority after this handoff: **selective commits** (see MERGE_READINESS_2026-07-14), then operator SEC-008/011 sign-off, then Solana multi-leaf Merkle epic._

---

## Status snapshot

| Area | State |
| --- | --- |
| **Committed** | `f85597d` SEC-013 max-withdraw cap; `99800c2` Aptos removal |
| **Dirty (Pass B fixes)** | Backend pay/auth/verify hardening, consumer pinning fail-closed, schema migration for `xlm` + `token_address` |
| **SEC-007** | **Done (this tree)** — real Solana Groth16 `verify_proof` via `groth16-solana` + embedded withdraw VK |

**Do not `git add -A`.** Selective commits only. Skills trees / graphify / lockfile churn are out of band.

---

## ✅ Done (committed or in dirty Pass B tree)

| Finding | Notes |
| --- | --- |
| **SEC-013** max-withdraw | **Committed** (`f85597d`): on-chain immutable + relayer pre-gas 400. Arm non-zero prod env. |
| **Aptos removal** | **Committed** (`99800c2`); dirty leftovers: Prisma enum migration `mvm`→`xlm`, RPC/indexer cleanup |
| **SEC-004** anti-screenshot | Wired on sensitive screens + `VerifyWallet` |
| **SEC-003** SSL pins | Env-driven pins; rejects dummy `AAAA…=`; **release builds throw** if pins missing |
| **SEC-002** dual pay path | SSOT `verifyPaymentTxOnChain` + `confirmInvoicePayment` |
| **SEC-006** auth Redis | Prod fail-closed; **atomic SET NX** after signature validate |
| **SEC-012** ERC-20 | Transfer logs + **token contract identity** (invoice `tokenAddress` / registry); sum multi-log credits |
| **REL-002** invoice.expired | Idempotent expire + webhook |
| **SEC-001** directory viewingKey | Public by design; publish-time `publicKey` validation (EVM on-curve, SVM 32B, **XLM StrKey checksum**) |
| **SEC-007** Solana groth16 | Real `verify_withdraw_proof` + VK from `circuits/build/verification_key.json`; host unit tests green (`cargo test --lib`) |

### Pass B residual fixes (this session)

- Real GoldRush `transactions_v3` client (fail-closed on HTTP / unsupported chain; no key → verifier 400)
- `EVM_CHAIN_KEYS` + `getViemChain` include base/optimism/bsc; unknown EVM fails closed (no mainnet default)
- Pay vs expire race → `InvoiceNotPayableError` → HTTP **409** (not 500)
- `paidAt` returned from DB/transaction, not request clock
- `PAYMENT_MIN_CONFIRMATIONS` (default **1**)
- Prisma migration: `ChainType` rebuild + `invoices.token_address`

### SEC-007 residual (product completeness, fail-closed)

- Real Groth16 verifier is live; **multi-deposit is hard-gated** (`MAX_SCAFFOLD_LEAVES = 1` → `ScaffoldSingleLeafOnly`) so a second deposit cannot overwrite `merkle_root` and lock the first note.
- Full multi-leaf Poseidon tree + root history + deposit→prove→withdraw e2e still required before multi-user Solana privacy.
- Full `anchor test` needs Solana/Anchor CLI; host unit tests cover verifier fail-closed paths.

---

## Process gates

| ID | Code/docs | Operator sign-off |
|----|-----------|-------------------|
| **SEC-008 / SEC-011** | **Docs done** — `docs/security/ceremony-and-audit-gates.md` + production checklist | Checkboxes still open until ceremony + external audit complete |
| Ops caps / secrets | Documented in production checklist | Arm Doppler: relayer secret, withdraw caps, SSL pins, RPC keys |
| Solana multi-leaf Merkle | Scaffold gate live (`MAX_SCAFFOLD_LEAVES=1`) | Product epic before multi-user deploy |

**Merge readiness:** `plans/MERGE_READINESS_2026-07-14.md` (junk cleaned; do not push until selective commits).

**Suggested next:** selective-commit Pass B + SEC-007 + docs → push/PR → operator SEC-008/011 evidence.

---

## Key file pointers

- Payment verify: `apps/backend/src/services/paymentTxVerifier.ts`, `goldrush.ts`, `lib/tokenRegistry.ts`
- Pay transaction: `services/paymentProcessor.ts` (`InvoiceNotPayableError`)
- Auth replay: `middleware/auth.ts` (`SET … NX EX`)
- Public keys: `utils/publicKey.ts`
- Schema: `prisma/schema.prisma` + `prisma/migrations/20260714000000_chain_type_xlm_token_address/`
- Consumer pinning: `apps/consumer-app/src/utils/security.ts`
- SEC-007 Solana verifier: `packages/contracts-solana/programs/veil_pool/src/{lib,verifier,verifying_key}.rs`
- VK generator: `packages/contracts-solana/scripts/generate_verifying_key.js`

## Repo facts

- Root `D:/Veilpay`, pnpm workspace. Backend: `cd apps/backend && npx jest <pattern>`.
- Apply schema: `pnpm --filter @veilpay/backend db:migrate` or `db:push` in dev; production must run migrate (enum rebuild is not push-safe alone on some hosts).
