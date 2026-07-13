# Branch study + merge readiness (2026-07-13)

## Branch map (after cleanup)

| Branch | Tip | vs `main` (`82cdd40`) | Role |
|--------|-----|------------------------|------|
| **main** / **origin/main** | `82cdd40` | — | Production tip (build 11 logo) |
| **harden/consumer-a1-and-spp-phase0** *(current)* | `823ad27` + **dirty WT** | **25 commits ahead, 0 behind** | **Real product branch** (A1, SPP, hardening) |
| **docs-site** | `7d6d4ef` | 1 commit ahead, 0 behind | GitBook docs only (not fully inside harden) |
| ~~fix/react-doctor-render-regressions~~ | deleted | was ancestor of main | obsolete |
| ~~confusion-lift~~ | deleted | was ancestor of main | obsolete worktree branch |
| ~~subagent-Audit-Sweep…~~ | deleted | ancient ancestor | obsolete |

**Remotes:** `origin/main`, `origin/docs-site` only.

---

## Can we merge into main **right now**?

### Short answer (updated after cleanup commits): **YES — local FF-ready; do not push without review**

As of tip **`bdd9f3d`** on `harden/consumer-a1-and-spp-phase0`:

1. ~~Working tree dirty with product uncommitted~~ → **product committed** (`df47537`, `622a1ea`).
2. ~~docs-site separate~~ → **merged** (`bdd9f3d`, conflicts resolved keeping harden reframes).
3. `main` is **ancestor** of harden → **`git merge --ff-only` from main works**.
4. Focused Jest green (backend 65, consumer 23). Full monorepo CI still recommended on PR.
5. Only dirty path left: local `graphify-out/GRAPH_REPORT.md` (optional regen; not required for app).

### What *is* true

- `harden` **fast-forwards cleanly from main** at the *committed* tip (`main` is ancestor of `823ad27`).
- Committed-only merge `main ← harden@823ad27` is **no conflict** at the commit level (no concurrent main changes).
- Device dogfood already validated pool-ops release path.

---

## Safe merge recipe (do this next session / next step)

```text
1. On harden: finish cleanup (done for junk) + stage ONLY product files
2. Commit 1–3 logical commits (or one "harden: phases 0–5") — NO apk/build-artifacts/.local
3. git merge docs-site   # fold the missing docs commit (or cherry-pick 7d6d4ef)
4. Run: backend jest + consumer jest (at least TEST001 + payment + spp)
5. Optional: rebuild release APK via scripts/build-apk-windows.ps1
6. PR or: checkout main && git merge --ff-only harden/… && push origin main
```

**Do not** force-push main. Prefer PR.

---

## Cleanup performed (this session)

### Deleted untracked bulk junk
- `.local/` (~235 MB)
- `New logo/`, `Spp screenshots/`
- `apps/consumer-app/build-artifacts/` (~195 MB APKs — **rebuild with Doppler script when needed**)
- `veilpay-docs.zip`

### Removed from git index (tracked slop — app code untouched)
tmp diffs, eslint dumps, react-doctor reports, figma fetch scripts, env_backup.zip, one-off migrate/audit scripts, `$null` file, etc. (**29 files** `git rm`)

### `.gitignore` hardened
APKs, build-artifacts, `.local/`, env backups, dump patterns, agent tool dirs.

### Local branches pruned
`fix/react-doctor-render-regressions`, `confusion-lift`, `subagent-Audit-Sweep-Specialist-research-a5087811`

---

## Still KEEP (not junk)

Untracked product files that **must** be committed before merge:

- Backend: `paymentTxVerifier`, `relayerAuth`, `urlSafety`, `relayerQuota`, `onrampStatusToken`, TEST001, tests
- Consumer: SPP recovery/activity, privacy gates, build-apk-windows.ps1, audits plans, logo helpers, etc.
- `.npmrc` / `.nsprc.example` (toolchain / audit config — review contents before commit)

---

## App safety note

Cleanup **did not** delete:

- `apps/**` source of truth product modules  
- `packages/spp-native` sources  
- `node_modules`  
- Doppler/EAS config  

APKs were local artifacts only; dogfood APK must be rebuilt if needed:

`apps/consumer-app/scripts/build-apk-windows.ps1 -Configuration release`
