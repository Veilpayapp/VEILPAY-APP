# Merge readiness — 2026-07-14

## Branch map (checked this session)

| Branch | Tip (approx) | vs `origin/main` | Role |
|--------|----------------|------------------|------|
| **main** *(current)* | `99800c2` + **dirty product WT** | **ahead 5**, 0 behind | Active line; includes harden history + SEC-013 Aptos etc. |
| **origin/main** | 5 commits behind local `main` | — | Remote production tip |
| **harden/consumer-a1-and-spp-phase0** | `f34afc5` | ancestor of local `main` | Fully contained in `main`; no unique commits left |
| **docs-site** | `7d6d4ef` | **behind** local `main` heavily | Docs-only history already folded via prior merge into harden → main |
| **Worktrees** | single: `D:/Veilpay` | — | No extra worktrees |

```text
origin/main ──► (5 local commits on main) ──► 99800c2 tip
                      ▲
                      └── harden tip f34afc5 is an ancestor (no re-merge needed)
docs-site is behind; do not FF main into docs-site without intent
```

## Dirty working tree (product only after junk cleanup)

**Safe junk removed this session**

| Item | Action |
|------|--------|
| Untracked `.agents/skills/*` copies (21 skill trees) | Deleted |
| Untracked `packages/antigravity-utils/skills/*` duplicates | Deleted |
| `graphify-out/GRAPH_REPORT.md` noise | Restored to HEAD |
| `pnpm-lock.yaml` accidental churn | Restored to HEAD |
| `packages/vendor/spp` poseidon2 Cargo.toml reformat | Restored in submodule |

**Keep (product — do not delete)**

- Pass B backend: payment verify, GoldRush, Stellar Horizon, auth, token registry, migrations, …
- Consumer: SSL pins fail-closed, stellar USDC, secure screens, token catalog, …
- Solana SEC-007: real Groth16 + `MAX_SCAFFOLD_LEAVES` deploy gate
- Docs: SEC-008/011 ceremony-and-audit-gates + checklist updates
- `plans/SECURITY-HANDOFF.md`

## Can we merge / push **right now**?

### Short answer: **NO — not until product dirty tree is selectively committed**

| Check | Result |
|-------|--------|
| Extra worktrees with divergent junk? | **None** |
| Orphan skill junk in WT? | **Cleaned** |
| `harden` needs merge into `main`? | **No** — already ancestor |
| `docs-site` needs merge into `main`? | **No** — already folded historically; branch is stale |
| Local `main` vs `origin/main` | **5 commits ahead** (safe to push *after* review) **plus uncommitted Pass B/SEC work** |
| Uncommitted product | **Large** — must selective-commit before any push that claims “main is complete” |
| Force-push needed? | **No** — never force-push `main` |

### Recommended sequence (operator)

```text
1. Stay on main (or create feature branch from main for the dirty WT if preferred).
2. Selective commits ONLY (never git add -A):
   a. backend Pass B + payment/Horizon/tokenAddress/migrations
   b. consumer security + stellar token catalog
   c. contracts-solana SEC-007 + scaffold gate
   d. docs SEC-008/011 + handoff
3. Run focused tests:
   - apps/backend: paymentTxVerifier, goldrush, chainIndexer, stellarHorizon, rpc, auth
   - apps/consumer-app: security.test
   - packages/contracts-solana: cargo test --lib
4. Optional: full monorepo CI / PR against origin/main.
5. git push origin main   # only after (2)+(3); fast-forward remote by 5 + new commits
6. Optional: delete or archive stale local branch docs-site / harden after confirming no unique commits:
     git branch -d harden/consumer-a1-and-spp-phase0   # safe if fully merged
     # docs-site: only delete if team agrees remote origin/docs-site is still wanted for GitBook
```

### Do **not**

- `git add -A` (skills/graphify/vendor/lockfile noise)
- Force-push `main` or `origin/main`
- Merge `docs-site` into `main` without reading history (risk of docs regression)
- Claim mainnet privacy ready without SEC-008/011 sign-off

## Pre-merge / pre-push checklist

- [ ] Dirty product files reviewed (see code review 2026-07-14)
- [ ] Selective commits landed
- [ ] Focused Jest + Solana unit tests green
- [ ] Prisma migrate plan for production noted
- [ ] Doppler secrets checklist (relayer secret, SSL pins, RPC keys)
- [ ] SEC-008/011 docs present; gates still open (process) — OK for dogfood, not for “mainnet privacy”
- [ ] No untracked junk skill trees
- [ ] Submodule `packages/vendor/spp` clean

## Verdict

| Action | Ready? |
|--------|--------|
| Delete junk / skills noise | **Done** |
| Push existing 5 commits alone | Possible but **incomplete** (leaves Pass B uncommitted) |
| Push “full security remediation” | **After selective commits** |
| Mainnet privacy marketing | **No** (SEC-008/011 open) |
| Dogfood pool-ops | **Yes** (prior remaster) with clear labels |
