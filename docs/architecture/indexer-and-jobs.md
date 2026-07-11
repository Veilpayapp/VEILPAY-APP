# Indexer and jobs

Veilpay uses background workers for tasks that should not block API request/response paths.

## Job categories

- Chain polling and transaction detection.
- Retry and dead-letter handling for failed background jobs.
- Future Stellar SPP indexing for Merkle roots and inclusion data.

## BullMQ

BullMQ is used for queue-based job execution. Redis provides the backing store for queues, retry state, and coordination.

## Chain indexer

The indexer package and backend chain-indexing jobs monitor networks for transaction status. Supported chain behavior differs by network, so integration code is split by chain family.

## Stellar SPP indexing roadmap

The Stellar SPP plan includes a future backend indexer that maintains cached Merkle tree data for private pool operations. This is documented as planned backend work and is not treated as production-live mainnet infrastructure.
