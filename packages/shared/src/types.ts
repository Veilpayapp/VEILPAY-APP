import { z } from "zod";

export const addressSchema = z.custom<`0x${string}`>((val) => {
  return typeof val === "string" && /^0x[a-fA-F0-9]{40}$/.test(val);
}, "Invalid Ethereum address");

export const solanaAddressSchema = z.custom<string>((val) => {
  return typeof val === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(val);
}, "Invalid Solana address");

export const aptosAddressSchema = z.custom<`0x${string}`>((val) => {
  return typeof val === "string" && /^0x[a-fA-F0-9]{64}$/.test(val);
}, "Invalid Aptos address");

export const txHashSchema = z.custom<`0x${string}`>((val) => {
  return typeof val === "string" && /^0x[a-fA-F0-9]{64}$/.test(val);
}, "Invalid EVM transaction hash");

export const solanaTxHashSchema = z.custom<string>((val) => {
  return typeof val === "string" && /^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(val);
}, "Invalid Solana transaction signature");

export const aptosTxHashSchema = z.custom<`0x${string}`>((val) => {
  return typeof val === "string" && /^0x[a-fA-F0-9]{64}$/.test(val);
}, "Invalid Aptos transaction hash");

export const tokenAmountSchema = z.object({
  amount: z.string(),
  decimals: z.number().int().nonnegative(),
  symbol: z.string(),
});

// Fix: replaced z.bigint() with z.string() for JSON serialization safety
export const feeEstimateSchema = z.object({
  gasLimit: z.string(),
  maxFeePerGas: z.string(),
  maxPriorityFeePerGas: z.string(),
  totalFee: z.string(),
});

// BE-H1 fix: strict numeric amount validation
export const numericAmountSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "Amount must be a positive numeric string")
  .refine((val) => {
    const num = parseFloat(val);
    return !isNaN(num) && num > 0 && isFinite(num);
  }, "Amount must be greater than 0");

export type Address = z.infer<typeof addressSchema>;
export type SolanaAddress = z.infer<typeof solanaAddressSchema>;
export type AptosAddress = z.infer<typeof aptosAddressSchema>;
export type TxHash = z.infer<typeof txHashSchema>;
export type SolanaTxHash = z.infer<typeof solanaTxHashSchema>;
export type AptosTxHash = z.infer<typeof aptosTxHashSchema>;
export type TokenAmount = z.infer<typeof tokenAmountSchema>;
export type FeeEstimate = z.infer<typeof feeEstimateSchema>;
