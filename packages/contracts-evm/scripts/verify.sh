#!/bin/bash

# VeilPay Contract Verification Script
# Usage: ./verify.sh <network> <contract_address> <constructor_args>

set -e

NETWORK=$1
CONTRACT_ADDRESS=$2
CONSTRUCTOR_ARGS=$3

if [ -z "$NETWORK" ] || [ -z "$CONTRACT_ADDRESS" ]; then
    echo "Usage: ./verify.sh <network> <contract_address> [constructor_args]"
    echo "Networks: sepolia, goerli, mumbai, mainnet"
    exit 1
fi

case $NETWORK in
    sepolia)
        VERIFIER_URL="https://api-sepolia.etherscan.io/api"
        ;;
    goerli)
        VERIFIER_URL="https://api-goerli.etherscan.io/api"
        ;;
    mumbai)
        VERIFIER_URL="https://api-testnet.polygonscan.com/api"
        ;;
    mainnet)
        VERIFIER_URL="https://api.etherscan.io/api"
        ;;
    *)
        echo "Unknown network: $NETWORK"
        exit 1
        ;;
esac

echo "Verifying contract on $NETWORK..."
echo "Contract Address: $CONTRACT_ADDRESS"

export PATH="$PATH:/c/Users/vahi1/.foundry/bin"

if [ -n "$CONSTRUCTOR_ARGS" ]; then
    forge verify-contract "$CONTRACT_ADDRESS" "$CONSTRUCTOR_ARGS" --verifier-url "$VERIFIER_URL" --watch
else
    forge verify-contract "$CONTRACT_ADDRESS" --verifier-url "$VERIFIER_URL" --watch
fi

echo "Verification complete!"
