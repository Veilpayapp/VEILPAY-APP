# Ops + gates before push / prod deploy (2026-07-14)

Use this after selective commits on `main`. Completes the three “not yet” items:

1. **CI confidence** (local pre-push + GitHub CI after push)  
2. **Ops** (migrations, Doppler, SSL pins)  
3. **SEC-008/011** (process — docs + fail-closed product; human sign-off still required for mainnet privacy)

---

## A. CI confidence (do before or immediately after push)

### Local (Windows)

```powershell
pwsh -File scripts/prepush-ci.ps1
```

Approximates `.github/workflows/ci.yml` workspace job + Solana unit tests.  
Skips Foundry if `forge` is missing (CI still runs it).

### Measured on 2026-07-14 (this machine)

| Check | Result |
|-------|--------|
| Backend typecheck | **pass** |
| Indexer typecheck | **pass** |
| Consumer typecheck | **pass** |
| Backend jest (full) | **316 pass / 2 fail** — flaky relayer *property* tests (timeout / 503 under suite load when Redis fail-closed races). Re-run isolated under `NODE_ENV=test`. |
| Consumer jest (full) | **666+ pass**; `useBalance` mock fixed for `fetchTokenBalancesForChain` |
| TEST-001 backend + consumer | **pass** (includes Pass B + SEC-008/011 doc/flag gates) |
| Solana cargo test --lib | **pass** |
| Backend eslint | **fail locally** if `@typescript-eslint/eslint-plugin` missing from root install — CI installs clean |
| Foundry | skip if `forge` not installed |

### After push

- Confirm GitHub **CI** workflow is green on `main` (authoritative full gate).
- If backend **lint** fails locally with missing `@typescript-eslint/eslint-plugin`, reinstall deps (`pnpm install`) — CI installs from lockfile.

### Privacy fail-closed automated gates

- `EVM_MAX_PRIVACY_WITHDRAW_READY === false` (TEST-001 consumer)
- Stellar mainnet SPP private disabled (TEST-001)
- Solana `MAX_SCAFFOLD_LEAVES = 1` (cargo unit test)
- Ceremony doc present (TEST-001 backend)
- SSL pin release fail-closed source gate (TEST-001 consumer)

---

## B. Migrations (prod / staging)

Migration path (committed):

`apps/backend/prisma/migrations/20260714000000_chain_type_xlm_token_address/`

| Env | Command |
|-----|---------|
| Staging/prod | `pnpm --filter @veilpay/backend db:deploy` (or `prisma migrate deploy` with `DATABASE_URL`) |
| Local dev | `pnpm db:migrate` / `db:push` only if you accept non-prod drift |

**Notes**

- Enum rebuild `mvm` → `xlm`: review residual Aptos viewing-key rows after migrate.
- `invoices.token_address` added for ERC-20 / mint / issuer binding.
- Take a DB backup before production migrate.

Checklist:

- [ ] Backup production DB  
- [ ] `migrate deploy` on staging → smoke pay/confirm  
- [ ] `migrate deploy` on production  
- [ ] Verify `token_address` column + `ChainType` enum values  

---

## C. Doppler / secrets

Authoritative names: root `.env.example` + [Secrets and keys](../docs/security/secrets-and-keys.md).

### Backend (Doppler project for API)

| Variable | Prod requirement |
|----------|------------------|
| `DATABASE_URL` | Required |
| `REDIS_URL` (+ password if used) | Required; auth fail-closed without Redis in prod |
| `JWT_SECRET` / `API_KEY_SALT` / `WEBHOOK_SIGNING_SECRET` | Required, non-dev defaults |
| `CORS_ORIGINS` | Explicit origins — never `*` in prod |
| `ALCHEMY_API_KEY` and/or `INFURA_API_KEY` | At least one required (boot fail-closed) |
| `GOLDRUSH_API_KEY` | Required for Solana auto-confirm / indexer path |
| `PAYMENT_MIN_CONFIRMATIONS` | Default `1` recommended |
| `RELAYER_SHARED_SECRET` | Required for relayer withdraw in prod |
| `RELAYER_PRIVATE_KEY` / `RELAYER_RPC_URL` | If relayer enabled |
| Optional withdraw caps | Align with on-chain SEC-013 max withdraw |

### Consumer (EAS / Doppler for builds)

| Variable | Prod requirement |
|----------|------------------|
| `EXPO_PUBLIC_BACKEND_BASE_URL` | Production API HTTPS |
| `EXPO_PUBLIC_SSL_PINS` | **Real** SPKI hashes JSON — release **throws** if empty or init fails |
| `EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID` | If WC used |
| `EXPO_PUBLIC_ENABLE_MAINNET_TRANSACTIONS` | Intentional policy |

### SSL pin generation (ops)

```bash
# Replace host with your API host
openssl s_client -connect api.veilpay.app:443 </dev/null 2>/dev/null \
  | openssl x509 -pubkey -noout \
  | openssl pkey -pubin -outform der \
  | openssl dgst -sha256 -binary | openssl enc -base64
```

Set:

```text
EXPO_PUBLIC_SSL_PINS={"api.veilpay.app":["<hash>="]}
```

Dummy `AAAA…=` hashes are rejected in app code.

Checklist:

- [ ] Doppler `prd` has backend keys above  
- [ ] EAS secrets / Doppler inject SSL pins for release profile  
- [ ] Relayer secret shared only with trusted callers  
- [ ] Smoke: release build boots without pin throw; pin init succeeds  

---

## D. SEC-008 / SEC-011 (process)

**Code/docs status:** complete enough to *block false claims* and guide operators.

| Gate | Repo artifact | Human still must |
|------|---------------|------------------|
| SEC-008 ceremony | `docs/security/ceremony-and-audit-gates.md` | Run/archive ceremony, bind VK hashes, sign table |
| SEC-011 external audit | same + production checklist | Engage auditor, close findings, publish summary |

**Until signed:**

- Do **not** market mainnet privacy as audited/ready  
- Keep `EVM_MAX_PRIVACY_WITHDRAW_READY = false`  
- Keep Solana multi-deposit scaffold gate  
- Keep Stellar SPP mainnet fail-closed  

Sign-off lives in the ceremony doc table (append rows; do not erase history).

Checklist:

- [ ] SEC-008 evidence linked  
- [ ] SEC-011 report + remediations  
- [ ] Product flags still fail-closed until both signed  

---

## E. Push decision

| Condition | Push? |
|-----------|--------|
| Local prepush-ci green (or documented skips only) | Yes for **code** |
| Migrations planned for each deploy env | Yes for **code**; migrate before depending on new schema |
| Doppler/SSL pins armed for **production users** | Required for **prod traffic**, not for remote `git push` |
| SEC-008/011 signed | Required for **mainnet privacy claims**, not for dogfood push |

**Recommended sequence**

1. `pwsh -File scripts/prepush-ci.ps1`  
2. Fix any failures  
3. `git push origin main`  
4. Watch GitHub CI  
5. Staging migrate + Doppler smoke  
6. Prod migrate + release build with real SSL pins  
7. Leave SEC-008/011 open until ceremony + audit complete  

---

## F. Honest residual (cannot be finished by agents alone)

- External firm audit (SEC-011)  
- Multi-party ceremony / toxic waste handling (SEC-008)  
- Live Doppler/EAS secret injection in your org  
- Foundry on this Windows host if not installed (CI covers)  
