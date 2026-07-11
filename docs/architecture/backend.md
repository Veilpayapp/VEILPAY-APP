# Backend architecture

The Veilpay backend is an Express and TypeScript service that supports the consumer wallet with an RPC proxy, chain indexing, fiat-ramp integration, and health checks. It never receives user signing material.

## Technology stack

- Express.
- TypeScript.
- Prisma.
- PostgreSQL.
- Redis.
- BullMQ.
- Zod.
- Helmet.
- CORS.
- express-rate-limit.
- Sentry.
- pino logging.

## API route groups

| Route group | Purpose |
| --- | --- |
| `/api/v1/health` | Health, readiness, liveness |
| `/api/v1/onramp` | Fiat ramp URL, quotes, status |
| `/api/v1/rpc` | Backend RPC proxy |
| `/api/docs` | OpenAPI JSON and local docs UI |

Additional internal and privacy-track routes exist for backend-to-backend operations. They are
authenticated and rate-limited, and are intentionally kept out of the public route reference.

## Request protection

The backend applies:

- Helmet security headers.
- JSON body size limits.
- CORS from explicit config.
- global and route-specific rate limiters.
- server-side provider-credential isolation for proxied RPC calls.
- error handling through centralized middleware and Sentry.

## Background processes

When the backend runs as the main process, it starts chain-indexing jobs and supporting queues/workers. Shutdown closes workers and disconnects Prisma cleanly.
