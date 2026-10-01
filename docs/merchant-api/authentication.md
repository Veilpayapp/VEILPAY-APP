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

## Key rotation

A leaked API key is a self-service fix: rotate it and the old key stops authorizing immediately. The rotated key is returned **exactly once** at rotation time — store it before closing the response; it is never shown again.

```http
POST /api/v1/merchant/keys/rotate
```

Authenticated with the current merchant key (the usual `x-api-key` +
signature headers). Responses:

- **200** → `{"merchantId": "<uuid>", "apiKey": "vp_…", "warning": "Store this API key now — it is shown exactly once and never again."}` — the only place the new key ever appears.
- **409** → `{"error": "API key conflict: the key was already rotated. Re-authenticate with the current key and retry.", "code": "API_KEY_ROTATION_CONFLICT"}` — a concurrent rotation won the compare-and-swap; no key material is returned.

The old key stops authorizing immediately (401 at the auth middleware on first
use after rotation). The auth lookup on `api_key_hash` is indexed
(`@@index([apiKeyHash])`).

