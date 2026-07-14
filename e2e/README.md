# Veilpay E2E

Maestro flows for the consumer app.

## Scope

| Flow | File | CI gate |
|------|------|---------|
| Onboarding (cold start → wallet connect) | `flows/onboarding.yaml` | UX-002 |
| Send payment (home → recipient/amount) | `flows/send_payment.yaml` | UX-002 |
| Network switching | `flows/network_switching.yaml` | manual |
| Settings | `flows/settings.yaml` | manual |
| Custom network | `flows/custom_network.yaml` | manual |
| Deep link | `flows/deep_link.yaml` | manual |

## Selectors

Critical paths use stable `testID`s (preferred) and accessibility labels:

| testID | Screen |
|--------|--------|
| `onboarding-get-started` | Onboarding |
| `onboarding-restore-vault` | Onboarding |
| `wallet-connect-create` | Wallet connect |
| `wallet-connect-import` | Wallet connect |
| `home-action-send` | Home quick actions |
| `send-recipient-input` | Send payment |
| `send-amount-input` | Send payment |
| `send-continue-button` | Send payment |

App id: `com.veilpay.consumer` (see `apps/consumer-app/app.config.js`).

## Run on device / emulator

```bash
# Install Maestro: https://maestro.mobile.dev
maestro test e2e/flows/onboarding.yaml
maestro test e2e/flows/send_payment.yaml
# or all flows:
maestro test e2e/flows
```

`send_payment.yaml` assumes a wallet is already onboarded (does not `clearState`).

## CI

```bash
node scripts/validate-maestro-flows.mjs
```

This validates that the critical YAML flows exist and that every required `testID`
still appears in `apps/consumer-app/src`. Full Maestro execution on an emulator is
not part of the default GitHub Actions runner (no Android device farm wired yet).
