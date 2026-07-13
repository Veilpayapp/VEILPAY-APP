# Merchants

Merchant routes manage merchant registration, profile access, stats, and public key publication.

## Register merchant

```http
POST /api/v1/merchant/register
```

Creates a merchant account and returns API credentials.

## Get merchant

```http
GET /api/v1/merchant/{id}
```

Requires merchant authentication.

## Update merchant

```http
PUT /api/v1/merchant/{id}
```

Requires authentication and merchant-scoped access.

## Merchant stats

```http
GET /api/v1/merchant/{id}/stats
```

Returns merchant-scoped statistics.

## Publish keys

```http
POST /api/v1/merchant/keys/publish
```

Publishes public key material used for directory or privacy-related discovery. Never publish private keys or raw signing material.
