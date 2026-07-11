# Wallet model

Veilpay uses a self-custody wallet model.

## Key principles

- Mnemonic material stays on the user device.
- SecureStore is the only approved place for mnemonic persistence.
- Signing material must not be sent to the backend.
- Signing flows are chain-specific and gated by user confirmation.
- Clipboard and export flows are treated as sensitive UX paths.

## Address families

| Family | Used for |
| --- | --- |
| EVM | Ethereum, Polygon, Arbitrum, Optimism, Base, BSC, Sepolia |
| SVM | Solana and Solana Devnet |
| XLM | Stellar and Stellar Testnet |

## Security boundaries

The backend relays non-secret infrastructure requests, such as proxied RPC calls, and provides supporting services. It must not receive user mnemonics, private keys, raw signatures, or unredacted signing material.
