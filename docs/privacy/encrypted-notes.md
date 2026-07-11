# Encrypted notes

Encrypted notes protect memo or payment metadata from unnecessary disclosure.

## Concept

Instead of storing or transmitting plaintext payment notes, Veilpay can encrypt note content for the intended recipient.

## Implementation direction

The app includes note encryption utilities using authenticated public-key encryption patterns. Encrypted payloads include nonce and ciphertext data.

## Safety rules

- Do not store plaintext memos when encrypted notes are required.
- Do not log decrypted note content.
- Treat note decryption as recipient-only behavior.
- Keep note-secret backup and recovery UX explicit.
