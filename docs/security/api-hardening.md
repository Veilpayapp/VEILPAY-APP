# API hardening

Veilpay backend hardening includes application-level controls and operational guardrails.

## Implemented controls

- Helmet security headers.
- Explicit CORS origin configuration.
- JSON body size limits.
- Zod validation patterns.
- HMAC request signing.
- Timestamp replay protection.
- Global and route-specific rate limits.
- Merchant-scoped resource access.
- Sentry error reporting.
- Structured logging.
- Redis-backed session and queue infrastructure.

## RPC protection

The RPC proxy has dedicated rate limiting, method validation, and provider credential isolation.

## Production rule

Development defaults, placeholder secrets, wildcard CORS, and public credential exposure must be rejected before production deployment.
