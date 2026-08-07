// Mock for stellar-sdk
module.exports = {
  Keypair: {
    random: jest.fn(() => ({
      publicKey: jest.fn(() => 'GBTEST123456789ABCDEF'),
      secret: jest.fn(() => 'SBTEST123456789ABCDEF'),
    })),
    fromSecret: jest.fn((secret) => ({
      publicKey: jest.fn(() => 'GBTEST123456789ABCDEF'),
      secret: jest.fn(() => secret),
    })),
  },
  Account: jest.fn((publicKey, sequence) => ({
    accountId: jest.fn(() => publicKey),
    sequence,
  })),
  TransactionBuilder: jest.fn(function(sourceAccount) {
    this.sourceAccount = sourceAccount;
    this.operations = [];
    this.addOperation = jest.fn((op) => {
      this.operations.push(op);
      return this;
    });
    this.setTimeout = jest.fn(() => this);
    this.build = jest.fn(() => ({
      toEnvelope: jest.fn(() => ({})),
    }));
    this.setBaseFee = jest.fn(() => this);
    this.setNetworkPassphrase = jest.fn(() => this);
    return this;
  }),
  Networks: {
    PUBLIC_NETWORK_PASSPHRASE: 'Public Global Stellar Network ; September 2015',
    TESTNET_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
  },
};
