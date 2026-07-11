# Environment variables

This page summarizes the environment model. Use `.env.example` as the source for local setup.

## Backend

Important backend variables include:

- `DATABASE_URL`
- `REDIS_URL`
- `REDIS_PASSWORD`
- `JWT_SECRET`
- `API_KEY_SALT`
- `WEBHOOK_SIGNING_SECRET`
- `DEFAULT_MERCHANT_TIER`
- `NODE_ENV`
- `PORT`
- `CORS_ORIGINS`
- `ALCHEMY_API_KEY`
- `INFURA_API_KEY`
- network RPC URL variables

## Consumer app

Only variables prefixed with `EXPO_PUBLIC_` are bundled into the mobile app.

Important public variables include:

- `EXPO_PUBLIC_BACKEND_BASE_URL`
- `EXPO_PUBLIC_INDEXER_BASE_URL`
- `EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID`
- `EXPO_PUBLIC_ENABLE_ANALYTICS`
- `EXPO_PUBLIC_MIXPANEL_TOKEN`
- `EXPO_PUBLIC_ENABLE_MAINNET_TRANSACTIONS`
- `EXPO_PUBLIC_SENTRY_DSN`
- `EXPO_PUBLIC_EAS_PROJECT_ID`
- `EXPO_PUBLIC_EAS_UPDATE_URL`

## Rule

Never place secrets in `EXPO_PUBLIC_*` variables.
