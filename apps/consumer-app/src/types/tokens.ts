export type ChainTypeKey = 'evm' | 'svm' | 'mvm' | 'xlm';

export interface PaymentToken {
  id: string;
  name: string;
  symbol: string;
  balance: string;
  usdPrice: number;
  chainTypes: ChainTypeKey[];
  icon?: string;
  address?: string;
  decimals?: number;
}
