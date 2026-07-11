# API route reference

These are the public-facing backend routes used by the consumer wallet. Additional internal routes exist for backend-to-backend operations and are intentionally kept out of the public reference.

## Health

```http
GET /api/v1/health
GET /api/v1/health/ready
GET /api/v1/health/live
```

## On-ramp

```http
POST /api/v1/onramp/url
GET /api/v1/onramp/quotes
GET /api/v1/onramp/status/{id}
```

## RPC proxy

```http
POST /api/v1/rpc/{chainKey}
GET /api/v1/rpc/{chainKey}/*
```

## OpenAPI

```http
GET /api/docs
GET /api/docs/ui
```

The UI route is disabled in production by backend configuration.
