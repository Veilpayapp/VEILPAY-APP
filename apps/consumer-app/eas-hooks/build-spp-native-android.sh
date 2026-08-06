#!/usr/bin/env bash
# Build libspp_native.so (Poseidon2 derive + CAP_ASP_LEAF) into the Expo module jniLibs.
#
# Runs on EAS Android builders via eas-build-post-install.
# Product path: native cdylib only — not a WebView of SPP sdk/web.
#
# Env:
#   SPP_NATIVE_SKIP=1     — no-op success (emergency bypass)
#   EAS_BUILD_PLATFORM    — only runs when android
#   ANDROID_NDK_HOME / ANDROID_HOME — set by EAS images
set -euo pipefail

log() { echo "[spp-native-ndk] $*"; }
error() { echo "[spp-native-ndk] ERROR: $*" >&2; }
warn() { echo "[spp-native-ndk] WARN: $*" >&2; }
debug() { if [[ "${SPP_NATIVE_DEBUG:-}" == "1" ]]; then echo "[spp-native-ndk] DEBUG: $*"; fi; }

if [[ "${SPP_NATIVE_SKIP:-}" == "1" ]]; then
  log "SPP_NATIVE_SKIP=1 — skipping NDK build"
  exit 0
fi

# Local `npm install` / iOS EAS: skip without failing the install.
if [[ "${EAS_BUILD:-}" != "true" && "${CI:-}" != "1" && -z "${ANDROID_NDK_HOME:-}${ANDROID_HOME:-}" ]]; then
  log "Not an EAS/CI Android environment — skip (local: packages/spp-native/scripts/build-android-ndk.*)"
  exit 0
fi

if [[ "${EAS_BUILD_PLATFORM:-android}" != "android" ]]; then
  log "Platform is ${EAS_BUILD_PLATFORM:-unknown} — skip Android NDK"
  exit 0
fi

# Hook cwd is apps/consumer-app (directory that owns eas.json / package.json).
APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$APP_ROOT/../.." && pwd)"
SPP_NATIVE="$REPO_ROOT/packages/spp-native"
# EAS fallback copy (always committed under spp-native).
POSEIDON2_EAS="$SPP_NATIVE/vendor/poseidon2"
# Unified Cargo path used by spp-native + sdk/pool (must match Cargo.toml).
POSEIDON2_SPP="$REPO_ROOT/packages/vendor/spp/poseidon2"
OUT_JNI="$APP_ROOT/modules/spp-native/android/src/main/jniLibs"
SPP_VENDOR_ROOT="$REPO_ROOT/packages/vendor/spp"
SPP_VENDOR_REPO="https://github.com/NethermindEth/stellar-private-payments"
# Must match the packages/vendor/spp gitlink in the VeilPay repository.
SPP_VENDOR_COMMIT="dbe6a98323c954d39bd5204f6ba58905cc27d2d7"
# Opt-in: build with --features android-jni,pool-ops when SPP_NATIVE_POOL_OPS=1
# (requires full packages/vendor/spp + wasmer NDK; default stays derive-only).
POOL_OPS_FEATURES=""
if [[ "${SPP_NATIVE_POOL_OPS:-}" == "1" ]]; then
  POOL_OPS_FEATURES=",pool-ops"
  log "SPP_NATIVE_POOL_OPS=1 — will build with pool-ops (CAP_POOL_OPS)"

  # EAS does not include a submodule working tree in the uploaded archive.
  # Fetch only crates reachable from spp-native's pool-ops feature, pinned to
  # the exact audited submodule commit (no moving branch or unreviewed source).
  if [[ ! -f "$SPP_VENDOR_ROOT/sdk/pool/Cargo.toml" ]]; then
    log "pool-ops feature requires full SPP vendor source…"
    command -v git >/dev/null 2>&1 || {
      log "ERROR: git is required to fetch the pinned SPP pool-ops source"
      exit 1
    }
    log "Fetching pinned SPP pool-ops source from $SPP_VENDOR_REPO@${SPP_VENDOR_COMMIT}…"
    mkdir -p "$(dirname "$SPP_VENDOR_ROOT")"

    if [[ ! -d "$SPP_VENDOR_ROOT/.git" ]]; then
      log "Initializing git repo at $SPP_VENDOR_ROOT"
      git init -q "$SPP_VENDOR_ROOT"
    fi

    if git -C "$SPP_VENDOR_ROOT" remote get-url origin >/dev/null 2>&1; then
      log "Updating remote origin to $SPP_VENDOR_REPO"
      git -C "$SPP_VENDOR_ROOT" remote set-url origin "$SPP_VENDOR_REPO"
    else
      log "Adding remote origin: $SPP_VENDOR_REPO"
      git -C "$SPP_VENDOR_ROOT" remote add origin "$SPP_VENDOR_REPO"
    fi

    log "Configuring sparse checkout…"
    git -C "$SPP_VENDOR_ROOT" sparse-checkout init --cone
    git -C "$SPP_VENDOR_ROOT" sparse-checkout set \
      .cargo circuit-keys circuits cli contracts e2e-tests poseidon2 \
      sdk/disclosure sdk/pool sdk/prover sdk/state sdk/stellar \
      sdk/tests sdk/tx-planner sdk/types sdk/web sdk/witness \
      tools/ceremony-cli vendor/cranelift-control

    log "Fetching from origin (depth 1, commit: $SPP_VENDOR_COMMIT)…"
    GIT_FETCH_LOG="/tmp/git-fetch.log"
    if ! git -C "$SPP_VENDOR_ROOT" fetch --depth 1 origin "$SPP_VENDOR_COMMIT" 2>&1 | tee "$GIT_FETCH_LOG"; then
      log "ERROR: git fetch failed"
      log "Git fetch output:"
      cat "$GIT_FETCH_LOG" | sed 's/^/  /'
      exit 1
    fi

    log "Checking out $SPP_VENDOR_COMMIT…"
    if ! git -C "$SPP_VENDOR_ROOT" checkout -q --detach FETCH_HEAD 2>&1 | tee -a "$GIT_FETCH_LOG"; then
      log "ERROR: git checkout failed"
      cat "$GIT_FETCH_LOG" | sed 's/^/  /'
      exit 1
    fi

    log "✓ SPP vendor fetched successfully"
  else
    log "✓ SPP vendor already present at $SPP_VENDOR_ROOT"
  fi

  actual_commit="$(git -C "$SPP_VENDOR_ROOT" rev-parse HEAD 2>/dev/null || true)"
  if [[ "$actual_commit" != "$SPP_VENDOR_COMMIT" ]]; then
    log "ERROR: SPP source commit mismatch"
    log "  Expected: $SPP_VENDOR_COMMIT"
    log "  Got:      ${actual_commit:-missing}"
    log "Diagnostic: git status in $SPP_VENDOR_ROOT"
    cd "$SPP_VENDOR_ROOT" && git status | sed 's/^/  /' && cd - >/dev/null
    exit 1
  fi
  log "✓ SPP vendor commit verified: $actual_commit"
fi

if [[ ! -f "$SPP_NATIVE/Cargo.toml" ]]; then
  log "ERROR: packages/spp-native missing from EAS archive."
  log "  expected: $SPP_NATIVE/Cargo.toml"
  log "  Commit packages/spp-native (EAS git upload skips untracked files)."
  log "  Also commit apps/consumer-app/modules/spp-native for the Expo module."
  exit 1
fi

if [[ ! -f "$POSEIDON2_EAS/Cargo.toml" ]]; then
  log "ERROR: vendored poseidon2 missing (packages/spp-native/vendor/poseidon2)."
  log "  expected: $POSEIDON2_EAS/Cargo.toml"
  exit 1
fi

# Materialize packages/vendor/spp/poseidon2 for Cargo path (submodule may be gitlink-only on EAS).
if [[ ! -f "$POSEIDON2_SPP/Cargo.toml" ]]; then
  log "Materializing poseidon2 at packages/vendor/spp/poseidon2 from EAS vendor copy…"
  mkdir -p "$POSEIDON2_SPP"
  cp -a "$POSEIDON2_EAS/." "$POSEIDON2_SPP/"
fi
if [[ ! -f "$POSEIDON2_SPP/Cargo.toml" ]]; then
  log "ERROR: could not materialize packages/vendor/spp/poseidon2"
  exit 1
fi

mkdir -p "$OUT_JNI"

# ── Pre-build resource checks ───────────────────────────────────
log "=== Pre-Build Resource Check ==="
available_mb=$(df "$OUT_JNI" 2>/dev/null | awk 'NR==2 {print int($4/1024)}' || echo "0")
log "Available disk space: ${available_mb}MB"
if [[ $available_mb -lt 2048 ]]; then
  log "WARNING: Less than 2GB available (Wasmer pool-ops may need 2-3GB)"
fi

if command -v free >/dev/null 2>&1; then
  mem_available_mb=$(free -m 2>/dev/null | awk 'NR==2 {print $7}' || echo "0")
  log "Available memory: ${mem_available_mb}MB"
  if [[ $mem_available_mb -lt 2048 ]]; then
    log "WARNING: Less than 2GB RAM available — build may fail with pool-ops"
  fi
fi

# ── Environment diagnostics ─────────────────────────────────────
log "=== Build Environment ==="
log "EAS_BUILD=${EAS_BUILD:-unset}"
log "EAS_BUILD_PLATFORM=${EAS_BUILD_PLATFORM:-unset}"
log "CI=${CI:-unset}"
log "PWD=$PWD"
log "APP_ROOT=$APP_ROOT"
log "REPO_ROOT=$REPO_ROOT"
log "SPP_NATIVE=$SPP_NATIVE"
log "OUT_JNI=$OUT_JNI"
debug "ANDROID_HOME=${ANDROID_HOME:-unset}"
debug "ANDROID_NDK_HOME=${ANDROID_NDK_HOME:-unset}"

# ── Rust toolchain ───────────────────────────────────────────────
if ! command -v rustup >/dev/null 2>&1; then
  log "Installing rustup (minimal profile)…"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal
fi
# shellcheck disable=SC1091
source "${CARGO_HOME:-$HOME/.cargo}/env"

log "Rust toolchain info:"
rustup --version
cargo --version
rustc --version

NDK_TARGET_ARGS=(-t arm64-v8a)
RUST_TARGETS=(aarch64-linux-android)
if [[ "${SPP_NATIVE_BUILD_ALL_ABIS:-}" == "1" ]]; then
  NDK_TARGET_ARGS+=(-t armeabi-v7a -t x86_64)
  RUST_TARGETS+=(armv7-linux-androideabi x86_64-linux-android)
fi

log "Adding Rust targets: ${RUST_TARGETS[*]}"
rustup target add "${RUST_TARGETS[@]}" || {
  error "Failed to add Rust targets"
  exit 1
}

log "Installing/verifying cargo-ndk…"
# Use --force to handle any broken installations
if ! cargo install cargo-ndk --locked --force 2>&1 | tee /tmp/cargo-ndk-install.log; then
  log "ERROR: cargo-ndk installation failed"
  tail -30 /tmp/cargo-ndk-install.log | sed 's/^/  /'
  exit 1
fi

# Verify it's actually callable
if ! cargo ndk --version >/dev/null 2>&1; then
  log "ERROR: cargo-ndk installed but not executable"
  log "Checking PATH and installation:"
  which cargo-ndk || true
  ls -la "${CARGO_HOME:-$HOME/.cargo}/bin/cargo-ndk" 2>/dev/null || log "  cargo-ndk binary not found"
  exit 1
fi
log "✓ cargo-ndk ready: $(cargo ndk --version)"

# ── NDK path for cargo-ndk ───────────────────────────────────────
resolve_ndk() {
  if [[ -n "${ANDROID_NDK_HOME:-}" && -d "$ANDROID_NDK_HOME" ]]; then
    echo "$ANDROID_NDK_HOME"
    return
  fi
  if [[ -n "${NDK_HOME:-}" && -d "$NDK_HOME" ]]; then
    echo "$NDK_HOME"
    return
  fi
  local base="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
  if [[ -n "$base" && -d "$base/ndk" ]]; then
    # Prefer highest versioned NDK under sdk/ndk/
    local latest
    latest="$(ls -1d "$base/ndk"/* 2>/dev/null | sort -V | tail -1 || true)"
    if [[ -n "$latest" && -d "$latest" ]]; then
      echo "$latest"
      return
    fi
  fi
  if [[ -n "$base" && -d "$base/ndk-bundle" ]]; then
    echo "$base/ndk-bundle"
    return
  fi
  return 1
}

if ! NDK_PATH="$(resolve_ndk)"; then
  log "ERROR: Android NDK not found. Set ANDROID_NDK_HOME or install NDK under ANDROID_HOME/ndk."
  log "  ANDROID_HOME=${ANDROID_HOME:-unset}"
  log "  ANDROID_NDK_HOME=${ANDROID_NDK_HOME:-unset}"
  log "Searching for NDK in standard locations…"
  log "  /opt/android/ndk: $(test -d /opt/android/ndk && echo "found" || echo "not found")"
  log "  ~/Android/ndk: $(test -d ~/Android/ndk && echo "found" || echo "not found")"
  exit 1
fi
export ANDROID_NDK_HOME="$NDK_PATH"
export ANDROID_NDK_ROOT="$NDK_PATH"
log "Using NDK: $ANDROID_NDK_HOME"
log "NDK version check:"
if [[ -f "$ANDROID_NDK_HOME/source.properties" ]]; then
  cat "$ANDROID_NDK_HOME/source.properties" | grep -E "Pkg\.|Version" | head -3 | sed 's/^/  /'
fi

# ── Verify Cargo.toml files exist ────────────────────────────────
log "Verifying Cargo files…"
for cargo_file in "$SPP_NATIVE/Cargo.toml" "$POSEIDON2_EAS/Cargo.toml" "$POSEIDON2_SPP/Cargo.toml"; do
  if [[ -f "$cargo_file" ]]; then
    log "  ✓ $cargo_file"
  else
    log "  ✗ MISSING: $cargo_file"
  fi
done

# ── Build release cdylib with JNI ────────────────────────────────
log "=== Starting cargo ndk build ==="
log "Features: android-jni${POOL_OPS_FEATURES}"
log "Targets: ${NDK_TARGET_ARGS[*]}"
log "Output: $OUT_JNI"

cd "$SPP_NATIVE"
log "Working directory: $(pwd)"

# Capture build output and errors
BUILD_LOG="/tmp/spp-cargo-build.log"
set +e
cargo ndk \
  "${NDK_TARGET_ARGS[@]}" \
  -o "$OUT_JNI" \
  -- build --release --features "android-jni${POOL_OPS_FEATURES}" 2>&1 | tee "$BUILD_LOG"
BUILD_EXIT=$?
set -e

if [[ $BUILD_EXIT -ne 0 ]]; then
  log "=== CARGO BUILD FAILED (exit code: $BUILD_EXIT) ==="
  log "Last 100 lines of build output:"
  tail -100 "$BUILD_LOG" | sed 's/^/  /'
  log ""
  log "=== System Resource Diagnostics ==="
  log "Disk usage:"
  df -h / | awk 'NR==2 {print "  Available: " $4 " / " $2 " (Used: " $3 ")"}' || true
  log "Memory usage:"
  if command -v free >/dev/null 2>&1; then
    free -h | head -2 | sed 's/^/  /'
  fi
  log ""
  log "=== Build Error Analysis ==="
  if grep -q "error: linker.*not found\|error.*cannot find\|error.*ld returned" "$BUILD_LOG"; then
    log "  ✗ LINKER ERROR: NDK toolchain or library path issue"
    log "    Likely: incorrect ANDROID_NDK_HOME or missing clang"
    log "    Check: $ANDROID_NDK_HOME/toolchains/llvm"
  fi
  if grep -q "error: could not compile\|error\[E" "$BUILD_LOG"; then
    log "  ✗ COMPILATION ERROR: Rust code error or missing dependency"
    log "    Extract: Last 20 lines above show compiler error"
  fi
  if grep -q "fatal: repository not found\|fatal.*Could not read\|fatal.*git" "$BUILD_LOG"; then
    log "  ✗ GIT FETCH ERROR: Cannot fetch SPP vendor source"
    log "    Check: git connectivity to $SPP_VENDOR_REPO"
    log "    Commit: $SPP_VENDOR_COMMIT"
  fi
  if grep -q "error: out of memory\|Killed\|signal 9" "$BUILD_LOG"; then
    log "  ✗ OUT OF MEMORY: EAS builder ran out of RAM during compilation"
    log "    Solution: Disable parallel build or request larger instance"
  fi
  if grep -q "error: invalid argument\|Unrecognized option\|Unknown option" "$BUILD_LOG"; then
    log "  ✗ CARGO/NDK CONFIGURATION ERROR: Invalid build argument"
    log "    Check: cargo-ndk version compatibility"
  fi
  if [[ -n "${POOL_OPS_FEATURES:-}" ]] && grep -q "error.*pool\|error.*wasmer\|error.*wasm" "$BUILD_LOG"; then
    log "  ✗ POOL-OPS FEATURE ERROR: Wasmer/WASM compilation failed"
    log "    Features: android-jni${POOL_OPS_FEATURES}"
    log "    Check: packages/vendor/spp/sdk/pool source integrity"
    log "    Try: Disable SPP_NATIVE_POOL_OPS=1 for derive-only build"
  fi
  if grep -q "error: expected.*found" "$BUILD_LOG"; then
    log "  ✗ DEPENDENCY RESOLUTION ERROR: Cargo.toml or feature mismatch"
    log "    Verify: Poseidon2 path at $POSEIDON2_SPP"
    log "    Verify: SPP vendor commit $SPP_VENDOR_COMMIT is correct"
  fi
  log ""
  log "Full build log saved to: $BUILD_LOG"
  log ""
  log "Next steps:"
  log "  1. If linker error: verify ANDROID_NDK_HOME and NDK version"
  log "  2. If out of memory: request larger EAS builder"
  log "  3. If pool-ops error: test with SPP_NATIVE_POOL_OPS=0 first"
  log "  4. Share $BUILD_LOG with maintainers for further debugging"
  exit 1
fi

log "=== Cargo build succeeded ==="
log "Artifacts:"
find "$OUT_JNI" -name 'libspp_native.so' -print | while read -r f; do
  ls -lh "$f"
done

count="$(find "$OUT_JNI" -name 'libspp_native.so' | wc -l | tr -d ' ')"
if [[ "$count" -lt 1 ]]; then
  log "ERROR: no libspp_native.so produced after successful build"
  log "JNI directory contents:"
  find "$OUT_JNI" -type f | sed 's/^/  /'
  exit 1
fi

log "OK — $count ABI(s). Device hub should show version 0.1.0 (Rust) + aspLeaf: true."
