// Public inputs: [merkleRoot, nullifierHash, recipient, amount] — see design.md §Public input ordering contract
import { z } from "zod";

const BYTES32_HEX = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX = /^0x[0-9a-fA-F]+$/;
// Positive integer in base-10: no leading zeros, no zero, no scientific notation.
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/;

export const WithdrawRequestSchema = z
  .object({
    nullifierHash: z.string().regex(BYTES32_HEX),
    // Encoded Groth16 proof; length varies with abi.encode wrapping, so no length constraint.
    proof: z.string().regex(HEX),
    publicSignals: z.array(z.string().regex(HEX)).length(4),
    merkleRoot: z.string().regex(BYTES32_HEX),
    recipient: z.string().regex(ADDRESS),
    token: z.string().regex(ADDRESS),
    amount: z.string().regex(POSITIVE_DECIMAL),
    chainKey: z.literal("evm-sepolia"),
    contractAddress: z.string().regex(ADDRESS),
  })
  .strict();

export type WithdrawRequest = z.infer<typeof WithdrawRequestSchema>;
