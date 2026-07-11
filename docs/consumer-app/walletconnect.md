# WalletConnect

Veilpay integrates WalletConnect v2 for external dapp sessions.

## Capabilities

- Create and manage sessions.
- Normalize and validate WalletConnect URIs.
- Display active sessions.
- Disconnect sessions.
- Respond to supported session requests.

## Safety expectations

- Show users what a dapp is requesting.
- Validate chain namespaces.
- Apply timeouts to pending requests.
- Do not sign without explicit user confirmation.
- Persist sessions safely across app restarts where supported.
