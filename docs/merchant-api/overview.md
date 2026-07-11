# Merchant API overview

The Merchant API lets server-side merchant systems integrate Veilpay payment flows.

## Base path

```text
/api/v1
```

## Main route groups

- Merchants.
- Invoices.
- Payments.
- Webhooks.
- On-ramp support.
- RPC proxy.
- Health checks.

## Authentication model

Most merchant routes require:

- API key header.
- HMAC request signature.
- timestamp header.

Request signing prevents unauthenticated modification and timestamp checks reduce replay risk.

## Production integration rule

Merchants should treat Veilpay webhooks as signed, idempotent events and should always verify signatures before updating order state.
