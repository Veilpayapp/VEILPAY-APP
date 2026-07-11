# Invoices

Invoices are the core merchant payment object.

## Create invoice

```http
POST /api/v1/invoice/create
```

Typical request fields:

```json
{
  "merchantId": "merchant-uuid",
  "chainKey": "ethereum",
  "tokenSymbol": "USDC",
  "amount": "100.00",
  "memo": "Order #12345",
  "expiresInMinutes": 60,
  "privacyLevel": "standard"
}
```

## List invoices

```http
GET /api/v1/invoice
```

Requires merchant authentication.

## Invoice status

```http
GET /api/v1/invoice/{id}/status
```

Returns public or rate-limited status information for an invoice.

## Invoice details

```http
GET /api/v1/invoice/{id}
```

Requires merchant authentication.

## Cancel invoice

```http
POST /api/v1/invoice/{id}/cancel
```

Cancels an invoice when payment is no longer expected.

## Mark or process payment

```http
POST /api/v1/invoice/{id}/pay
```

Used by authenticated backend flows to associate payment activity with an invoice and trigger webhook delivery.
