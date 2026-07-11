# Fiat ramps

Veilpay includes fiat on-ramp and off-ramp flows through provider integrations.

## Current surfaces

- Amount entry.
- Quote selection.
- Provider widget or WebView flow.
- Order status tracking.

## Providers

The app includes Transak-oriented screens and support for additional fiat gateway provider paths. Provider availability varies by chain, token, jurisdiction, and environment.

## Stellar anchors

For Stellar assets, Veilpay supports ramp flows through Stellar anchors using the standard interactive deposit and withdrawal flow.

The anchor flow:

- Discovers an anchor's transfer services through its published network metadata.
- Opens the anchor's interactive deposit or withdrawal session in a controlled WebView.
- Tracks order status back in the app the same way other providers are tracked.

Anchor support follows the same gates as any other network feature: explicit allow-listing, honest quote and error surfacing, and no unsupported network or token presented as available.

## Safety expectations

- Do not show fake quotes.
- Clearly block unsupported networks or tokens.
- Keep provider fees and fiat currency explicit.
- Surface provider errors and retry states honestly.
