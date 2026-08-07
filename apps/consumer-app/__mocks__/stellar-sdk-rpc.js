// Mock for stellar-sdk/rpc
module.exports = {
  Server: jest.fn(function(url) {
    this.url = url;
    this.submitTransaction = jest.fn().mockResolvedValue({
      id: 'test-transaction-id',
      result_xdr: 'test-xdr',
    });
    this.transactions = jest.fn().mockReturnValue({
      cursor: jest.fn(() => this),
      limit: jest.fn(() => this),
      order: jest.fn(() => this),
      call: jest.fn().mockResolvedValue({
        records: [],
      }),
    });
    this.operations = jest.fn().mockReturnValue({
      forAccount: jest.fn(() => this),
      cursor: jest.fn(() => this),
      limit: jest.fn(() => this),
      order: jest.fn(() => this),
      call: jest.fn().mockResolvedValue({
        records: [],
      }),
    });
    this.accounts = jest.fn().mockReturnValue({
      accountId: jest.fn(() => this),
      call: jest.fn().mockResolvedValue({
        id: 'test-account-id',
        balances: [],
        sequence: '1',
      }),
    });
  }),
};
