// Mock for @noble/hashes/sha3 used by ethers
module.exports = {
  keccak_256: jest.fn((data) => Buffer.alloc(32)),
};
