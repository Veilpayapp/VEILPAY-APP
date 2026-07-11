# Security model

Veilpay is designed around explicit trust boundaries.

## User device boundary

- Holds wallet mnemonic material in SecureStore.
- Performs transaction signing.
- Displays user confirmation.
- Must not leak private keys or raw signatures to logs or backend APIs.

## Backend boundary

- Authenticates merchants.
- Stores invoices and payment state.
- Proxies infrastructure RPC calls.
- Signs and verifies webhooks.
- Runs workers and queues.
- Must not receive user mnemonics or private keys.

## Merchant boundary

- Stores API keys server-side.
- Verifies webhook signatures.
- Handles events idempotently.
- Protects order state from replayed or forged events.

## Chain boundary

The underlying chain is the source of transaction finality, but merchant systems should rely on Veilpay invoice status and signed webhook notifications for integration consistency.
