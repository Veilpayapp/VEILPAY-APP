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
