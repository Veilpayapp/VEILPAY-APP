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
POSEIDON2="$SPP_NATIVE/vendor/poseidon2"
OUT_JNI="$APP_ROOT/modules/spp-native/android/src/main/jniLibs"

if [[ ! -f "$SPP_NATIVE/Cargo.toml" ]]; then
  log "ERROR: packages/spp-native missing from EAS archive."
  log "  expected: $SPP_NATIVE/Cargo.toml"
  log "  Commit packages/spp-native (EAS git upload skips untracked files)."
  log "  Also commit apps/consumer-app/modules/spp-native for the Expo module."
  exit 1
fi

if [[ ! -f "$POSEIDON2/Cargo.toml" ]]; then
  log "ERROR: vendored poseidon2 missing (packages/spp-native/vendor/poseidon2)."
  log "  expected: $POSEIDON2/Cargo.toml"
  exit 1
fi

mkdir -p "$OUT_JNI"

# ── Rust toolchain ───────────────────────────────────────────────
if ! command -v rustup >/dev/null 2>&1; then
  log "Installing rustup (minimal profile)…"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal
fi
# shellcheck disable=SC1091
source "${CARGO_HOME:-$HOME/.cargo}/env"

rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android

if ! command -v cargo-ndk >/dev/null 2>&1; then
  log "Installing cargo-ndk…"
  cargo install cargo-ndk --locked 2>/dev/null || cargo install cargo-ndk
fi

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
  exit 1
fi
export ANDROID_NDK_HOME="$NDK_PATH"
export ANDROID_NDK_ROOT="$NDK_PATH"
log "Using NDK: $ANDROID_NDK_HOME"

# ── Build release cdylib with JNI ────────────────────────────────
log "Building libspp_native.so → $OUT_JNI"
cd "$SPP_NATIVE"
cargo ndk \
  -t arm64-v8a \
  -t armeabi-v7a \
  -t x86_64 \
  -o "$OUT_JNI" \
  -- build --release --features android-jni

log "Artifacts:"
find "$OUT_JNI" -name 'libspp_native.so' -print | while read -r f; do
  ls -lh "$f"
done

count="$(find "$OUT_JNI" -name 'libspp_native.so' | wc -l | tr -d ' ')"
if [[ "$count" -lt 1 ]]; then
  log "ERROR: no libspp_native.so produced"
  exit 1
fi

log "OK — $count ABI(s). Device hub should show version 0.1.0 (Rust) + aspLeaf: true."
