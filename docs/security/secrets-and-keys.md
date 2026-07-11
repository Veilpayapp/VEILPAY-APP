# Secrets and keys

## Never commit secrets

Do not commit:

- private keys
- mnemonics
- raw signatures
- signing and session secrets
- provider credentials
- Doppler tokens

## Production secret management

Production secrets are managed by Doppler and injected into backend or build environments.

## Public Expo variables

Only `EXPO_PUBLIC_*` variables are bundled into the app. These must never contain secrets.

## Server-side isolation

RPC provider credentials and other backend secrets stay server-side and are never exposed to the mobile app or to proxied clients. Distinct secrets are kept separate so their blast radius and rotation stay independent.
