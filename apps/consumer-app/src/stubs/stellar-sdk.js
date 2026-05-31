/**
 * Stub for stellar-sdk in the React Native bundle.
 *
 * stellar-sdk pulls in dozens of Node core sub-dependencies (ws, https, streams,
 * jayson, etc.) that cannot be bundled by Metro. The actual stellar signing path
 * in multiChainSigner.ts is lazy-loaded at runtime only when a Stellar transaction
 * is requested — by that point the native module resolution has been replaced by
 * the actual stellar-sdk if the app is built with the native dev client.
 *
 * For Expo Go / JS-only bundles, Stellar transactions will throw at runtime
 * (which is the correct behaviour — Stellar signing is backend-gated).
 */
module.exports = {};
