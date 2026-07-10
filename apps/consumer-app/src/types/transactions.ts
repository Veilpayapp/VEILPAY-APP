export type TransactionType = 'sent' | 'received';

export type TransactionStatus = 'completed' | 'pending' | 'failed';

export interface TransactionRecord {
  id: string;
  type: TransactionType;
  amount: string;
  token: string;
  tokenSymbol: string;
  from: string;
  to: string;
  timestamp: number;
  status: TransactionStatus;
  hash: string;
  privacyLevel?: 'standard' | 'stealth' | 'max' | 'private';

  fee?: string;
  network?: string;
}
