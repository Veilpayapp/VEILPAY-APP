# Authentication

Veilpay merchant API authentication is based on API keys and signed requests.

## Headers

Representative headers include:

```text
x-api-key: <merchant-api-key>
x-signature: <hmac-signature>
x-timestamp: <unix-timestamp-ms>
```

## Signature intent

The signature covers request metadata and body content so the backend can reject forged or modified requests.

## Timestamp window

Timestamp validation limits replay attacks. Requests outside the accepted time window should be rejected.

## API key handling

API keys are generated for merchants and stored in hashed form. Merchants must store keys in their server-side secret manager and never expose them in frontend code.
