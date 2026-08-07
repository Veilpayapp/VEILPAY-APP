#!/bin/bash
set -e

echo "🔐 Injecting Doppler secrets (preview environment)..."

# Download secrets from Doppler preview config
doppler secrets download --project veilpay --config stg --format env >> .env

# Verify critical SPP secrets are present
if ! grep -q "EXPO_PUBLIC_SPP_MAINNET_MANIFEST" .env; then
  echo "⚠️  WARNING: EXPO_PUBLIC_SPP_MAINNET_MANIFEST not found in .env"
fi

if ! grep -q "EXPO_PUBLIC_SPP_SOROBAN_RPC_URL" .env; then
  echo "⚠️  WARNING: EXPO_PUBLIC_SPP_SOROBAN_RPC_URL not found in .env"
fi

echo "✅ Doppler secrets injected (preview)"
