// The '^@noble/hashes/sha3$' moduleNameMapper lands here so jest resolves the
// hoisted CJS build deterministically. Re-export the REAL keccak — a fake
// digest silently broke every genuine consumer (e.g. viem's EIP-55
// `isAddress(…, { strict: true })` computed garbage checksums and rejected
// valid mixed-case addresses).
module.exports = require('../../../../../node_modules/@noble/hashes/sha3.js');
