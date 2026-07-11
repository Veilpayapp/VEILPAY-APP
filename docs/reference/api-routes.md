# API route reference

## Health

```http
GET /api/v1/health
GET /api/v1/health/ready
GET /api/v1/health/live
```

## Merchants

```http
POST /api/v1/merchant/register
POST /api/v1/merchant/keys/publish
GET /api/v1/merchant/{id}
GET /api/v1/merchant/{id}/stats
PUT /api/v1/merchant/{id}
```

## Invoices

```http
GET /api/v1/invoice
POST /api/v1/invoice/create
GET /api/v1/invoice/{id}/status
GET /api/v1/invoice/{id}
POST /api/v1/invoice/{id}/cancel
POST /api/v1/invoice/{id}/pay
```

## Payments

```http
POST /api/v1/payment/confirm
GET /api/v1/payment
GET /api/v1/payment/{id}
```

## Webhooks

```http
POST /api/v1/webhook/test
POST /api/v1/webhook/verify
GET /api/v1/webhook/failed
POST /api/v1/webhook/{id}/retry
```

## On-ramp

```http
POST /api/v1/onramp/url
GET /api/v1/onramp/quotes
POST /api/v1/onramp/webhook
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
