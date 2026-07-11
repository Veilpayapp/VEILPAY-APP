# Consumer app architecture

The Veilpay consumer app is an Expo React Native application.

## Technology stack

- Expo and React Native.
- React.
- TypeScript.
- React Navigation.
- Zustand for state management.
- Expo SecureStore for mnemonic and sensitive persistence.
- WalletConnect v2.
- ethers, viem, Solana Web3, Stellar SDK.
- Reanimated, FlashList, Skia, and native modules for advanced UI/performance work.

## Major directories

```text
apps/consumer-app/src/
  components/      Reusable UI and feature components
  constants/       App constants and network configuration
  hooks/           Wallet, network, privacy, payment hooks
  navigation/      Typed navigation setup
  screens/         User-facing app screens
  stores/          Zustand stores
  types/           Shared UI and transaction types
  utils/           Signers, RPC, transactions, privacy, Stellar SPP
```

## Wallet architecture

The app supports multiple address families:

- EVM address family for EVM chains.
- SVM address family for Solana.
- XLM address family for Stellar.

Mnemonic material is stored in SecureStore and signing is isolated to chain-specific utilities.

## Important screens

- Onboarding, create/import wallet, and backup flows.
- Home dashboard and token asset views.
- Send, receive, payment confirmation, and success screens.
- Transaction history and transaction details.
- WalletConnect session management.
- Fiat on-ramp and off-ramp flows.
- Stellar SPP screen for private XLM testnet work.
