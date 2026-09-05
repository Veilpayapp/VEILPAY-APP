// Mock for @noble/hashes/sha3 used by ethers/viem.
// Returns a deterministic, input-dependent, NON-ZERO 32-byte value so that
// crypto-dependent tests (e.g. stealthEngine hashToScalar / address derivation)
// never reduce keccak output to an all-zeros scalar/address. The all-zeros
// (Buffer.alloc(32)) version broke stealthEngine's "derived scalar is zero"
// property. Top byte is forced non-zero so BigInt(hex) is never 0.
module.exports = {
  keccak_256: jest.fn((data) => {
    const input = Buffer.isBuffer(data) ? data : Buffer.from(data || []);
    const buf = Buffer.alloc(32);
    for (let i = 0; i < 32; i++) {
      let b = 0;
      for (let j = i; j < input.length; j += 32) b ^= input[j];
      buf[i] = (b + i + 1 + input.length) & 0xff;
    }
    return buf;
  }),
};
