# Secrets and keys

## Never commit secrets

Do not commit:

- private keys
- mnemonics
- raw signatures
- API keys
- webhook signing secrets
- JWT secrets
- provider credentials
- Doppler tokens

## Production secret management

Production secrets are managed by Doppler and injected into backend or build environments.

## Public Expo variables

Only `EXPO_PUBLIC_*` variables are bundled into the app. These must never contain secrets.

## Merchant API keys

Merchant API keys should be stored in merchant server-side secret managers. Veilpay stores hashed API key material server-side.

## Webhook secrets

Webhook signing secrets are separate from API key salts. This separation limits blast radius and makes rotation safer.
