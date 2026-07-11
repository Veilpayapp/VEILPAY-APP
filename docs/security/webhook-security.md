# Webhook security

Webhook security protects merchant order state.

## Required verification

Merchant webhook handlers must verify:

- signature
- timestamp
- raw body integrity
- event uniqueness
- merchant or invoice scope

## Replay protection

Reject webhooks outside the timestamp window and store processed event IDs to prevent duplicate order updates.

## Idempotency

Webhook handlers should be safe to call more than once. A repeated `paid` event should not double-ship an order or double-credit an internal account.

## Failure handling

Veilpay queues webhook delivery and provides retry/failed delivery routes for recovery. Merchants should still build their own monitoring around webhook health.
