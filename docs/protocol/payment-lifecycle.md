# Payment lifecycle

The payment lifecycle describes how Veilpay moves from user intent to on-chain confirmation.

## States

Common transaction states include:

- `pending`: the transaction has been broadcast but is not yet confirmed.
- `confirmed`: the transaction is confirmed on the underlying network.
- `failed`: the transaction was rejected or failed on-chain.

## Consumer-side sequence

1. User selects a recipient, token, amount, and network.
2. App validates the address format and amount.
3. App estimates fees where supported.
4. App checks local and network state before signing.
5. User confirms the payment.
6. Signing runs in the appropriate chain signer.
7. App records local transaction state and starts polling.

## Confirmation model

Confirmation strategy depends on the network. EVM networks use transaction hashes and provider calls, Solana uses JSON-RPC semantics, and Stellar uses Horizon/Soroban-specific state depending on the flow.

The app tracks confirmation through chain-specific status polling and updates balances and transaction history once the network confirms the payment.
