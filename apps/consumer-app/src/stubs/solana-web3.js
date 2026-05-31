/**
 * Stub for @solana/web3.js in the React Native bundle.
 *
 * @solana/web3.js pulls in ws, jayson, rpc-websockets and other Node-only deps
 * that cannot be bundled by Metro. The import in multiChainSigner.ts is dynamic
 * (lazy) — it only runs when the user actually initiates a Solana transaction,
 * at which point the build should be a native dev-client build that has the real
 * package available via the native module resolver.
 *
 * For Expo Go / JS-only bundles, Solana transactions will throw at runtime
 * (correct — Solana signing is backend-gated in production).
 */
module.exports = {};
