# Invoice lifecycle

Invoices are the merchant-facing representation of a payment request.

## Create

Merchants create invoices by sending an authenticated request to the backend. The request includes:

- merchant ID
- chain key
- token symbol
- amount
- optional memo
- expiry
- privacy level

## Pending

New invoices begin in a pending state. Pending invoices can be shown to users as QR codes, payment links, or app-native payment intents.

## Paid

An invoice becomes paid when Veilpay associates a confirmed payment with the invoice. The backend then queues webhook delivery so the merchant can update order state.

## Expired

Invoice expiry is handled by backend worker logic. Expired invoices should not be treated as payable unless a merchant explicitly creates a replacement invoice.

## Cancelled

Merchants can cancel invoices when payment is no longer expected. Cancelled invoices should be considered terminal for merchant order logic.

## Webhook delivery

Webhook delivery is asynchronous. Merchants should verify signatures, enforce timestamp windows, and make handlers idempotent.
