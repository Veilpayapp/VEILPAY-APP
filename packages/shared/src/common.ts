import type { ChainType } from "./chains";

export interface BaseTokenInfo {
  symbol: string;
  name: string;
  decimals: number;
  icon?: string;
}

export interface TokenBalance extends BaseTokenInfo {
  balance: string;
  balanceFormatted: string;
  usdValue?: number;
}

export interface TransactionInfo {
  hash: string;
  from: string;
  to: string;
  value: string;
  tokenSymbol: string;
  timestamp: number;
  status: "pending" | "confirmed" | "failed";
  blockNumber?: number;
  fee?: string;
  privacyLevel?: "standard" | "max";
}

export interface InvoiceInfo {
  id: string;
  merchantId: string;
  chainKey: string;
  tokenSymbol: string;
  amount: string;
  status: "pending" | "paid" | "expired" | "cancelled";
  expiresAt: number;
  paymentAddress?: string;
  paymentTxHash?: string;
}

export interface MerchantInfo {
  id: string;
  businessName: string;
  email: string;
  status: "pending" | "active" | "suspended" | "deleted";
  viewingKeys: Array<{
    chainKey: string;
    settlementAddress: string;
  }>;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  nextCursor?: string | null;
  hasMore: boolean;
}

// Unified ChainInfo type — uses ChainType from chains.ts (no duplicate)
export interface ChainInfo {
  key: string;
  name: string;
  type: ChainType;
  chainId?: number;
  symbol: string;
  rpcUrl: string;
  explorerUrl: string;
}
