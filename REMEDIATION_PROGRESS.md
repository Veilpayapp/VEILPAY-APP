# REMEDIATION_PROGRESS — Round 3: P0 Remediation Fleet (2026-10-01)

> **Round 4 (P1 fleet, 2026-10-02) is appended at the bottom of this file.**

**STATUS: COMPLETE.** Six concurrent streams (dynamic-workflow run
`dwfrun-420a4925-3c33-47ff-b0f5-ea95b781be00`, 34m 50s, 6/6 done) + lead integration.
Verification matrix 10/10 green. Seven local commits on `main` (NOT pushed — user gate).
Full stream claims with command evidence: the run's "P0 fleet claims report" artifact.

HEAD at session start: `8cea7cc` + dirty tree (remediation round 2, uncommitted — now landed).
This file is owned by the LEAD. P1/P2 items are out of scope this session (unchanged).

---

## Phase 0 — ground-state re-verification (lead-run, 2026-10-01)

All 11 audit anchors CONFIRMED by execution before dispatch (details in git history of this
file): consumer typecheck failed on exactly `App.tsx(63,3) TS2304`; backend jest
`3 failed / 369 passed / 374` (retentionPurge matchers); indexer jest 32 failures from `dist/`
duplicates; consumer coverage gate 46.35% branches (951/1 skip); backend+indexer typechecks
clean; lockfile fix uncommitted; README/SECURITY deleted (recoverable from `b8f3342^`);
`infra/doppler.json` + five stray `package-lock.json` tracked; §1.7 untracked files present.

Deltas folded into briefs: version-sync already passed; stores/hooks branch coverage too low
to keep in the gate (utils 62.55 / hooks 34.37 / screens 40.84 / stores 33.21 / components 40.71);
`packages/circuits/build/` had the withdraw artifacts locally; SPP `assets/spp/circuits/` is the
local-bundling precedent. Lead's "SetPasswordScreen unreachable" premise was WRONG (grep
truncated at head -12) — Stream E escalated with the two live call sites
(ImportWalletScreen.tsx:173, VerifyWalletScreen.tsx:87); resolved by grant + re-point.

---

## Verification matrix (lead-run, sequential, 2026-10-01 — ALL GREEN)

| # | Check | Result |
|---|---|---|
| 1 | `pnpm --filter @veilpay/backend typecheck` | clean, exit 0 |
| 2 | `pnpm --filter @veilpay/indexer typecheck` | clean, exit 0 (after Sentry install) |
| 3 | `pnpm --filter consumer-app typecheck` | clean, exit 0 — **release-build crash fixed** |
| 4 | `pnpm --filter @veilpay/backend test` | **62/62 suites, 397 passed, 2 skipped**, exit 0 (after one lead fix: tests/e2e/invoiceFlow.test.ts mocked lib/redis without the new `getBoundedRedisClient` export — mock extended) |
| 5 | `pnpm --filter @veilpay/indexer test` | **8/8 suites, 87 passed**, exit 0 — dist/ duplicates gone (was 32 failures) |
| 6 | `pnpm --filter consumer-app test -- --coverage` | **149 suites passed + 1 skipped, 965 tests passed + 1 skipped, exit 0** — coverage gate enforced and passing (51.34% branches on utils+stores+hooks scope) |
| 7 | `node scripts/validate-maestro-flows.mjs` | `UX-002 Maestro validation ok`, exit 0 |
| 8 | `node apps/consumer-app/scripts/check-version-sync.js` | `OK: version 1.0.4 / build 16`, exit 0 |
| 9 | Grep proofs | `initializeRpcValidation` imported (App.tsx:44); zero `checkForUpdateAsync` call sites; zero `veilpay_app_password` writers; indexer dev-secret default removed (required, non-test rejection); release prover path pinned (see Stream F); `infra/doppler.json` gone; README.md + SECURITY.md exist; F's baked SHA-256 pins match staged bytes exactly (sha256sum: wasm `4292cc33…`, zkey `2269a668…`, snarkjs `ed55d1f1…`) |
| 10 | `git status` after commits | only deliberately-untracked pre-existing user files remain (`.claude/`, audit/prompt docs, `config/.env.example`, `.tmp-jest-after.log2`) |

Single `pnpm install` after the fleet: exit 0 (4m15s), lockfile updated with indexer
`@sentry/node@^10.53.1`.

---

## Commits (local, on main, NOT pushed — per user gate 1)

| Commit | Stream | Subject |
|---|---|---|
| `6954179` | E | fix(app): release-build crash, biometric lock, account wipe; retire OTA and app password |
| `1dcb10e` | A | test(gates): fix retentionPurge matchers, re-scope consumer coverage gate |
| `4f1b4d2` | B | chore(repo): restore README/SECURITY, drop doppler blob and stray lockfiles, add .env.example |
| `403bf2e` | C | fix(indexer): settlement math, zombie exit, sentry, dev-secret removal |
| `143a782` | D | fix(backend): redis resilience, health exemption, upstream timeouts, webhook retry |
| `99bb73b` | F | feat(app): bundle prover artifacts locally with mandatory integrity pins |
| `ca7e4b6` | — | chore: land round-2+3 working tree (round-2 dirt + §1.7 untracked files + lockfile + this board) |

---

## Stream outcomes (claims → lead verification)

**A — Gates green (`1dcb10e`).** retentionPurge matchers fixed to `{ lt: expect.any(Date) }`
(3 lines; 9/9 tests). Coverage gate re-scoped to utils+stores+hooks, debt comment in config,
gate passing (51.34% branches, full-suite exit 0 — re-verified by lead in matrix #6).
Version-sync re-confirmed (matrix #8). Lead read the config diff: only
`collectCoverageFrom` + comment changed; the moduleNameMapper hunk in the diff is round-2
pre-existing work, not A's.

**B — Repo face & hygiene (`4f1b4d2`).** README.md + SECURITY.md restored byte-identical from
`b8f3342^` (no version numbers existed — honest no-op). `infra/doppler.json` deleted; rotation
runbook written (docs/security/doppler-rotation-and-history-purge.md, 9.7KB, git-filter-repo +
BFG commands included). Five stray package-lock.json files deleted. Root `.env.example` created
(placeholder-only — lead's secret scan `grep -cE 'sk-|whsec_|[A-Za-z0-9+/]{40,}'` → 0) with the
previously undocumented `DIRECT_URL` + `TRUST_PROXY_HOPS`; `.gitignore` un-ignores it.

**C — Indexer resurrection (`403bf2e`).** All six tasks: jest ignores dist/ (listTests dist
count 0; full suite 8/8, 87 tests); token symbol/decimals registry
(`src/indexers/tokenMetadata.ts`, mirrors backend tokenRegistry, unknown → 'TOKEN'/18); base
unit → human conversion before invoice match (matches backend conventions); `paymentTxHash`
stores the real tx hash; invoice flip is CAS `updateMany({ status: 'pending' })` mirroring
backend paymentProcessor; reconnect exhaustion `process.exit(1)`; Sentry wired + SENTRY_DSN
required in production; WEBHOOK_SIGNING_SECRET required with no default, dev value rejected in
any non-test env (lead verified in the config diff). New tests: 21 websocket + 11 tokenMetadata
+ config tests.

**D — Backend resilience (`143a782`).** Bounded second Redis client
(`getBoundedRedisClient`: maxRetriesPerRequest 2, commandTimeout 1000ms, connectTimeout 2000ms,
bounded retryStrategy) for rate limiting + sessions; FailoverRateLimitStore degrades to memory
on unhealthy Redis with a 1s store deadline; BullMQ client untouched. `/api/v1/health` mounted
before the global limiter. errorHandler honors `err.status` (4xx/5xx, 400/413 from
body-parser). 10s AbortSignal timeouts on goldrush (1 fetch) + stellarHorizon (2 fetches).
Webhook retry mints `wh-<deliveryId>-retry-<attempt>` jobIds (retryCount-driven); retry-path
duplicate returns the existing job instead of masking; first-delivery/sweep stay idempotent.
SENTRY_DSN required in production (config:151-157). 5 new test suites + 3 extended — all in
the green full run (matrix #4).

**E — Mobile truth & privacy (`6954179`).** `initializeRpcValidation` imported (release crash
fixed — matrix #3). BiometricPrompt is reason-aware: OS-cancel/Cancel buttons → `user_cancel`
(app stays locked, retryable); only genuine unavailability (not_enrolled/not_available) →
`unavailable` (auto-disable) — lead read both diffs. OTA retired in code:
`updates.enabled: false`, hook + modal + wiring deleted, zero `checkForUpdateAsync` call sites.
Wipe completion: new `wipePersistedState()` removes the whole
`veilpay-transaction-storage` key (clearTransactions semantics preserved for its other
callers); onramp tokens now tracked in a SecureStore index so `clearAllOnrampTokens` can
enumerate them; the accountWipe test enumerates every storage writer in src mechanically and
fails on any uncovered key. SetPasswordScreen (plaintext writer + false copy) deleted;
onboarding re-pointed to BiometricSetup (mid-run escalation `dwfq-420a4925-1`, grant recorded
below). Greps re-verified by lead: zero `SET_PASSWORD` refs.

**F — Prover off the CDN (`99bb73b`).** Artifacts staged in `apps/consumer-app/assets/circuits/`
(withdraw.wasm 2.6MB, withdraw_final.zkey 5.4MB, snarkjs 0.7.2 UMD 719KB — binaries gitignored,
mirroring the SPP pattern) by the committed `scripts/stage-circuit-assets.js` which verifies
SHA-256 against the pins baked in `src/constants/circuit.ts`. Release: bundled-local source
only (Metro assetExts wasm/zkey/umd, expo-asset, UMD inlined into the WebView, file://
artifacts) with MANDATORY pins — fail-closed when unset or when an env override mismatches the
baked digests; dev keeps remote+relaxed. Lead deterministically verified the three baked pins
match the staged bytes via sha256sum. 25 pin/local-asset tests green (inside matrix #6).

### Lead integration actions
1. Mid-run grant for E (escalation `dwfq-420a4925-1`): ImportWalletScreen.tsx +
   VerifyWalletScreen.tsx re-points to `SCREENS.BIOMETRIC_SETUP`.
2. Fixed stale e2e mock: `apps/backend/tests/e2e/invoiceFlow.test.ts` lib/redis mock lacked
   the new `getBoundedRedisClient` export (suite failed at import; extended the mock → 2/2,
   then full suite green).
3. Single `pnpm install` for C's `@sentry/node` (exit 0).
4. Cleared the pre-existing round-2 staged deletions (`git reset`) so each stream commit
   contains exactly its intended paths.

---

## User gates (NOT attempted — your moves)

1. **Push + protect:** push the 7 commits to GitHub and enable branch protection on `main`
   (require CI checks). CI's `ERR_PNPM_OUTDATED_LOCKFILE` is resolved by the landed lockfile.
2. **SPP submodule:** push SPP commit `05e3899…` to a reachable ref (fork
   NethermindEth/stellar-private-payments under the org, update `.gitmodules`) — until then
   the CI `contracts` job stays red regardless of this work.
3. **Doppler rotation:** rotate the credentials exposed by the tracked blob (runbook:
   docs/security/doppler-rotation-and-history-purge.md); optional history purge afterwards.
4. **Railway env:** set `SENTRY_DSN` (now boot-required in prod for backend AND indexer),
   `TRUST_PROXY_HOPS`, and enable Postgres backups (still the top open audit finding).
5. **App-password product direction:** the plaintext surface is deleted; re-adding a real
   vault-encryption feature is a product decision.
6. **Play Integrity provisioning** (roadmap).
7. **Prover zkey provenance:** confirm `withdraw_final.zkey`'s trusted setup matches the
   deployed contracts' verification key (packages/circuits/build/verification_key.json sits
   next to it). Fresh clones and EAS builds must run
   `node apps/consumer-app/scripts/stage-circuit-assets.js` before bundling.

## Debt register

- Coverage scope: utils/stores/hooks only, gate passing at 51.34% branches. Raise
  screens/components (payment/spp components sit at 4-7%) — and stores/hooks (33-34%) — to
  ≥50%, then re-expand the globs.
- Backend full-suite worker teardown warning ("worker process has failed to exit gracefully")
  — exit 0, suites green; likely the bounded Redis client's proactive connect. Run
  `--detectOpenHandles` when convenient.
- Indexer `test` script still carries pre-existing `--forceExit` (not added this session).
- `config/.env.example` is now visible-untracked (the `.env.example` ignore line was removed);
  dedupe against root `.env.example` or delete it — your housekeeping, as are the untracked
  root docs (AUDIT_*.md, .claude/, SCF_*, YC_*.docx, `.tmp-jest-after.log2`).
- ZkpProver property-test skip is pre-existing (noted, not fixed here).

## Suggested next session (P1, from the audit — explicitly out of scope this round)

Per-merchant webhook secrets; reconciliation job; migrations baseline; retention extension;
docs truth repair; circuit tests in CI (needs gate 2); EAS pipeline wiring for the circuit
staging script.

---

# Round 4 — P1 Remediation Fleet (2026-10-02)

**STATUS: IN FLIGHT.** Five streams (A coverage, B webhook secrets/rotation/migrations,
C settlement reconciliation + indexer webhook hardening, D build pipeline, E docs truth),
dispatched via dynamic-workflow run (ID recorded below). This section is owned by the LEAD.

## Phase 0 — ground-state re-verification (lead-run, 2026-10-02)

| Claim (from session prompt) | Disk verdict | Evidence |
|---|---|---|
| HEAD `f24c2a0`, 7 local commits, nothing pushed | CONFIRMED | `git rev-parse` + `git log origin/main..HEAD` (7 commits); `gh` authenticated; `gh run list` shows last origin runs 2026-09-06 (all failed, pre-round-3 world) — user gates 1–2 NOT done |
| Tree = known untracked user files only | CONFIRMED | `git status --porcelain=v1` matches §1.7 list exactly (`.claude/`, audit/prompt docs, `SCF_*`, `config/.env.example`, `.tmp-jest-after.log2`, …) |
| Round-3 invariants | ALL HOLD | `initializeRpcValidation` import (App.tsx:44 — App.tsx is at `apps/consumer-app/App.tsx`, NOT `src/App.tsx`); zero `checkForUpdateAsync`; zero `veilpay_app_password` writers (accountWipe.ts only DELETES the legacy key — by design); indexer `WEBHOOK_SIGNING_SECRET: z.string().min(16)` no default (config/index.ts:15) + dev-value rejection (:30); `infra/doppler.json` gone; README+SECURITY exist; health mounted before limiter (index.ts:102); per-attempt retry jobIds (webhookQueue.ts D5) |
| Circuit assets staged + gitignored | CONFIRMED | `ls apps/consumer-app/assets/circuits` → withdraw.wasm 2,609,423 B; withdraw_final.zkey 5,439,516 B; snarkjs.min.js/.umd 719,304 B |
| Indexer dispatcher apiKeyHash fallback still live (HIGH) | CONFIRMED | `apps/indexer/src/webhook/dispatcher.ts:33` — `secret: config.webhookSigningSecret \|\| merchant.apiKeyHash`; also: no SSRF guard (raw `globalThis.fetch`, 30s timeout, redirect-following), delivery row written only AFTER send (dispatcher.ts:87-106) |
| Quick scripts | PASS | `node scripts/validate-maestro-flows.mjs` → `UX-002 Maestro validation ok`, exit 0; `node apps/consumer-app/scripts/check-version-sync.js` → `OK: version 1.0.4 / build 16`, exit 0 |

Test-suite baselines are NOT re-run in phase 0 (round-3 matrix was green at exactly this
commit `f24c2a0` with a clean tree — re-established by the end-of-round matrix below).

### Deltas vs. the round-4 session prompt (disk wins)

1. **`apps/backend/prisma/migrations/` EXISTS** (two hand-written 2026-07-14 migrations:
   `chain_type_xlm_token_address`, `privacy_level_stealth_private` + `migration_lock.toml`) —
   the prompt's "no migrations baseline" premise is stale. These are ALTER-only patches on a
   db-push'd DB, not a from-empty history. Stream B's baseline therefore REPLACES the two
   stale dirs with a true offline-generated `0_init` (from-empty → pre-round-4 snapshot),
   then adds the round-4 migration on top; git history preserves the removed dirs. User-side
   adoption (gate 4) is unchanged in spirit: `migrate resolve --applied 0_init` → `migrate deploy`.
2. **`eas.json` carries a "$comment: DEPRECATED … must not be used for new builds"**, yet the
   live Android pipeline `.github/workflows/android-build.yml` ("Android Build (EAS Backup)")
   runs `eas build --local` and CONSUMES eas.json profiles. Stream D re-aims: circuit staging
   is wired fail-closed into BOTH the workflow (explicit step) and the EAS-local path
   (hook/profile), and the stale deprecation comment is corrected (OTA retirement ≠ EAS-local
   build retirement). eas.json currently wires NO hooks (the inject-doppler hooks in
   `eas-hooks/` are unreferenced); root `.env.example` still documents a "preInstallHook in
   eas.json" that does not exist — Stream E cleans that.
3. `apps/indexer/src/queue.ts` is actually `apps/indexer/src/queue/index.ts` (`enqueueWebhook`
   at :64); there is no `src/jobs/` in the indexer yet (Stream C creates it).
4. Round-3 board commit table lists landing commit as `ca7e4b6`; actual HEAD history shows
   `f24c2a0` — the tree was re-landed; harmless, recorded here for truth.

## Fleet dispatch

- Briefs (self-contained, outside the repo): `C:/Users/vahi1/.zcode/tmp/p4-fleet-briefs/stream-{A,B,C,D,E}.md`
- Grants (lead, pre-dispatch): Stream D additionally owns `.github/workflows/android-build.yml`
  — the live EAS-local pipeline the round-4 build-pipeline mission actually targets; the
  session prompt's owned-files list predates the discovery that EAS-local builds (not remote
  EAS) are the pipeline. No other grants.
- Workflow: dynamic-workflows run `dwfrun-841bfe0a-b908-43e3-b0c6-876905be4cee`
  (name "VeilPay round-4 P1 fleet") — 5 subagents ("Stream A — Coverage truth" …
  "Stream E — Docs truth"), typed `StreamResult`, live board artifact fed by per-stream
  `report()`, per-item catch, post-fleet `git status --porcelain=v1` snapshot, markdown
  claims artifact (primary). No max_concurrency / subagent_model (defaults). Briefs were
  written by the lead BEFORE dispatch with phase-0-verified file:line evidence.
  Results appended below as the run settles.

## Round 4 — results (lead-run, 2026-10-02)

**STATUS: COMPLETE. 5/5 streams done** (workflow `dwfrun-841bfe0a-b908-43e3-b0c6-876905be4cee`,
0 partial, 0 failed). Lead spot-checks: per-stream diff reads + one targeted test re-run
each — BiometricPrompt 11/11 (A), merchantKeyRotation 6/6 (B), dispatcher 21/21 (C),
eas-hooks 9/9 (D) — all reproduced green. Integration: `prisma generate` re-run (client
knows `webhookSecret`); NO `pnpm install` (no stream added dependencies — script entries
only); Stream E's six fill-in LEAD-PATCH markers replaced with B/C's final shapes and
`RECONCILIATION_DRIFT_CHECK_INTERVAL_MS` added to `.env.example` (folded into E's commit).

### Verification matrix (lead-run, sequential — ALL GREEN)

| # | Check | Result |
|---|---|---|
| 1 | `pnpm --filter @veilpay/backend typecheck` | clean, exit 0 |
| 2 | `pnpm --filter @veilpay/indexer typecheck` + `typecheck:scripts` (new) | clean, exit 0 — `merchant.webhookSecret` typechecks (the #1 cross-stream risk resolved) |
| 3 | `pnpm --filter consumer-app typecheck` | clean, exit 0 |
| 4 | `pnpm --filter @veilpay/backend test` | **65/65 suites, 424 passed + 2 skipped**, exit 0 (baseline 62/397+2; +3 suites from B) |
| 5 | `pnpm --filter @veilpay/indexer test` | **12/12 suites, 164 passed**, exit 0 (baseline 8/87; +4 suites from C) |
| 6 | `pnpm --filter consumer-app test -- --coverage` | **160+1 suites, 1145+1 tests, exit 0**; gate ENFORCED on the FULL re-expanded scope: 55.13% branches / 67.37% statements global (components 64.02 / stores 67.52 / hooks 52.77 / screens 51.06 / utils 62.46) |
| 7 | `node scripts/validate-maestro-flows.mjs` | `UX-002 Maestro validation ok`, exit 0 |
| 8 | `node apps/consumer-app/scripts/check-version-sync.js` | `OK: version 1.0.4 / build 16`, exit 0 |
| 9 | Prisma offline proofs | `validate` clean; snapshot→current diff == exactly the two statements in `1_webhook_secret_and_key_index`; `0_init` SEMANTIC-MATCHES the lead's from-empty regeneration (whitespace/header-only differences) |
| 10 | Regression greps | all round-3 invariants hold (`initializeRpcValidation` App.tsx:44; zero `checkForUpdateAsync`; indexer secret required, no default; `infra/doppler.json` gone; health:102 before limiter:104; per-attempt retry jobIds) + round-4: dispatcher `apiKeyHash` in comments only; SSRF guard before fetch (dispatcher.ts:210); rotation route (routes/merchant.ts:40); `@@index([apiKeyHash])` (schema.prisma:35); outbox create-before-enqueue (queue/index.ts:87 < :111) |
| 11 | `git status` | only stream-owned files + lead board/doc patches; §1.7 user files all present and untouched |
| 12 | `gh run list` | skipped — user has not pushed since round 3 (phase 0; per §5.12 condition) |

### Stream outcomes (claims → lead verification)

**A — Coverage truth (done).** 14 new/replaced test files (~+180 tests); measured then
raised per-dir branch coverage; re-expanded `collectCoverageFrom` to all five src dirs
(config diff: comment + two added globs only — lead read it); the one authorized full run
passed with the gate enforced at 55.13% branches. Debt surfaced: **11 line-1
`/* istanbul ignore file */` directives** make files invisible to the gate (7 screens, 3
hooks, utils/analytics.ts) — documented in jest.config.js and the debt register.

**B — Per-merchant secrets, rotation, baseline (done).** `0_init` from-empty baseline
(lead re-verified by regeneration) replacing the two stale 20260714 dirs (git history
preserves them); `1_webhook_secret_and_key_index` hand-written and reconciled offline;
`webhookSecret String?` + `@@index([apiKeyHash])`; per-merchant signing with a
once-per-process deprecation warning on global fallback (on-ramp status token deliberately
left global); `POST /api/v1/merchant/keys/rotate` with CAS `updateMany`, 409
`API_KEY_ROTATION_CONFLICT` on miss, key shown exactly once, old key 401s at auth; 62 new
tests across 7 suites; `prisma validate` + typecheck clean; every prisma command offline.
Disk-delta note: on-disk `verifyWebhook` took no merchant identifier — B extended it
(`?merchantId=` or a body field; absent → global fallback).

**C — Reconciliation + indexer hardening (done).** Reconciliation job + runnable script
(dry-run by default, `--apply`; never rewrites `Payment.txHash`; CAS-flips pending→paid);
drift job gated by `RECONCILIATION_DRIFT_CHECK_INTERVAL_MS` (default 0 = off) wired at
startup; `--forceExit` KEPT after a real removal trial (suites pass but jest hangs on the
queue module's module-level IORedis — documented, exit 143 without it); SSRF guard ported
as a keep-in-sync copy (shared package = P2 debt) and enforced at delivery time (DNS
pinning via custom agent, protocol-layer 3xx rejection, 10s timeout); durable outbox — the
WebhookDelivery row is created BEFORE enqueue (`wh-<deliveryId>` jobId) and updated to
delivered/failed; `apiKeyHash` signing fallback killed. **STRETCH landed (merchant-facing):
the indexer's outbound signature now matches the backend's** — bare-hex
`X-VeilPay-Signature` over `${timestamp}.${body}` + `X-VeilPay-Timestamp`, replacing the
old `sha256=` body-only format. Full suite 12/12 (164 tests).

**D — Build pipeline truth (done).** Circuit staging wired BOTH ways: the
`eas-build-post-install` npm lifecycle hook (verified from eas-cli source that EAS CLI 20
has no profile hooks key) + an explicit android-build.yml step before the build; staging
idempotency proven (two runs, exit 0, digests unchanged); fail-closed proven (tampered
sources → exit 1, staged bytes untouched); `--verify-pins` CI mode added (additive);
provenance verifier: **12 VERIFIED / 0 cannot-verify / 0 FAILED offline**, including a real
`snarkjs zkey verify` ("ZKey Ok!", ~24s), 26/26 Solidity-verifier constants (Fp2 pair-swap
convention), VK deep-equality, and documented on-chain comparison steps for user gate 6;
ci.yml: `contracts` isolated via `continue-on-error` + SPP-gate comment, new
`circuits-sanity` job, both workflows YAML-parsed; stale eas.json deprecation $comment
corrected. **New user gate: fresh CI checkouts cannot source the gitignored circuit
binaries — see user gate 7.**

**E — Docs truth (done).** README/SECURITY/.env.example/docs tell the verified truth (Node
24 via .nvmrc, real compose location, `SENTRY_DSN`, `DIRECT_URL`, `TRUST_PROXY_HOPS`,
circuit staging step, rotation + webhook recipe); stale OTA/app-password claims removed
(acceptance greps clean); every documented read-only command executed and listed; doc
links verified. Lead filled the six LEAD-PATCH placeholders with B/C's final shapes
(rotation response/409 schema, indexer signature parity note, per-merchant semantics,
SSRF rules, reconciliation CLI + drift flag) — folded into E's commit.

### Debt register additions (round 4)

- 11 line-1 `/* istanbul ignore file */` directives hide files from the coverage gate
  (Stream A measured this; removal is source-level work).
- Indexer queue module's module-level IORedis keeps jest alive post-run → `--forceExit`
  stays (removal trial documented).
- `urlSafety.ts` exists as a deliberate backend↔indexer copy ("keep in sync"); the shared
  package is P2 architecture work.
- The indexer signature-format alignment is merchant-facing: receivers verifying the old
  `sha256=` body-only format must switch (README documents the now-shared scheme).

## Round-4 user gates (NOT attempted — your moves)

1. **Push + protect** (unchanged): push round-3+4 commits, enable branch protection on
   `main` (require CI checks).
2. **SPP ref push** (unchanged): push SPP commit `05e3899…` to a reachable ref — until
   then the CI `contracts` job is `continue-on-error` (isolated, documented).
3. **Doppler rotation** (unchanged; runbook
   docs/security/doppler-rotation-and-history-purge.md).
4. **Railway env + migration adoption:** `SENTRY_DSN` (boot-required, backend AND
   indexer), `TRUST_PROXY_HOPS`, Postgres backups (top open audit finding). Then, on the
   EXISTING database: if `_prisma_migrations` contains rows for the two deleted 20260714
   dirs, clear them with `prisma migrate resolve --rolled-back <name>`; run
   `prisma migrate resolve --applied 0_init` (baseline adoption — no changes; the DB
   already matches the pre-round-4 schema); then `prisma migrate deploy` (applies
   `1_webhook_secret_and_key_index`). Finally seed/rotate per-merchant webhook secrets.
5. **Settlement reconciliation against production** (user-executed by design):
   `pnpm --filter @veilpay/indexer reconcile:settlements` (dry-run first), then
   `-- --apply`.
6. **Zkey provenance vs deployed contracts:** `node
   apps/consumer-app/scripts/verify-zkey-provenance.js --offline` prints the exact
   on-chain comparison steps.
7. **NEW — supply circuit binaries to CI:** `packages/circuits/build/` and the staged
   assets are gitignored, so the Android EAS-local pipeline fails closed on fresh runners
   until the ~10MB pinned artifacts are committed or supplied (CI cache/secret/artifact).
   Rebuilding cannot reproduce the pinned zkey (ceremony entropy) — the fail-closed design
   working as intended. Decide the supply mechanism.
8. App-password product direction + Play Integrity provisioning (roadmap, unchanged).

---

# Round 5 — Debt cleanup + restored HIGH findings (2026-10-02)

**STATUS: IN FLIGHT.** Six streams: A coverage completion (UI), B shared webhook-safety
package + per-merchant secret seeding, C test-lifecycle truth, D circuit-artifact supply +
CI/docs truth (+ phantom-Optimism fix), E onramp lifecycle (restored HIGH), F EVM privacy
withdraw-rail alignment (restored HIGH, latent). Dispatched as TWO dynamic-workflow runs for
model routing. This section is owned by the LEAD; no agent writes it.

## Phase 0 — ground-state re-verification (lead-run, 2026-10-02)

| Claim (from session prompt) | Disk verdict | Evidence |
|---|---|---|
| HEAD `3fdbb77`, 13 local commits, nothing pushed | CONFIRMED | `git rev-parse` → `3fdbb77`; `git log origin/main..HEAD` → 13; `git ls-remote origin main` → `8cea7cc` (remote UNMOVED since 2026-09-06); `gh run list --limit 5` → last origin runs 2026-09-06 (pre-round-3, all failed, expected); `gh release list` → empty. Round-4 user gates 1–8 ALL still open. `gh` authenticated (codeREDxbt). |
| Round-3 + round-4 invariants | ALL HOLD | `initializeRpcValidation` (App.tsx:44); zero `checkForUpdateAsync` in src; `infra/doppler.json` gone; README+SECURITY exist; health index.ts:102; dispatcher apiKeyHash comments-only, `merchant.webhookSecret ?? config.webhookSigningSecret` (dispatcher.ts:60), `assertSafeWebhookUrl` (dispatcher.ts:31/:210); keys/rotate (routes/merchant.ts:40); schema.prisma:20/21/35; migrations = `0_init` + `1_webhook_secret_and_key_index` + lock; ci.yml contracts `continue-on-error` (:173) + `circuits-sanity` (:144); eas.json no DEPRECATED; `.env.example` SENTRY_DSN(:76)/RECONCILIATION_DRIFT(:84); WebhookDelivery create (queue/index.ts:87) BEFORE enqueue (:111) |
| Circuit artifacts staged + gitignored | CONFIRMED | withdraw.wasm 2,609,423 B; withdraw_final.zkey 5,439,516 B; snarkjs.min.umd 719,304 B (+ snarkjs.min.js, README, .gitignore in dir) |
| 11 istanbul ignore directives | CONFIRMED | 7 screens + 3 hooks + utils/analytics.ts; exact list in jest.config.js:22-30 debt comment |
| Withdraw rail stale vs circuit | CONFIRMED | withdraw.circom public signals merkleRoot/nullifierHash/recipient/amount/**token** (:43-47), `verification_key.json` `nPublic: 5`; schemas backend withdrawRequest.ts:15 + consumer :16 both `.length(4)`; ProveInputs ZkpProver.tsx:274-283 = 8 keys, no `token`; property skip at ZkpProver.property.test.tsx:249; `validateNullifierHash` defined (nullifierHashValidation.ts:190) with ZERO call sites outside its own file; gate contracts.ts:115 = `false` |
| Onramp racy find-then-update | CONFIRMED | onrampController.ts:490 findFirst → :505 terminal guard (read-then-act) → :520 update; TERMINAL_STATUSES :22; nextStatus normalizer :510-518 sends refund-ish/unmatched → `failed`; FiatOrderStatus enum schema.prisma:213-219 (no `refunded`); CAS precedent services/paymentProcessor.ts:89 |
| urlSafety double copy | CONFIRMED | backend utils/urlSafety.ts (assertSafeWebhookUrl + rejectUnsafeWebhookUrl) + indexer webhook/urlSafety.ts ("keep in sync"); THREE import sites: webhookDelivery.ts:14, merchantController.ts:10, dispatcher.ts:31 |
| Optimism phantom docs | CONFIRMED | 7 hits: README.md:41, docs/chains/evm-networks.md:10, docs/README.md:30, docs/consumer-app/wallet-model.md:17, docs/chains/supported-networks.md:12, docs/getting-started/current-status.md:14, docs/getting-started/what-is-veilpay.md:29; chains.ts registry has NO Optimism (ids 1/56/137/42161/8453/11155111 + Solana + Stellar) |
| Quick scripts | PASS | `validate-maestro-flows` → UX-002 ok; `check-version-sync` → 1.0.4 / build 16 ok |
| Models | RESOLVED | `new-provider-3/kimi-k3` (CodeFast Kimi) available+enabled; session = `new-provider-2/glm-5.3`. No user stop needed. |

Test-suite baselines not re-run in phase 0 (round-4 matrix was green at exactly HEAD
`3fdbb77` with a clean tree; re-established by this round's end-of-round matrix).

### Deltas vs. the round-5 session prompt (disk wins)

1. **Model routing mechanics:** the workflow facade has NO per-call model selection → per
   §4.3, dispatch splits into TWO CreateWorkflow runs: run 1 = Stream A alone
   (`subagent_model: new-provider-3/kimi-k3`); run 2 = Streams B–F (`subagent_model` UNSET =
   session glm-5.3). No max_concurrency in either.
2. **`merchantController.ts:10` is a THIRD urlSafety import site** (`rejectUnsafeWebhookUrl`)
   beyond the two the prompt lists → pre-granted to Stream B (import line + call-shape only).
3. **Two Optimism hits sit OUTSIDE Stream D's owned docs globs** (docs/README.md:30,
   docs/consumer-app/wallet-model.md:17) → pre-granted to D (those lines only).
4. **`src/utils/maxSendable.ts:4` stale comment** mentions "istanbul ignore file" in a doc
   comment — would trip the acceptance grep → pre-granted to Stream A (comment reword only).
5. **`packages/*` glob already in pnpm-workspace.yaml** — Stream B's new package needs NO
   workspace-yaml edit; `packages/shared` is the structural precedent (`@veilpay/shared`,
   main `./src/index.ts`, `test: jest`, `build: tsc`; apps reference `"workspace:*"`).
6. Consumer `test:coverage` ALSO carries the duplicated `--forceExit` (package.json:19 AND
   :22) — Stream D de-duplicates both lines.
7. Prompt's "per-file branch numbers in the round-4 board" — the board carries per-DIR
   numbers only (jest.config.js:21-30); Stream A re-derives per-file numbers itself.

## Fleet dispatch (round 5)

- Briefs (self-contained, outside the repo): `C:/Users/vahi1/.zcode/tmp/p5-fleet-briefs/stream-{a,b,c,d,e,f}.md`
- Workflow runs:
  - Run 1 `dwfrun-0fb617c4-cc8b-497b-9d0e-bc67df849eb1` ("VeilPay round-5 fleet — Stream A
    (Kimi)", `subagent_model: new-provider-3/kimi-k3`) — **COMPLETE: A done.** All 11
    directives removed (+ the granted maxSendable.ts comment reword), jest.config.js debt
    comment updated, 9 suites extended + 2 new test files; the ONE authorized full run
    green: 162+1 suites, 1313+1 tests, gate enforced, per-dir branches components 65.43 /
    stores 67.53 / screens 61.93 / hooks 58.57 / utils 57.22, global 60.23% (round-4:
    55.13%). Disclosed testability seam: two dead pure helpers exported from
    HomeDashboardScreen.tsx (no behavior change). Claims artifact "Stream A claims report"
    (primary). Lead verification deferred to the end-of-round matrix (full coverage run
    re-runs there after F's property-test un-skip). No races observed; no git state
    mutations; owned-files-only diff.
  - Run 2 `dwfrun-f8c95cd4-111c-4918-92de-0ed0e767839d` ("VeilPay round-5 fleet — Streams
    B–F", session model glm-5.3, `subagent_model` unset) — **COMPLETE: B done, C partial
    (documented root-cause, accepted per brief), D done, E done, F done.** Claims artifact
    "Round-5 fleet claims (B–F)" (primary). Lead integration done: single `pnpm install`
    exit 0 (lockfile → landing commit), `prisma generate` clean, typechecks 3/3 clean,
    backend full 67/67 suites / 486 passed + 2 skipped / exit 0 (worker-teardown warning
    present per C's documented justification), indexer full 11/11 / 146 passed / self-exit
    without --forceExit. Lead patch: tests/migrations.baseline.test.ts expects
    2_onramp_states. Matrix items 1–5 verified; item 6 (consumer full coverage) was
    CANCELLED mid-run by the user — close-out (matrix 6–13, commits, results append)
    continues in a fresh session per `ROUND5_CONTINUATION_PROMPT.md` (untracked user file
    at repo root).
- Grants: pre-dispatch grants recorded in deltas 2–4 above. Mid-run grants:
  - `dwfq-f8c95cd4-1` → **Stream F (glm-5.3):** the five test files whose 4-element
    publicSignals fixtures the `.length(5)` schema change mechanically breaks —
    `apps/consumer-app/src/services/__tests__/relayerClient.property.test.ts`,
    `apps/consumer-app/src/stores/__tests__/sensitiveKeyIsolation.property.test.ts`,
    `apps/backend/src/controllers/__tests__/relayerController.maxWithdraw.test.ts`,
    `relayerController.forwarding.property.test.ts`,
    `relayerController.revert.property.test.ts` — mechanical 5-signal shape updates ONLY
    (per-element formats consistent with the signal order; same semantic assertions);
    targeted green runs required; these files land in F's commit. No other stream owns
    them (A finished without touching them; B/C/D/E lists exclude them).
    `relayerController.validation.property.test.ts` passes as-is and stays untouched.

---

## Round 5 — results (lead close-out, 2026-10-02, fresh session per ROUND5_CONTINUATION_PROMPT.md)

**STATUS: COMPLETE. 6/6 streams done + close-out landed.** Matrix items 6–13 were re-run
from scratch by the close-out lead (the interrupted item-6 consumer coverage run was
discarded and repeated cleanly); items 1–5 come from the round-5 lead's integration pass
over the identical tree bytes — the close-out only staged/committed, no content edits —
with items 1–3 (typechecks) and the package suite re-confirmed fresh at close-out. Seven
local commits on main, NOT pushed. The earlier `/tmp/r5-consumer-full.log` from the
cancelled run was ignored (garbage per the continuation prompt).

### Verification matrix (close-out, sequential — ALL GREEN)

| # | Check | Result |
|---|---|---|
| 1 | `pnpm --filter @veilpay/backend typecheck` | clean, exit 0 (re-confirmed at close-out) |
| 2 | `pnpm --filter @veilpay/indexer typecheck` + `typecheck:scripts` | clean, exit 0 (re-confirmed at close-out) |
| 3 | `pnpm --filter consumer-app typecheck` | clean, exit 0 (re-confirmed at close-out) |
| 4 | `pnpm --filter @veilpay/backend test` (round-5 lead) | **67/67 suites, 486 passed + 2 skipped, exit 0, zero TS2307** (baseline 65/65, 424+2); worker-teardown warning present — accepted per C's justification below |
| 5 | `pnpm --filter @veilpay/indexer test` (round-5 lead) | **11/11 suites, 146 passed, exit 0, real 8s, self-exits, no "Jest did not exit", no forceExit** (12→11 suites = B moved the urlSafety union into the package; net workspace test count UP) |
| 6 | `pnpm --filter consumer-app test -- --coverage` (re-run from scratch) | **166/166 suites, 1339 tests, 0 skips, exit 0; gate enforced** — branches components 65.24 / stores 67.52 / screens 61.92 / hooks 60.21 / utils 63.06, global 60.44% (round-4: 55.13%); F's round-trip test ran a child node process with real snarkjs; the jest-worker teardown warning appears here too (same documented cause) |
| 7 | `node scripts/validate-maestro-flows.mjs` | `UX-002 Maestro validation ok (2 critical flows, testIDs present in source)`, exit 0 |
| 8 | `node apps/consumer-app/scripts/check-version-sync.js` | `OK: version 1.0.4 / build 16 matches changelog.ts top entry`, exit 0 |
| 9 | Prisma offline proofs | `prisma validate` clean (dummy offline DIRECT_URL + DATABASE_URL — validate never connects); `git status --porcelain -- apps/backend/prisma/migrations` → ONLY untracked `2_onramp_states/` (0_init + 1_webhook_secret_and_key_index byte-identical, nothing modified); `prisma migrate diff` pre-round-5 schema → current schema → **exactly `ALTER TYPE "FiatOrderStatus" ADD VALUE 'refunded';`** |
| 10 | Regression greps | round-3 ALL hold (`initializeRpcValidation` imported+called App.tsx:44/:62; zero `checkForUpdateAsync` in src; indexer secret `z.string().min(16)`, no committed default, throws on dev default; `infra/doppler.json` gone; README+SECURITY exist; `/api/v1/health` mounted before `app.use("/api/", globalRateLimiter)`; per-attempt retry jobIds webhookQueue.ts D5); round-4 ALL hold (dispatcher `apiKeyHash` comments-only, `merchant.webhookSecret ?? config.webhookSigningSecret` :60; `assertSafeWebhookUrl` :210 before the single `httpSender` egress :228 with IP pinning; WebhookDelivery create queue/index.ts:122 BEFORE `webhookQueue.add` :146; `POST /api/v1/merchant/keys/rotate` routes/merchant.ts:40; `webhookSecret String?` schema :20 + `@@index([apiKeyHash])` :35; ci.yml `contracts` continue-on-error :173 + `circuits-sanity` :144; eas.json 0 DEPRECATED; `.env.example` SENTRY_DSN :76 + RECONCILIATION_DRIFT_CHECK_INTERVAL_MS :84); round-5 additions ALL hold (CAS `notIn` onrampOrderStatus.ts:172 via `applyOnrampStatusTransition` onrampController.ts:486; `refunded` in FiatOrderStatus enum :220; `ONRAMP_STATUS_POLLING_ENABLED` default `'false'` config :100; both withdrawRequest schemas `.length(5)` backend :23 / consumer :24; `token` in ProveInputs ZkpProver.tsx:284 + REQUIRED_INPUT_KEYS :322; `validateNullifierHash` called usePaymentTransaction.ts:1072; `EVM_MAX_PRIVACY_WITHDRAW_READY` contracts.ts:115 = `false`; zero optimism in README+docs; zero istanbul-ignore in non-test consumer src; zero forceExit in indexer package.json) |
| 11 | Shared-package truth | `grep -rn urlSafety apps/backend/src apps/indexer/src` → 22 lines, all accounted for: 3 import sites (webhookDelivery.ts, merchantController.ts, dispatcher.ts), 1 backend shim body, 4 test files with mocks; the indexer shim has ZERO content mentions (filename only); the ONLY implementation is `packages/webhook-safety/src/urlSafety.ts`. Package suite 28/28 exit 0; targeted re-runs: backend 4/4 suites / 56 tests (webhookDelivery 13 + merchantController 28 + TEST001_blockerGates 14 + tests/e2e/webhookDelivery 1 — the e2e B saw pass pre-install RE-VERIFIED green), indexer dispatcher 21/21 |
| 12 | `git status` | every tracked change maps to the stream plan (66 tracked changes incl. 2 deletions + 15 new untracked intended files = 81 round-5 files); §0 user untracked files all present and untouched; `pnpm-lock.yaml` modified (the integration install); only the 3 expected package.json files changed (backend=B, consumer=D, indexer=B+C split) |
| 13 | `gh run list --limit 10` | remote main still `8cea7cc` (2026-09-06, pre-round-3); local main now 20 commits ahead (13 + this round's 7); last origin runs 2026-09-06 — nothing to chase, gates stand |

### Stream outcomes (round 5 — model routing per user directive)

- **A — coverage completion: DONE** on CodeFast Kimi `new-provider-3/kimi-k3` (run
  `dwfrun-0fb617c4-cc8b-497b-9d0e-bc67df849eb1`): 11 istanbul directives removed (+ the
  granted maxSendable.ts comment reword), 9 suites extended + 2 new; the gate now sees the
  full five-dir scope — final close-out run green (matrix 6).
- **B — shared webhook-safety: DONE** on session `new-provider-2/glm-5.3` (run
  `dwfrun-f8c95cd4-111c-4918-92de-0ed0e767839d`): new config-free policy-parameterized
  `packages/webhook-safety` (28/28 union suite); both app urlSafety copies reduced to thin
  policy-binding shims (import sites unchanged); both app urlSafety test files deleted
  (union lives in the package); dry-run-default seed-webhook-secrets.ts (CAS on
  `webhookSecret: null`, 16/16 mocked-prisma tests); SECURITY.md two rows.
- **C — test lifecycle: DONE (partial by design, accepted per brief)** on session
  `new-provider-2/glm-5.3`: indexer jest self-exits without --forceExit (lazy BullMQ-safe
  queue connection + guarded afterAll teardown); backend warning root-caused to
  jest-worker's fixed 500ms FORCE_EXIT_DELAY — see the justification note below.
- **D — circuit supply + docs truth: DONE** on session `new-provider-2/glm-5.3`:
  supply-circuit-assets.js (https/file://+local-dir sources, SHA-256 verified against the
  baked pins BEFORE staging, fail-closed exit 1, 22 mocked tests) + android-build.yml
  supply step keyed on `vars.CIRCUIT_ARTIFACTS_URL` + `circuits:supply` entry; duplicated
  `--forceExit` removed from both consumer script lines; all 7 phantom-Optimism claims
  removed; new docs/reference/circuit-asset-supply.md.
- **E — onramp lifecycle: DONE** on session `new-provider-2/glm-5.3`: terminal-state CAS
  write path via services/onrampOrderStatus.ts; `refunded` in FiatOrderStatus + hand-written
  offline-verified `2_onramp_states` (ALTER TYPE ADD VALUE alone); completed never →
  failed; config-gated DEFAULT-OFF provider status polling (10s AbortController timeouts,
  status-only writes); 97/97 targeted tests incl. the replay property suite.
- **F — withdraw-rail alignment: DONE** on session `new-provider-2/glm-5.3`: 5-signal
  circuit truth ([merkleRoot, nullifierHash, recipient, amount, token], nPublic 5) wired
  through ProveInputs, both `.length(5)` schemas, `validateNullifierHash` pre-proof, and
  `serializePublicSignalsForRelay`; Property 12 un-skipped and green; real snarkjs
  prove→verify→serialize→dual-schema round-trip test vs the staged artifacts; 5 granted
  fallout files green; rail still gated OFF. Documented gap: the relayer `proof` field is
  still a blind cast (deferred to tasks 11.x).

### C warning-justification note (backend full run)

The backend full run prints "A worker process has failed to exit gracefully and has been
force exited" — this is jest-worker's fixed 500ms exit deadline (`FORCE_EXIT_DELAY` in
jest-worker), timing-dependent and repo-wide (the same warning appears in the consumer's
round-4 and round-5 logs). Round-3's redis.ts:125 suspicion was DISPROVEN; a guarded
per-file redis teardown landed anyway (`apps/backend/tests/teardown.ts` via
setupFilesAfterEnv). A warning-free green full run requires `--runInBand` (5–8x backend
wall time) — documented, left to the user; the suite itself is green with exit 0.

### Commits (local, on main, NOT pushed — per user gate)

| Hash | Stream | Subject |
|---|---|---|
| `d958d42` | A | test(app): complete branch coverage, remove istanbul ignores |
| `36f5782` | B | refactor(webhook): shared url-safety package + per-merchant secret seeding |
| `7cd1390` | C | test(lifecycle): indexer jest exits without forceExit; backend clean teardown |
| `c4ed487` | D | ci(build): pinned circuit-artifact supply; CI truth; script hygiene |
| `fd09183` | E | feat(onramp): CAS terminal transitions, refund states, provider polling fallback |
| `b6d8ad9` | F | fix(circuits): align EVM withdraw rail to the 5-signal circuit; un-skip proof fidelity |
| (this commit) | landing | chore: land round-5 tree |

The B/C split of `apps/indexer/package.json` executed as planned: B's commit carries only
the `@veilpay/webhook-safety` dependency hunk (staged diff verified to be exactly that
hunk), C's commit carries the de-forced script lines (the remaining 2-line diff).

### Debt register additions (round 5)

- F: the relayer withdraw request's `proof` field is still a blind cast — proof-object →
  abi-encoded hex serialization is deferred (tasks 11.x); the local schema gate rejects
  objects fail-closed.
- C: killing the jest-worker teardown warning repo-wide costs `--runInBand` (5–8x backend
  wall time) — left to the user.
- The withdraw-rail round-trip suite self-skips on fresh clones (staged wasm/zkey are
  gitignored) — supply/stage first.
- B: `apps/backend/scripts/audit-webhook-urls.ts` still consumes the shim (fine), and the
  un-owned app test files still jest.mock the OLD wrapper paths (by design — the shims
  keep those factories valid).

### Round-5 user gates (NOT attempted — your moves)

1. **Push + protect** (unchanged): 20 local commits now sit unpushed (rounds 3–5); enable
   branch protection on `main` with required CI checks once pushed.
2. **Railway env + migration adoption** (round-4 gate 4, extended): on the EXISTING
   database, after the round-4 resolve sequence, `prisma migrate deploy` now also applies
   `2_onramp_states` (ALTER TYPE ADD VALUE 'refunded'). Decide whether the onramp
   status-polling fallback should run at all (`ONRAMP_STATUS_POLLING_ENABLED`, default
   OFF).
3. **Circuit-binary supply for CI** (round-4 gate 7, mechanism now exists): upload the
   three pinned binaries to a GitHub release + set the repo variable
   `CIRCUIT_ARTIFACTS_URL` — or decide to commit the binaries instead.
4. **Per-merchant webhook secret seeding** (post-migration): run the new
   `apps/backend/scripts/seed-webhook-secrets.ts` (dry-run first, then `--apply`).
5. **Withdraw-rail enablement** (unchanged): `EVM_MAX_PRIVACY_WITHDRAW_READY` stays `false`
   until the relayer proof serialization (tasks 11.x) and Play Integrity decisions land.
6. **Round-6 preview** (do NOT start — next session): Play Integrity provisioning, DSAR
   tooling, retention extension (invoices / permanent_failure webhooks /
   archive-before-delete for fiat past chargeback windows), perf/deps P2 (merchant-stats
   groupBy, Skia removal, node-fetch, ethers/viem consolidation, Dependabot + scheduled
   audit, APK/bundle budgets), per-chain allowlist expansion, committing circuit binaries
   vs supplying, app-password product direction.

### Post-push addendum (2026-10-02, same close-out session)

User lifted gate 1 and instructed the push: `git push origin main` → `8cea7cc..2c01880`,
20 commits landed (rounds 3–5). First-run CI verdict: **circuits-sanity ✓ (9s, offline
pins + provenance hold on a fresh runner); contracts ✗ at Checkout and Android Build ✗ at
Checkout — both the documented SPP submodule gate (`packages/vendor/spp` lacks reachable
`05e3899…`, user gate 2); workspace ✗ at "Lint backend" — NOT round-5 damage**: the
backend and indexer never had ESLint configs (only the consumer app did), the shared
`config/.eslintrc.js` was never committed, and their `eslint src/` scripts expand only
`.js` in ESLint 8 — CI simply had never survived "Install dependencies" far enough to
reach the step (the 2026-09-06 runs died there in 12s).

Repaired in the follow-up commit `9ec4a0e`: committed the shared base
`config/.eslintrc.js`; added `apps/backend/.eslintrc.js` + `apps/indexer/.eslintrc.js`
extending it (consumer-idiom relaxations limited to the rule classes that actually fire;
`checkLoops: false` for the deliberate `while (true)` prune loops in retentionPurge.ts);
lint scripts now `eslint src/ --ext .ts`; one dead test type removed (HandlerBag,
indexer dispatcher.test.ts — suite still 21/21). Local verification: all three lints exit 0
with 0 errors (6/3/1577 warnings respectively — warnings don't gate), pnpm audit
--audit-level=high clean, a11y smoke ok, typechecks/tests previously green this session.

**Second latent break (run 37046632517):** the lint repair advanced the workspace job
through Lint/Typecheck/Test for backend AND indexer (first time in repo history those
passed on CI) plus consumer lint + a11y smoke — then died at "Typecheck consumer app" on
TS2307: `expo-modules-core` (both native module bridges) and `expo-asset` (ZkpProver).
Root cause: the root `.npmrc` (`node-linker=hoisted`) was untracked (gitignored
"local-only") — CI's default ISOLATED pnpm layout doesn't hoist transitive deps, so
undeclared imports that resolve locally via the flat tree fail on fresh runners. Same
disease class as the eslint-config bug: local-only config silently shaping verified
behavior. Repaired in the next commit: declared the actually-imported packages in
consumer-app (`circomlibjs` ^0.1.7, `expo-asset` ~55.0.18, `expo-file-system` ~55.0.24,
`expo-modules-core` ~55.0.25 — all matching versions already in the lockfile, zero
drift), added the `expo-modules-core: "*"` peer to both native module packages,
committed the hoisted root `.npmrc` (and un-ignored `.npmrc` in .gitignore) so CI
installs the exact layout every local verification ran against. Lockfile diff verified
additive-only; local re-verification after the reinstall: consumer typecheck exit 0,
consumer full coverage run 166/166 suites / 1339 tests exit 0, backend + indexer
typechecks exit 0. Debt note: the hoisted layout masks phantom-import hygiene — the
isolated-layout switch (now unblocked by the declared deps) stays round-6 material.
Expected CI after this commit: workspace + circuits-sanity GREEN; contracts + Android
Build remain red on the SPP user gate (by design, isolated).
