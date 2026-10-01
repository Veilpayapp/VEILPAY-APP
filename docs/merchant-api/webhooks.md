# Webhooks

Webhooks notify merchants about Veilpay events.

## Signature format

Every webhook is signed with HMAC-SHA256 over `` `${timestamp}.${rawBody}` `` using the merchant's webhook signing secret, and delivered with two headers:

```text
X-VeilPay-Signature: <hex-encoded HMAC-SHA256 digest>
X-VeilPay-Timestamp: <unix timestamp, milliseconds>
```

Verify by recomputing the HMAC over the **raw** request body (the exact bytes received — not re-serialized JSON) and the `X-VeilPay-Timestamp` header, comparing in constant time. Signatures with timestamps outside a 5-minute window are rejected.

## Test webhook

```http
POST /api/v1/webhook/test
```

Sends or validates a merchant webhook configuration.

## Verify webhook signature

```http
POST /api/v1/webhook/verify
```

Verifies a webhook payload and signature. This endpoint is rate-limited to resist signature probing; use it to validate your verifier implementation against a known signature/timestamp/body triple.

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
