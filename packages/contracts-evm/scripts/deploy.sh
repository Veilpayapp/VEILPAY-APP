#!/bin/bash

# Deploy VeilPay Contracts to Testnet
# Usage: ./deploy.sh <network>

set -e

NETWORK=$1

if [ -z "$NETWORK" ]; then
    echo "Usage: ./deploy.sh <network>"
    echo "Networks: sepolia, goerli, mumbai"
    exit 1
fi

export PATH="$PATH:/c/Users/vahi1/.foundry/bin"

echo "Building contracts..."
forge build

echo "Deploying to $NETWORK..."

case $NETWORK in
    sepolia|goerli|mumbai)
        forge script script/DeployAll.s.sol:DeployAll --rpc-url "$NETWORK" --broadcast --verify -vvvv
        ;;
    *)
        echo "Unknown network: $NETWORK"
        exit 1
        ;;
esac

echo "Deployment complete!"
echo "Check the broadcast directory for deployment addresses."
