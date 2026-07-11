# Stellar

Veilpay supports Stellar wallet flows and uses Stellar Testnet for the Stellar Private Payments integration track.

## Public network support

- Stellar mainnet for XLM wallet flows.
- Stellar Testnet for testing and SPP development.

## Balance and send flows

Stellar flows use Horizon and Stellar SDK tooling. XLM uses seven decimal places and Stellar-specific account reserve rules.

## Fiat ramps

Stellar assets can be funded and withdrawn through Stellar anchors using the standard interactive deposit and withdrawal flow. See [Fiat ramps](../consumer-app/fiat-ramps.md).

## Stellar Private Payments

Stellar SPP is documented separately because it introduces private pool operations, native proving, contract IDs, testnet gates, and mainnet safety requirements.

See [Stellar Private Payments](../privacy/stellar-spp.md).
