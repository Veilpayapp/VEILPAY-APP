#!/usr/bin/env bash
# Build libspp_native.so for Android ABIs → Expo module jniLibs.
# See build-android-ndk.ps1 for prerequisites.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_JNI="$(cd "$ROOT/../../apps/consumer-app/modules/spp-native/android/src/main" && pwd)/jniLibs"

echo "spp-native → $OUT_JNI"
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android || true

cd "$ROOT"
cargo ndk \
  -t arm64-v8a \
  -t armeabi-v7a \
  -t x86_64 \
  -o "$OUT_JNI" \
  -- build --release --features android-jni

echo "OK:"
find "$OUT_JNI" -name 'libspp_native.so' -print
