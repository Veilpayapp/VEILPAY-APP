# Environment variables

This page summarizes the environment model. The authoritative list of variables lives in
`.env.example` in the repository — use it as the source for local setup. To avoid publishing an
inventory of sensitive configuration, this page describes categories rather than exact names.

## Backend

The backend is configured through server-side environment variables, grouped as:

- **Datastore connections** — PostgreSQL and Redis connection details and credentials.
- **Signing and auth secrets** — server-side signing and session secrets. These are distinct
  values so their blast radius and rotation stay independent.
- **RPC provider credentials** — API keys and RPC URLs for the supported chain providers.
- **Runtime and policy settings** — environment mode, port, and allowed CORS origins.

All of the above are secrets or environment-specific settings and are never bundled into the
mobile app. In production they are sourced from Doppler (see [Secrets and keys](../security/secrets-and-keys.md)).

## Consumer app

Only variables prefixed with `EXPO_PUBLIC_` are bundled into the mobile app, so **only
non-secret configuration belongs there** — for example the backend and indexer base URLs, the
WalletConnect project ID, feature flags, and non-secret analytics/observability identifiers.

Anything sensitive (signing secrets, provider API keys, database or Redis credentials) must stay
server-side and must never be given an `EXPO_PUBLIC_` name.

## Rule

Never place secrets in `EXPO_PUBLIC_*` variables, and treat `.env.example` — not this page — as
the definitive variable reference.
