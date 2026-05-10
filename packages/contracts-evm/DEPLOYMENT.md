# VeilPay Smart Contract Deployment Guide

## Phase 3: Smart Contract Deployment

This guide covers the deployment of VeilPay's EVM smart contracts to testnet networks.

### Prerequisites

1. **Foundry Installation**

   ```bash
   curl -L https://foundry.paradigm.xyz | bash
   foundryup
   ```

2. **Environment Setup**

   ```bash
   cd packages/contracts-evm
   cp .env.example .env
   ```

3. **Configure Environment Variables**
   - `PRIVATE_KEY`: Deployer private key (fund with testnet ETH/MATIC)
   - `SEPOLIA_RPC_URL`: Sepolia RPC endpoint (Infura/Alchemy)
   - `GOERLI_RPC_URL`: Goerli RPC endpoint
   - `POLYGON_MUMBAI_RPC_URL`: Mumbai RPC endpoint
   - `ETHERSCAN_API_KEY`: Etherscan API key for verification
   - `POLYGONSCAN_API_KEY`: Polygonscan API key for Mumbai verification

### Contracts

| Contract              | Description           | Constructor Args           |
| --------------------- | --------------------- | -------------------------- |
| `Groth16Verifier.sol` | Fail-closed verifier placeholder; replace with generated Groth16 verifier before production | None |
| `VeilRegistry.sol`    | Merchant registry     | None                       |
| `VeilPool.sol`        | Privacy pool          | `verifier`, `feeRecipient` |

### Deployment

#### Deploy All Contracts

```bash
# Sepolia
./scripts/deploy.sh sepolia

# Goerli
./scripts/deploy.sh goerli

# Mumbai
./scripts/deploy.sh mumbai
```

#### Deploy Individual Contracts

```bash
# Deploy Verifier only
forge script script/DeployVerifier.s.sol:DeployVerifier --rpc-url sepolia --broadcast

# Deploy Registry only
forge script script/DeployRegistry.s.sol:DeployRegistry --rpc-url sepolia --broadcast

# Deploy Pool (requires VERIFIER_ADDRESS in .env)
forge script script/DeployPool.s.sol:DeployPool --rpc-url sepolia --broadcast
```

### Verification

Contracts are automatically verified during deployment. To manually verify:

```bash
# Verify contract
forge verify-contract <address> <contract_name> --verifier etherscan
```

### Network Configurations

| Network | Chain ID | Currency | Explorer               |
| ------- | -------- | -------- | ---------------------- |
| Sepolia | 11155111 | ETH      | sepolia.etherscan.io   |
| Goerli  | 5        | ETH      | goerli.etherscan.io    |
| Mumbai  | 80001    | MATIC    | mumbai.polygonscan.com |

### Gas Optimization

The contracts are compiled with:

- Solidity 0.8.25
- EVM version: Paris
- Optimizer: enabled (200 runs)
- Via IR: enabled

### Post-Deployment

After deployment, update the contract addresses in:

1. `apps/backend/src/config/contracts.ts`
2. `apps/indexer/src/config/chains.ts`

### Security Considerations

- The bundled `Groth16Verifier.sol` intentionally returns `false` until it is replaced with a generated verifier contract from a real circuit and trusted setup.
- Never commit private keys to version control
- Use hardware wallets for mainnet deployment
- Verify all contract addresses before funding
- Test thoroughly on testnets before mainnet deployment

### Contract ABIs

After compilation, ABIs are available at:

```
packages/contracts-evm/out/<ContractName>.sol/<ContractName>.json
```

### Testnet Faucets

- **Sepolia**: https://sepoliafaucet.com/
- **Goerli**: https://goerlifaucet.com/
- **Mumbai**: https://faucet.polygon.technology/
