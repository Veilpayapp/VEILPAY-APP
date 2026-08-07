#!/bin/bash
set -e

echo "🔐 Injecting Doppler secrets (production environment)..."

# Download secrets from Doppler production config
doppler secrets download --project veilpay --config prd --format env >> .env

# Verify critical SPP secrets are present
if ! grep -q "EXPO_PUBLIC_SPP_MAINNET_MANIFEST" .env; then
  echo "❌ ERROR: EXPO_PUBLIC_SPP_MAINNET_MANIFEST not found in .env"
  exit 1
fi

if ! grep -q "EXPO_PUBLIC_SPP_SOROBAN_RPC_URL" .env; then
  echo "❌ ERROR: EXPO_PUBLIC_SPP_SOROBAN_RPC_URL not found in .env"
  exit 1
fi

# Validate manifest contains mainnet configuration
if ! grep "EXPO_PUBLIC_SPP_MAINNET_MANIFEST" .env | grep -q "mainnet"; then
  echo "❌ ERROR: SPP_MAINNET_MANIFEST does not contain mainnet network identifier"
  exit 1
fi

# Validate RPC endpoint is mainnet, not testnet
if grep "EXPO_PUBLIC_SPP_SOROBAN_RPC_URL" .env | grep -q "testnet"; then
  echo "❌ ERROR: Testnet RPC endpoint found in production build - use mainnet only"
  exit 1
fi

# Verify RPC is pointing to Stellar mainnet
if ! grep "EXPO_PUBLIC_SPP_SOROBAN_RPC_URL" .env | grep -q "soroban-mainnet"; then
  echo "⚠️  WARNING: RPC endpoint does not contain 'soroban-mainnet' - verify it is production Stellar"
fi

echo "✅ Doppler secrets validated (production) - SPP mainnet configuration confirmed"
