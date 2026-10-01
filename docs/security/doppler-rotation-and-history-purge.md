# Doppler credential rotation & (optional) git history purge

**Runbook owner:** repository operator (user-executed — do NOT automate; do NOT let an agent
run these steps). The commands below rewrite git history and invalidate credentials.

**Status of the offending file:** `infra/doppler.json` has been deleted from the working
tree (uncommitted deletion). This runbook covers what deletion alone does not.

---

## 1. Why deletion is not enough

`infra/doppler.json` was a **4,370-byte encrypted Doppler credential blob** committed to
git:

- Added at the repo root as `doppler.json` in commit `f6e821e` ("chore: remove junk audit
  files and fix root app.json config"), then moved to `infra/doppler.json` in `ebbdea1`
  ("chore: reorganize root directory ...").
- The file itself is a single line of ciphertext (header `4:base64:...`); it contains **no
  readable plaintext and no readable project/config metadata** — verified by inspecting the
  blob before deletion.
- It was flagged twice by the project's own audits and never removed:
  - `AUDIT_2026-09-08_MASTER.md` ("encrypted Doppler token blob committed to git — flagged,
    not reproduced")
  - `FINAL_AUDIT_REPORT.md` (same finding)

Deleting the file in the working tree removes it from **future** commits only. Every commit
between `f6e821e` and the deletion still contains the blob, so:

- Anyone who clones or forks the repo, or browses an old commit, still gets the ciphertext.
- Anyone with the blob **and** the decryption key (e.g. a machine or backup where it was
  used) can recover the credentials it protects.

Therefore remediation has two parts, in this order: **rotate the credentials (mandatory),
then optionally purge the history.**

## 2. Credential rotation in Doppler (MANDATORY — do this first)

### 2.1 Identify the affected project/config

The blob is fully encrypted, so it does not name its own project/config. Use the repo's
recorded consumers as the rotation scope (verified in the working tree):

| Consumer | Evidence |
| :--- | :--- |
| Local release APK builds | `apps/consumer-app/scripts/build-apk-windows.ps1:153` runs `doppler run --project veilpay --config prd -- cmd /c ".\gradlew.bat ..."` |
| Consumer-app Doppler scoping | `apps/consumer-app/.doppler.yaml` → `project: veilpay`, `config: prd` (gitignored, per-machine) |
| EAS build secrets (historical) | `doppler run --project veilpay --config prd` injection documented in `config/.env.example` (EAS/OTA is now discontinued — see the deprecation comment in `apps/consumer-app/eas.json` — but any surviving DOPPLER_TOKEN secret must still be rotated) |
| Railway backend + indexer | Production env values are sourced from Doppler and set in the Railway dashboard (`infra/railway.json` contains no secrets itself) |

Treat **every config in the `veilpay` project** as affected unless you can prove otherwise
(the ciphertext may cover any of them). If a separate `veilpay-consumer-app` project exists
(the EAS default in `config/.env.example`), rotate it too.

### 2.2 Rotate the secrets (Doppler dashboard)

For each affected project/config in the Doppler dashboard (**Project → config →
Secrets**), replace the value of every secret the config serves. At minimum the set the
backend fails closed without (see `.env.example` / `config/.env.example`):

- `JWT_SECRET`, `API_KEY_SALT`, `WEBHOOK_SIGNING_SECRET` (fresh `openssl rand -hex 32`
  values)
- `RELAYER_SHARED_SECRET`, `RELAYER_PRIVATE_KEY`
- Provider keys: `ALCHEMY_API_KEY`, `INFURA_API_KEY`, `GOLDRUSH_API_KEY`
- Any other live values in the config (DB/Redis credentials, SPP manifest secrets)

### 2.3 Rotate the service tokens

If the blob encodes a Doppler **service token** (the audits call it a "token blob"):

1. Dashboard → **Project → Access → Service Tokens** → **Revoke** the old token.
2. **Create** a replacement token with the same scopes/configs (the token value is shown
   exactly once — copy it then).
3. If the blob is instead a CLI/personal login, revoke it under account settings and
   re-authenticate with `doppler login` on the machines that need CLI access.

### 2.4 Update every consumer

- **Railway backend + indexer:** re-paste the new secret values into the Railway service
  variables (Doppler does not push to Railway automatically unless you have an integration
  — check the project's Integrations tab), then redeploy both services.
- **Local release builds:** the build machine must hold the new service token / login
  (`doppler login` or re-install the token), then confirm
  `doppler run --project veilpay --config prd --` still resolves secrets before building
  (see `apps/consumer-app/scripts/build-apk-windows.ps1`).
- **EAS (historical):** if `DOPPLER_TOKEN` was created as an EAS secret
  (`eas secret:create --scope project --name DOPPLER_TOKEN --value <token>`), overwrite it
  with the new token — or delete it, since EAS/OTA is discontinued.
- **Everywhere else:** search your infra for other places the old values or token were
  pasted (CI variables, `~/.doppler*` on dev machines, backups).

### 2.5 Verify rotation

- Backend and indexer redeploy and boot (they fail closed on missing/invalid keys —
  `config/.env.example` documents the required set).
- A `doppler run --project veilpay --config prd --` command resolves the new secrets.
- The old token is rejected (the point of revocation).

## 3. OPTIONAL: purge the blob from git history (user-executed)

Rotation makes the historical ciphertext **dead** (it decrypts to revoked credentials).
Purging is optional hygiene: it removes the dead ciphertext from history so it can never
be resurrected, and drops a 4.3KB blob from every future clone.

> **Read the coordination warnings (3.3) before running anything.** History rewrite changes
> every commit hash. Both procedures below are user-executed on a fresh clone — never on
> this working tree, and never by an automated agent.

### 3.1 Option A — `git filter-repo` (recommended)

```bash
# 1. Fresh clone with submodules (filter-repo is designed for fresh clones; it will
#    refuse to run on a repo with uncommitted changes or remotes without --force).
git clone --recurse-submodules <repo-url> veilpay-purge
cd veilpay-purge

# 2. Install: pip install git-filter-repo   (or your package manager's equivalent)

# 3. Strip the blob. The file lived under TWO paths:
#      doppler.json          (added in f6e821e)
#      infra/doppler.json    (moved in ebbdea1)
#    --path is repeatable; --invert-paths keeps everything EXCEPT the listed paths.
git filter-repo --path infra/doppler.json --path doppler.json --invert-paths

# 4. filter-repo removes the origin remote as a safety measure — re-add it, then
#    force-push all refs.
git remote add origin <repo-url>
git push --force --all origin
git push --force --tags origin

# 5. Verify the blob is gone:
git log --all --full-history --oneline -- infra/doppler.json doppler.json   # → empty
git rev-list --objects --all | grep -i doppler.json                        # → empty
```

### 3.2 Option B — BFG Repo-Cleaner

```bash
# 1. Fresh MIRROR clone (BFG requires a mirror clone).
git clone --mirror <repo-url>

# 2. Delete every file named doppler.json (BFG matches by filename, so it covers
#    both the root doppler.json and infra/doppler.json paths).
java -jar bfg.jar --delete-files doppler.json <repo-name>.git

# 3. Clean up the now-unreachable objects.
cd <repo-name>.git
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# 4. Force-push the rewritten history back.
git push --force

# 5. Verify as in 3.1 step 5 (in a normal clone of the rewritten repo).
```

### 3.3 Coordination warnings — read before rewriting

- **Every commit hash changes.** All clones become invalid: every developer must **re-clone**
  (a fetch/pull will not converge onto rewritten history). Old local branches must be
  rebased onto the new history or re-created from the new clone.
- **Open PRs must be rebased** (or re-opened) against the rewritten `main` — GitHub may
  show them as conflicted or silently stale.
- **Do it in a quiet window:** announce the rewrite beforehand, tag the last pre-rewrite
  commit so people can find the old hashes, and make sure no builds or deploys reference
  a specific old commit SHA (Railway deploy hooks, EAS builds, release tags).
- **Submodules:** this repo pins three submodules (`.gitmodules`), including the SPP pin
  `packages/vendor/spp` → `NethermindEth/stellar-private-payments`. Filtering the
  **superproject** does not rewrite the submodules' own repositories, so the pins remain
  valid — but submodule commit hashes recorded in history will map to rewritten superproject
  commits. Anyone with workflows that cross-reference old superproject hashes and submodule
  state must re-sync (`git submodule update --init --recursive`). Treat this as a
  **coordinated operation**, not a one-person task.
- **Server-side residue:** after a force-push, old commits can remain reachable on GitHub
  for a while (cached PRs, forks, API caches). Forks keep the old history — rotation is
  what actually protects you; the purge is hygiene. Contact GitHub support to request an
  aggressive GC of the repo if full removal matters.
- **Local residue:** every existing clone and backup still holds the old history. The
  `git reflog expire ... && git gc ...` step (3.2) only cleans the repo it runs in;
  re-clone or repeat it per machine.

---

*Deletion of `infra/doppler.json` from the tree was performed as part of P0 hygiene
remediation; this runbook is the operator-facing follow-through. Nothing here has been
executed — rotation and any history purge are deliberately left to a human operator.*
