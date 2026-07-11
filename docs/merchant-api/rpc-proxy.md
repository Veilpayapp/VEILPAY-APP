# RPC proxy

The backend RPC proxy lets clients route selected network calls through Veilpay infrastructure without exposing provider credentials.

## JSON-RPC proxy

```http
POST /api/v1/rpc/{chainKey}
```

Used for JSON-RPC networks and clients.

## REST-style passthrough

```http
GET /api/v1/rpc/{chainKey}/*
```

Used where a supported network exposes REST-style APIs.

## Security controls

- Dedicated RPC rate limiter.
- Method allowlist logic.
- Provider URL redaction in logs.
- Server-side provider key storage.
- Chain key validation.
