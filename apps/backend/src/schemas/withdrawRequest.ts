// Public inputs: [merkleRoot, nullifierHash, recipient, amount, token] — see design.md §Public input ordering contract
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
    // Public signals in the circuit's declaration order:
    //   [merkleRoot, nullifierHash, recipient, amount, token]
    // (packages/circuits/withdraw.circom:43-47; build/verification_key.json
    // nPublic = 5). Per-element formats mirror the corresponding top-level
    // request fields, so a serialized proof cannot claim a different root /
    // recipient / asset than the request itself.
    publicSignals: z
      .array(z.string())
      .length(5)
      .superRefine((signals, ctx) => {
        const perElement: Array<[number, string, RegExp]> = [
          [0, "merkleRoot", BYTES32_HEX],
          [1, "nullifierHash", BYTES32_HEX],
          [2, "recipient", ADDRESS],
          [3, "amount", POSITIVE_DECIMAL],
          [4, "token", ADDRESS],
        ];
        for (const [index, name, pattern] of perElement) {
          const value = signals[index];
          if (typeof value !== "string" || !pattern.test(value)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [index],
              message: `publicSignals[${index}] (${name}) must match ${pattern.toString()}`,
            });
          }
        }
      }),
    merkleRoot: z.string().regex(BYTES32_HEX),
    recipient: z.string().regex(ADDRESS),
    token: z.string().regex(ADDRESS),
    amount: z.string().regex(POSITIVE_DECIMAL),
    chainKey: z.literal("evm-sepolia"),
    contractAddress: z.string().regex(ADDRESS),
  })
  .strict();

export type WithdrawRequest = z.infer<typeof WithdrawRequestSchema>;
