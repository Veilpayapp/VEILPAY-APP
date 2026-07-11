# Stealth addresses

Stealth addresses reduce direct linkability between a recipient’s known identity and a payment address.

## Concept

A payer can derive a one-time address for a recipient using an ephemeral key exchange. The recipient can later detect or recover ownership with the appropriate private material.

## Veilpay implementation direction

The repo includes stealth-address utilities using ECDH-style shared secret derivation and deterministic address generation.

## Security expectations

- Generate fresh ephemeral keys per payment.
- Never log shared secrets.
- Never expose recipient private keys.
- Keep directory and key-publication flows explicit.
- Treat stealth addresses as a privacy improvement, not a full private payment system by themselves.
