# Core concepts

## Merchant

A merchant is an account that can create invoices, query payment state, publish public keys, and receive webhooks. Merchants authenticate API calls with an API key and signed request metadata.

## Invoice

An invoice is a payment request with chain, token, amount, expiry, status, and privacy-level metadata. Invoices move through a lifecycle such as pending, paid, expired, or cancelled.

## Payment

A payment is the chain transaction associated with an invoice or wallet transfer. The backend stores and exposes payment status while workers and chain polling detect confirmation state.

## Webhook

Webhooks are signed server-to-server notifications sent to merchant infrastructure after payment lifecycle events. Veilpay signs webhook payloads and includes timestamp metadata so merchants can reject forged or replayed events.

## Privacy level

Veilpay separates standard payment flows from stronger privacy modes. Current privacy documentation distinguishes shipped primitives, testnet-only SPP work, and future privacy-chain plans.

## Chain key

Chain keys are stable network identifiers used across config, API payloads, wallet routing, and explorer links. Examples include `ethereum`, `polygon`, `base`, `solana`, `stellar`, and testnet variants.

## RPC proxy

The backend provides an RPC proxy so provider credentials stay server-side. The consumer app can route supported RPC calls through the backend instead of bundling Alchemy or Infura secrets into the mobile binary.
