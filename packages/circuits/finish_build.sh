#!/bin/bash
CIRCUITS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_TMP="$CIRCUITS_DIR/build.tmp"
BUILD="$CIRCUITS_DIR/build"
CONTRACTS_DIR="$CIRCUITS_DIR/../contracts-evm/src"
WRAPPER_TEMPLATE="$CONTRACTS_DIR/Groth16VerifierWrapperTemplate.txt"
VERIFIER_TARGET="$CONTRACTS_DIR/Groth16Verifier.sol"

python - "$BUILD_TMP/Groth16Verifier.renamed.sol" "$WRAPPER_TEMPLATE" "$BUILD_TMP/Groth16Verifier.sol" <<'PY'
import pathlib
import re
import sys

src_path, tmpl_path, dst_path = sys.argv[1:4]
src = pathlib.Path(src_path).read_text(encoding='utf-8')
tmpl = pathlib.Path(tmpl_path).read_text(encoding='utf-8')

SENTINEL = "VEILPAY_WRAPPER_INJECTED"
if SENTINEL in src:
    pathlib.Path(dst_path).write_text(src, encoding='utf-8')
    sys.exit(0)

if not src.lstrip().startswith("// SPDX"):
    src = "// SPDX-License-Identifier: MIT\n" + src

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

if "IGroth16Verifier" not in src:
    src, n = re.subn(
        r"(pragma solidity[^;]+;\n)",
        r'\1import {IGroth16Verifier} from "./IGroth16Verifier.sol";\n',
        src,
        count=1,
    )
    if n != 1:
        print("compile.sh: failed to locate pragma line for import injection", file=sys.stderr)
        sys.exit(1)

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

last_brace = src.rfind("}")
if last_brace == -1:
    print("compile.sh: no closing brace found in generated verifier", file=sys.stderr)
    sys.exit(1)

sentinel_block = "\n    // " + SENTINEL + "\n"
src = src[:last_brace] + sentinel_block + tmpl + "\n" + src[last_brace:]

pathlib.Path(dst_path).write_text(src, encoding='utf-8')
PY

mv "$BUILD_TMP/Groth16Verifier.sol" "$VERIFIER_TARGET"
rm -rf "$BUILD"
mv "$BUILD_TMP" "$BUILD"

echo "compile.sh: OK"
