import { config } from '../config';

export interface GoldrushTxResponse {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
  tokenSymbol: string;
  blockNumber: number;
}

/**
 * Mock wrapper for Goldrush API. In a real environment, this would hit:
 * https://api.covalenthq.com/v1/{chainName}/address/{address}/transactions_v3/
 */
export async function fetchGoldrushTransactions(
  _chainKey: string,
  _address: string
): Promise<GoldrushTxResponse[]> {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 500));
  
  if (!config.rpc.goldrushApiKey) {
    return [];
  }

  // NOTE: This is where the actual Goldrush API fetch would go. 
  // For the sake of the implementation, we return an empty array 
  // unless we're mocking a specific test scenario.
  return [];
}
