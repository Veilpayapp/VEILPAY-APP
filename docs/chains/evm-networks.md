# EVM networks

Veilpay supports EVM-style networks through shared address handling, EVM signing utilities, EIP-1559-aware fee logic where applicable, and backend RPC provider routing.

## Public network set

- Ethereum.
- Polygon.
- Arbitrum.
- Optimism.
- Base.
- BSC.
- Sepolia for testing.

## Wallet behavior

EVM networks use the EVM address family. The same EVM address can be used across supported EVM networks, while chain-specific balances and transactions are still network-specific.

## Backend behavior

Backend RPC routing can prefer provider-backed URLs and fall back to configured public endpoints. Production provider keys stay server-side.

## Token behavior

Token availability depends on chain configuration, discovery support, provider capabilities, and app metadata.
