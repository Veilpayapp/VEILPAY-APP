# Webhooks

Webhooks notify merchants about Veilpay events.

## Test webhook

```http
POST /api/v1/webhook/test
```

Sends or validates a merchant webhook configuration.

## Verify webhook signature

```http
POST /api/v1/webhook/verify
```

Verifies a webhook payload and signature.

## Failed webhooks

```http
GET /api/v1/webhook/failed
```

Lists failed deliveries for authenticated merchants.

## Retry webhook

```http
POST /api/v1/webhook/{id}/retry
```

Retries a failed webhook delivery.

## Merchant verification checklist

Every merchant webhook handler should:

1. Read the raw request body.
2. Verify the Veilpay signature.
3. Check the timestamp window.
4. Reject replayed event IDs.
5. Process events idempotently.
6. Return a 2xx only after durable local handling.
