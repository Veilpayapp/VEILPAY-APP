# Veilpay Consumer App Environment Setup

This guide explains exactly which environment variables to set and how to obtain each value.

## 1) Create your local env file

1. In apps/consumer-app, copy .env.example to .env.
2. Fill required values first (Section 2).
3. Add optional values only if you use those features.
4. Restart Metro or rebuild after env changes.

## 2) Required for core app flows

### EXPO_PUBLIC_INDEXER_BASE_URL (or EXPO_PUBLIC_BACKEND_BASE_URL)
Purpose:
- Base URL for transaction history, token balances, and push registration fallback.

How to obtain:
1. Ask backend team for the environment API base URL (dev, staging, prod).
2. Confirm it serves these routes:
   - /api/v1/transactions
   - /api/v1/balances
   - /api/v1/notifications/register-device
3. For Android emulator local backend, use http://10.0.2.2:<port>.
4. Prefer EXPO_PUBLIC_INDEXER_BASE_URL. Use EXPO_PUBLIC_BACKEND_BASE_URL as fallback when services are split.

Validation:
- Transaction history and token balances load in app.

### EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID
Purpose:
- Required to create WalletConnect v2 session URIs.

How to obtain:
1. Sign in to WalletConnect Cloud: https://cloud.walletconnect.com
2. Create a project for Veilpay.
3. Copy the Project ID from project settings.
4. Paste into EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID.

Validation:
- WalletConnect flow starts without "project ID is missing" errors.

## 3) Expo and OTA configuration

### EXPO_PUBLIC_EAS_PROJECT_ID
Purpose:
- Injected into Expo extra.eas.projectId for EAS-aware features.

How to obtain:
1. Install and authenticate EAS CLI.
2. Run in apps/consumer-app: eas project:info
3. Copy the project UUID.
4. Set EXPO_PUBLIC_EAS_PROJECT_ID to that UUID.

Validation:
- Expo config contains extra.eas.projectId.

### EXPO_PUBLIC_EAS_UPDATE_URL
Purpose:
- OTA updates URL used by app.config.js.

How to obtain:
1. Open Expo project dashboard.
2. Find update URL for your project/channel.
3. Set EXPO_PUBLIC_EAS_UPDATE_URL, usually https://u.expo.dev/<project-id>.

Validation:
- Expo config updates.url matches your value.

## 4) Error monitoring and analytics

### EXPO_PUBLIC_SENTRY_DSN
Purpose:
- Enables Sentry crash/error reporting in non-dev builds.

How to obtain:
1. Sign in to Sentry: https://sentry.io
2. Create or open the React Native project.
3. Copy DSN from project settings.
4. Set EXPO_PUBLIC_SENTRY_DSN.

Validation:
- Errors are reported from non-dev builds.

### EXPO_PUBLIC_ENABLE_ANALYTICS
Purpose:
- Master switch for analytics behavior.

How to obtain:
1. Decide per environment with product/privacy team.
2. Set true to enable analytics logic.
3. Keep false if analytics is disabled in that environment.

Validation:
- When false, analytics events are skipped.

### EXPO_PUBLIC_MIXPANEL_TOKEN
Purpose:
- Mixpanel project token used when analytics is enabled and consent is granted.

How to obtain:
1. Sign in to Mixpanel: https://mixpanel.com
2. Open your project settings.
3. Copy Project Token.
4. Set EXPO_PUBLIC_MIXPANEL_TOKEN.

Validation:
- Analytics initializes without token-missing warnings.

## 5) RPC endpoint overrides (optional but recommended for production)

Variables:
- EXPO_PUBLIC_RPC_ETHEREUM
- EXPO_PUBLIC_RPC_POLYGON
- EXPO_PUBLIC_RPC_ARBITRUM
- EXPO_PUBLIC_RPC_SOLANA
- EXPO_PUBLIC_RPC_APTOS

Purpose:
- Override public fallback RPC endpoints to improve reliability and avoid rate limits.

How to obtain:
1. Choose provider: Alchemy, Infura, QuickNode, or self-hosted nodes.
2. Create endpoint per chain.
3. Paste each HTTPS endpoint into matching env variable.

Validation:
- Network calls use your provider endpoints and remain stable under load.

## 6) Feature flags

### EXPO_PUBLIC_ENABLE_MAINNET_TRANSACTIONS
Purpose:
- Enables mainnet sends when true.

How to set:
1. Keep false for local/dev/staging by default.
2. Set true only when mainnet transaction flows are approved and tested.

### EXPO_PUBLIC_DEMO_WALLET_CONNECT
Purpose:
- Enables demo WalletConnect behavior.

How to set:
1. Set true only for demos/test scenarios.
2. Keep false for normal environments.

## 7) Suggested rollout order

1. Set base URL(s) and WalletConnect project ID.
2. Verify app loads balances, transactions, and WalletConnect flow.
3. Add EAS values if using OTA/push production setup.
4. Add Sentry and analytics values.
5. Add custom RPC overrides for production stability.
6. Enable feature flags only for approved environments.
