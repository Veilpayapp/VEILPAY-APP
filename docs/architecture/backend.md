# Backend architecture

The Veilpay backend is an Express and TypeScript API server.

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
| `/api/v1/merchant` | Merchant registration, profile, stats, public keys |
| `/api/v1/invoice` | Invoice creation, status, details, cancellation, payment mark |
| `/api/v1/payment` | Payment confirmation and payment lookup |
| `/api/v1/webhook` | Webhook test, verification, failed delivery recovery |
| `/api/v1/onramp` | Fiat ramp URL, quotes, webhook, status |
| `/api/v1/rpc` | Backend RPC proxy |
| `/api/docs` | OpenAPI JSON and local docs UI |

Additional internal and privacy-track routes exist for backend-to-backend operations. They are
authenticated and rate-limited, and are intentionally kept out of the public route reference.

## Request protection

The backend applies:

- Helmet security headers.
- JSON body size limits.
- raw body capture for HMAC verification.
- CORS from explicit config.
- global and route-specific rate limiters.
- API-key and request-signature authentication for merchant routes.
- error handling through centralized middleware and Sentry.

## Background processes

When the backend runs as the main process, it starts invoice-expiry workers, webhook queues/workers, and chain indexing jobs. Shutdown closes workers and disconnects Prisma cleanly.
