# Production checklist

Use this checklist before exposing a Veilpay environment to production traffic.

## Secrets

- [ ] Doppler configured.
- [ ] JWT secret set and strong.
- [ ] API key salt set and strong.
- [ ] Provider API keys server-side only.
- [ ] No secrets in Expo public variables.

## Backend

- [ ] Database migrations deployed.
- [ ] Redis reachable.
- [ ] Health, readiness, and liveness endpoints pass.
- [ ] Rate limiters enabled.
- [ ] CORS origins explicit.
- [ ] Sentry configured.
- [ ] Background job queue and worker running.

## Mobile

- [ ] Production API URL configured.
- [ ] SecureStore-only mnemonic storage verified.
- [ ] Mainnet transaction feature flag intentionally set.
- [ ] WalletConnect project ID configured.
- [ ] OTA update channel configured.

## Privacy features

- [ ] Testnet-only labels visible where required.
- [ ] Mainnet privacy features fail-closed until gates pass.
- [ ] No unaudited privacy contracts presented as production-safe.
- [ ] **SEC-008** ceremony / trusted-setup evidence complete for any mainnet Groth16 verifier ([ceremony-and-audit-gates](ceremony-and-audit-gates.md)).
- [ ] **SEC-011** external audit report + remediations closed or accepted for privacy scope.
- [ ] Solana pool: multi-leaf Merkle live **or** single-leaf scaffold gate still enforced (`MAX_SCAFFOLD_LEAVES = 1`).
- [ ] EVM max withdraw remains gated off unless product + audit explicitly enable it.
- [ ] Stellar SPP mainnet remains fail-closed unless SPP-specific gates pass.

## Payments / API (dogfood → production)

- [ ] On-chain payment confirm enabled with real RPC URLs (Alchemy/Infura).
- [ ] `RELAYER_SHARED_SECRET` set in Doppler for prod.
- [ ] Optional `MAX_WITHDRAW_AMOUNT` / `RELAYER_MAX_WITHDRAW_AMOUNT` armed if required by risk policy.
- [ ] Prisma migrations applied (including `ChainType` / `token_address` if shipping that schema).
- [ ] SSL pins real SPKI hashes in release consumer builds (`EXPO_PUBLIC_SSL_PINS`).
