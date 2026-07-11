# Core concepts

## Wallet

A wallet is the user's self-custody account. It holds mnemonic-derived keys on the device, supports multiple chain address families, and signs transactions locally. Signing material never leaves the device.

## Payment

A payment is a chain transaction sent or received by the wallet. The app records local transaction state and detects confirmation through chain-specific status polling.

## Privacy level

Veilpay separates standard payment flows from stronger privacy modes. Current privacy documentation distinguishes shipped primitives, testnet-only SPP work, and future privacy-chain plans.

## Chain key

Chain keys are stable network identifiers used across config, wallet routing, and explorer links. Examples include `ethereum`, `polygon`, `base`, `solana`, `stellar`, and testnet variants.

## RPC proxy

The backend provides an RPC proxy so provider credentials stay server-side. The consumer app can route supported RPC calls through the backend instead of bundling provider secrets into the mobile binary.
