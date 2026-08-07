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

echo "✅ Doppler secrets injected (production) - SPP mainnet enabled"
