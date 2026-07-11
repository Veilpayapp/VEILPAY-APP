# How Veilpay works

Veilpay connects a mobile wallet, supporting backend services, and multiple blockchain networks into one self-custody payment experience.

## End-to-end flow

1. A user creates or imports a wallet in the mobile app.
2. The app derives chain-specific addresses and displays balances across networks.
3. To pay, the user enters or scans a recipient and selects a network, token, and amount.
4. The app validates the address, amount, balance, and fees, then asks the user to confirm.
5. Signing happens inside wallet-controlled code paths. Mnemonic material is not sent to the backend.
6. The transaction is broadcast to the selected network, optionally through the backend RPC proxy.
7. The app records local transaction state and polls the network for confirmation.
8. Transaction history and balances update once the payment is confirmed on-chain.

## Main components

```text
Consumer App
  Wallet, balances, send/receive, privacy UX, WalletConnect, fiat ramps

Backend services
  RPC proxy, chain indexer, health, queues

Workers
  Chain indexing, transaction-status detection, queues

Data stores
  PostgreSQL through Prisma, Redis for queues and coordination

Blockchain layer
  EVM networks, Solana, Stellar, Stellar SPP testnet track
```

## Design principles

- Keep user signing material on-device.
- Keep RPC provider credentials server-side.
- Validate addresses, amounts, and chain identifiers before signing.
- Treat stronger privacy as a gated, explicit mode rather than an ambiguous default.
- Clearly separate shipped features from testnet and roadmap work.
