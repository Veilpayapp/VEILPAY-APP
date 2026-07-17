#!/bin/bash
# Public inputs: [merkleRoot, nullifierHash, recipient, amount, token]
# See packages/circuits/docs/CIRCUIT_SECURITY.md
#
# DEV-ONLY trusted setup: entropy strings and beacon below are NOT a production
# ceremony. Do not deploy mainnet with these zkeys. Re-run a multi-party
# ceremony after any circuit change.
#
# Hardened, atomic build pipeline for the VeilPay withdraw circuit.
#
# Pipeline (each step exits non-zero on failure; nothing in the canonical
# build/ directory or contracts-evm/src/Groth16Verifier.sol is overwritten
# until every step has succeeded):
#
#   1. circom compile                         (withdraw.r1cs, withdraw.wasm, withdraw.sym)
#   2. powers-of-tau ceremony (cached)        (pot12_final.ptau)
#   3. groth16 setup + zkey contribute + beacon (withdraw_final.zkey)
#   4. export verification key                (verification_key.json)
#   5. export solidity verifier               (Groth16Verifier.raw.sol)
#   6. post-process the verifier              (rename verifyProof → _verifyProofRaw,
#                                              wire IGroth16Verifier interface,
#                                              inject canonical wrapper, idempotent)
#   7. atomic promotion                       (mv build.tmp/ → build/, last)
#
# All intermediate artifacts are written to build.tmp/. The final Groth16Verifier.sol
# overwrite and the build/ rename happen ONLY after every step succeeds.
#
# Idempotency: the post-processing step uses a sentinel comment line
# `// VEILPAY_WRAPPER_INJECTED`. Running the script repeatedly is safe.

set -euo pipefail
trap 'echo "compile.sh: FAILED at line $LINENO" >&2; exit 1' ERR

CIRCUITS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_TMP="$CIRCUITS_DIR/build.tmp"
BUILD="$CIRCUITS_DIR/build"
CONTRACTS_DIR="$CIRCUITS_DIR/../contracts-evm/src"
WRAPPER_TEMPLATE="$CONTRACTS_DIR/Groth16VerifierWrapperTemplate.txt"
VERIFIER_TARGET="$CONTRACTS_DIR/Groth16Verifier.sol"
PTAU="$CIRCUITS_DIR/pot14_final.ptau"

test -f "$WRAPPER_TEMPLATE" || {
  echo "compile.sh: missing wrapper template at $WRAPPER_TEMPLATE" >&2
  exit 1
}

rm -rf "$BUILD_TMP"
mkdir -p "$BUILD_TMP"

echo "[1/6] circom compile..." >&2
circom "$CIRCUITS_DIR/withdraw.circom" --r1cs --wasm --sym -o "$BUILD_TMP"

# circom emits the witness wasm under build.tmp/withdraw_js/withdraw.wasm.
# Copy it up to build.tmp/withdraw.wasm so consumers don't need to know that.
WITNESS_WASM="$BUILD_TMP/withdraw_js/withdraw.wasm"
test -f "$WITNESS_WASM" || {
  echo "compile.sh: missing $WITNESS_WASM after circom compile" >&2
  exit 1
}
cp "$WITNESS_WASM" "$BUILD_TMP/withdraw.wasm"

echo "[2/6] powers of tau (cached at $PTAU)..." >&2
if [ ! -f "$PTAU" ]; then
  snarkjs powersoftau new bn128 14 "$BUILD_TMP/pot14_0000.ptau" -v
  snarkjs powersoftau contribute "$BUILD_TMP/pot14_0000.ptau" "$BUILD_TMP/pot14_0001.ptau" \
    --name="dev" -v -e="random text"
  snarkjs powersoftau prepare phase2 "$BUILD_TMP/pot14_0001.ptau" "$PTAU" -v
fi

echo "[3/6] groth16 setup + contribute + beacon..." >&2
snarkjs groth16 setup "$BUILD_TMP/withdraw.r1cs" "$PTAU" "$BUILD_TMP/withdraw_0000.zkey"
snarkjs zkey contribute "$BUILD_TMP/withdraw_0000.zkey" "$BUILD_TMP/withdraw_phase2.zkey" \
  --name="dev2" -v -e="random text again"
snarkjs zkey beacon "$BUILD_TMP/withdraw_phase2.zkey" "$BUILD_TMP/withdraw_final.zkey" \
  0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20 10 \
  -n="VeilPay Final Beacon"

echo "[4/6] export verification key..." >&2
snarkjs zkey export verificationkey "$BUILD_TMP/withdraw_final.zkey" \
  "$BUILD_TMP/verification_key.json"

echo "[5/6] export solidity verifier (raw)..." >&2
snarkjs zkey export solidityverifier "$BUILD_TMP/withdraw_final.zkey" \
  "$BUILD_TMP/Groth16Verifier.raw.sol"

echo "[6/6] post-process Groth16Verifier..." >&2
# Step 6a: rename the snarkjs-generated `verifyProof(uint[2],uint[2][2],uint[2],uint[N])`
# to `_verifyProofRaw(...)` so the appended wrapper can take the canonical name.
# We deliberately do NOT touch any other identifier in the file.
sed -E 's/(\s)function verifyProof(\s*\()/\1function _verifyProofRaw\2/' \
  "$BUILD_TMP/Groth16Verifier.raw.sol" > "$BUILD_TMP/Groth16Verifier.renamed.sol"

# Step 6b: inject canonical-ordering header, IGroth16Verifier import,
# `is IGroth16Verifier` declaration, and append the wrapper template.
# Done in Python because (a) idempotency requires a sentinel-aware multi-line
# rewrite, (b) sed's portability across BSD/GNU is poor for this, and (c) shell
# heredocs would bake the wrapper text into this script and force two sources
# of truth. The wrapper template is the single source of truth.
python3 - "$BUILD_TMP/Groth16Verifier.renamed.sol" "$WRAPPER_TEMPLATE" "$BUILD_TMP/Groth16Verifier.sol" <<'PY'
import pathlib
import re
import sys

src_path, tmpl_path, dst_path = sys.argv[1:4]
src = pathlib.Path(src_path).read_text()
tmpl = pathlib.Path(tmpl_path).read_text()

# Idempotency sentinel: if the wrapper is already injected, write through unchanged.
SENTINEL = "VEILPAY_WRAPPER_INJECTED"
if SENTINEL in src:
    pathlib.Path(dst_path).write_text(src)
    sys.exit(0)

# Ensure SPDX header (snarkjs always emits one, but guard against future changes).
if not src.lstrip().startswith("// SPDX"):
    src = "// SPDX-License-Identifier: MIT\n" + src

# Inject canonical-ordering header right after the SPDX line. Idempotent on the
# header text alone (the SENTINEL check above already guards the wrapper).
canon_header = (
    "// Public inputs: [merkleRoot, nullifierHash, recipient, amount] "
    "\u2014 see design.md \u00a7Public input ordering contract\n"
)
if canon_header not in src:
    out_lines = []
    inserted = False
    for line in src.splitlines(keepends=True):
        out_lines.append(line)
        if not inserted and line.startswith("// SPDX"):
            out_lines.append(canon_header)
            inserted = True
    src = "".join(out_lines)

# Inject `import {IGroth16Verifier} from "./IGroth16Verifier.sol";` after the
# pragma line, if not already present.
if "IGroth16Verifier" not in src:
    # Build the import with plain quotes (never write backslash-escaped paths —
    # that produces invalid Solidity: from \"./File.sol\").
    _import_line = 'import {IGroth16Verifier} from "' + "./IGroth16Verifier.sol" + '";\n'
    src, n = re.subn(
        r"(pragma solidity[^;]+;\n)",
        r"\1" + _import_line,
        src,
        count=1,
    )
    if n != 1:
        print("compile.sh: failed to locate pragma line for import injection", file=sys.stderr)
        sys.exit(1)

# Make the contract `is IGroth16Verifier`. snarkjs may name the contract
# `Groth16Verifier`, `Verifier`, or `PlonkVerifier` depending on version; we
# normalize to `Groth16Verifier` so VeilPool/import paths are stable.
m = re.search(r"contract\s+(\w+)\s*\{", src)
if not m:
    print("compile.sh: cannot locate contract declaration in generated verifier", file=sys.stderr)
    sys.exit(1)
contract_name = m.group(1)
src = re.sub(
    r"contract\s+" + re.escape(contract_name) + r"\s*\{",
    "contract Groth16Verifier is IGroth16Verifier {",
    src,
    count=1,
)

# Inject the sentinel + wrapper template just before the contract's closing
# brace. We use rfind('}') because the contract body is the last thing in the
# file emitted by snarkjs.
last_brace = src.rfind("}")
if last_brace == -1:
    print("compile.sh: no closing brace found in generated verifier", file=sys.stderr)
    sys.exit(1)

sentinel_block = "\n    // " + SENTINEL + "\n"
src = src[:last_brace] + sentinel_block + tmpl + "\n" + src[last_brace:]

pathlib.Path(dst_path).write_text(src)
PY

# Atomic step 7: only now do we overwrite the canonical verifier and promote
# build.tmp/ to build/. If anything above failed, the trap fired and we never
# reach this block, so the previously-good artifacts remain intact.
mv "$BUILD_TMP/Groth16Verifier.sol" "$VERIFIER_TARGET"

rm -rf "$BUILD"
mv "$BUILD_TMP" "$BUILD"

echo "compile.sh: OK" >&2
echo "  - $BUILD/withdraw.wasm" >&2
echo "  - $BUILD/withdraw_final.zkey" >&2
echo "  - $BUILD/verification_key.json" >&2
echo "  - $VERIFIER_TARGET" >&2
