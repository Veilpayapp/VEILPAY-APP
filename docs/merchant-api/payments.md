# Payments

Payment routes expose confirmation and lookup functionality.

## Confirm payment

```http
POST /api/v1/payment/confirm
```

Confirms or records payment details depending on the request and backend controller behavior.

## List payments

```http
GET /api/v1/payment
```

Requires merchant authentication.

## Payment details

```http
GET /api/v1/payment/{id}
```

Requires merchant authentication.

## Integration guidance

Merchants should use invoice status and signed webhooks as the primary source of order updates. Direct payment lookup is useful for dashboards, reconciliation, and support tooling.
