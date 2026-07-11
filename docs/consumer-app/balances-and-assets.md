# Balances and assets

The consumer app displays balances by chain and token.

## Balance sources

- EVM balances through RPC provider calls or backend-proxied RPC.
- Solana balances through Solana JSON-RPC.
- Stellar balances through Horizon.
- Token assets through configured token metadata and supported discovery paths.

## Price data

The app uses price feed logic with cache and fallback behavior. Stale or unavailable price data should be displayed honestly rather than silently treated as live.

## Asset list UX

Dashboard asset lists are optimized for mobile performance and should not block core wallet navigation if a network or price provider is degraded.
