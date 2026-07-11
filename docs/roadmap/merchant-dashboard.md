# Merchant dashboard

The merchant dashboard is a planned self-service web surface for merchants.

## Planned capabilities

- Dashboard overview and analytics.
- Invoice and payment management.
- Webhook configuration.
- Failed webhook inspection and retry.
- API key rotation.
- Developer settings.
- Business feature expansion.

## Current boundary

The authoritative merchant API surface is the Express backend in `apps/backend`. The dashboard plan should consume those APIs rather than redefining the backend contract.

## Design direction

The dashboard should use a premium, minimal, security-first style with sensitive credentials masked by default and deliberate reveal actions.
