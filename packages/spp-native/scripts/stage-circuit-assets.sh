#!/usr/bin/env bash
# Stage policy_tx_2_2 circuit assets (see stage-circuit-assets.ps1).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT="${1:-$ROOT/apps/consumer-app/assets/spp/circuits}"
mkdir -p "$OUT"

find_file() {
  local name="$1"
  local candidates=(
    "$ROOT/.local/spp-phase0/alice/circuits/$name"
    "$ROOT/packages/vendor/spp/testdata/release/$name"
    "$ROOT/packages/vendor/spp/target/circuits-artifacts/release/$name"
    "$ROOT/packages/vendor/spp/testdata/$name"
    "$ROOT/packages/vendor/spp/deployments/testnet/circuit_keys/$name"
  )
  for p in "${candidates[@]}"; do
    if [[ -f "$p" ]]; then echo "$p"; return 0; fi
  done
  return 1
}

for n in policy_tx_2_2_proving_key.bin policy_tx_2_2.wasm policy_tx_2_2.r1cs; do
  src="$(find_file "$n")" || { echo "Missing $n"; exit 1; }
  cp -f "$src" "$OUT/$n"
  echo "OK $n ($(wc -c < "$OUT/$n") bytes) from $src"
done
echo "Staged → $OUT"
