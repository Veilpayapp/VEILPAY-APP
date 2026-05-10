# VeilPay E2E

Maestro scaffold for the consumer app.

## Scope

- Critical onboarding and wallet setup
- Send-payment happy path
- Network switching and custom networks
- Settings and deep-link entry points

## Assumptions

- The consumer app is built with the Expo package id `com.veilpay.consumer`.
- Visible labels should follow the screen titles in `apps/consumer-app/src/constants/screens.ts`.
- Selectors still need to be finalized against the rendered app before these flows are promoted to CI.

## Run

```bash
maestro test e2e/flows
```

## Next wiring step

Update each flow with the actual visible text, accessibility labels, or test ids from the consumer app screens.
