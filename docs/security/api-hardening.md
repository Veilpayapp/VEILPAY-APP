# API hardening

Veilpay backend hardening includes application-level controls and operational guardrails.

## Implemented controls

- Helmet security headers.
- Explicit CORS origin configuration.
- JSON body size limits.
- Zod validation patterns.
- Global and route-specific rate limits.
- Server-side provider-credential isolation.
- Sentry error reporting.
- Structured logging.
- Redis-backed queue infrastructure.

## RPC protection

The RPC proxy has dedicated rate limiting, method validation, and provider credential isolation.

## Production rule

Development defaults, placeholder secrets, wildcard CORS, and public credential exposure must be rejected before production deployment.
