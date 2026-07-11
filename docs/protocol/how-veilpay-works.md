# How Veilpay works

Veilpay connects a mobile wallet, a merchant API, backend workers, and supported blockchain networks into one payment lifecycle.

## End-to-end flow

1. A merchant registers and receives API credentials.
2. The merchant creates an invoice with chain, token, amount, memo, expiry, and privacy-level metadata.
3. The consumer app displays or scans the payment request.
4. The user confirms the payment in the mobile wallet.
5. Signing happens inside wallet-controlled code paths. Mnemonic material is not sent to the backend.
6. The transaction is broadcast to the selected network.
7. Backend workers or polling flows detect payment status.
8. The invoice moves to a terminal or updated state.
9. Veilpay sends signed webhook notifications to the merchant.

## Main components

```text
Consumer App
  Wallet, balances, send/receive, privacy UX, WalletConnect, fiat ramps

Backend API
  Merchants, invoices, payments, webhooks, RPC proxy, health, docs

Workers
  Invoice expiry, webhook delivery, chain indexer, queues

Data stores
  PostgreSQL through Prisma, Redis for queues and sessions

Blockchain layer
  EVM networks, Solana, Stellar, Stellar SPP testnet track
```

## Design principles

- Keep user signing material on-device.
- Keep API keys and RPC provider credentials server-side.
- Validate request bodies and chain identifiers before state-changing operations.
- Sign webhooks and protect them with timestamp windows.
- Treat stronger privacy as a gated, explicit mode rather than an ambiguous default.
- Clearly separate shipped features from testnet and roadmap work.
