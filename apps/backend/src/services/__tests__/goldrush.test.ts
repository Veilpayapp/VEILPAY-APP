import { fetchGoldrushTransactions } from '../goldrush';
import { config } from '../../config';

jest.mock('../../config', () => ({
  config: {
    rpc: {
      goldrushApiKey: 'test-api-key'
    }
  }
}));

describe('goldrush service', () => {
  it('should return empty array for now since it is mocked', async () => {
    const result = await fetchGoldrushTransactions('solana', 'addr');
    expect(result).toEqual([]);
  });
});
