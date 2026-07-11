# Payment lifecycle

The payment lifecycle describes how Veilpay moves from user intent to chain confirmation and merchant notification.

## States

Common payment or invoice states include:

- `pending`: payment has not been confirmed yet.
- `paid`: payment is confirmed and associated with the invoice.
- `expired`: invoice expiry elapsed before payment confirmation.
- `cancelled`: merchant or system cancelled the invoice.

## Consumer-side sequence

1. User selects a recipient, invoice, token, amount, and network.
2. App validates the address format and amount.
3. App estimates fees where supported.
4. App checks local and network state before signing.
5. User confirms the payment.
6. Signing runs in the appropriate chain signer.
7. App records local transaction state and starts polling.

## Backend-side sequence

1. Merchant creates or tracks an invoice.
2. Backend validates authenticated requests.
3. Chain indexer or payment route updates state.
4. Invoice status transitions are persisted.
5. Webhook jobs are queued through BullMQ.
6. Webhook delivery retries and dead-letter flows handle failures.

## Confirmation model

Confirmation strategy depends on the network. EVM networks use transaction hashes and provider calls, Solana uses JSON-RPC semantics, and Stellar uses Horizon/Soroban-specific state depending on the flow.

For merchant settlement, integrations should rely on Veilpay invoice status and webhooks rather than assuming a single client-side transaction screen is sufficient.
