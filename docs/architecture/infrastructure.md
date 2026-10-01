# Infrastructure

## Local infrastructure

Local development uses Docker Compose for backing services such as PostgreSQL and Redis.

## Production secrets

Production secrets are managed with Doppler. Secrets must not be committed to the repo or exposed through public Expo environment variables.

## Observability

Sentry is integrated across backend and app contexts for error visibility. The backend also uses structured logging.

## CI and checks

The monorepo exposes common checks through pnpm and Turbo:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Mobile delivery

The consumer app builds with Expo/EAS tooling, but over-the-air (OTA) update channels are **retired**: `expo-updates` is disabled in `app.config.js` (`updates.enabled: false`) and `eas.json` is marked deprecated. App releases ship through store/APK builds. Production secrets are never stored in public files — they are injected at deploy time through Doppler.
