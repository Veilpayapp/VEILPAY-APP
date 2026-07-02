#!/usr/bin/env bash
#
# EAS pre-install hook: inject secrets from Doppler into the build.
#
# This runs on EAS's cloud build servers BEFORE dependencies are installed and
# BEFORE Metro bundles the JS. It downloads all EXPO_PUBLIC_* vars from Doppler
# into a local `.env` file, which Expo CLI then loads into `process.env`.
#
# AUTHENTICATION:
#   A read-only Doppler Service Token must be stored as an EAS Secret named
#   `DOPPLER_TOKEN`. Create it once with:
#
#     eas secret:create --scope project --name DOPPLER_TOKEN --value <your-doppler-service-token>
#
#   The token should be scoped to the consumer-app Doppler project only, with
#   read access. It is NEVER bundled into the app binary — it only exists
#   during the build on EAS's servers.
#
# LOCAL BUILDS:
#   This hook is skipped when `DOPPLER_TOKEN` is unset (e.g. `eas build --local`
#   without the token). In that case, ensure a local `.env` exists, or run:
#
#     doppler run -- eas build --local --profile preview
#
set -euo pipefail

echo "[doppler-hook] Starting Doppler secret injection..."

if [ -z "${DOPPLER_TOKEN:-}" ]; then
  echo "[doppler-hook] WARNING: DOPPLER_TOKEN is not set."
  echo "[doppler-hook] Skipping Doppler download. Ensure .env exists locally."
  # Don't fail — allow local builds with a pre-existing .env.
  exit 0
fi

# Install the Doppler CLI on the EAS Linux build server.
# The official install script (cli.doppler.com/install.sh) uses dpkg/apt which
# requires root. EAS Build hooks do NOT run as root, so we download the
# standalone binary directly and place it on PATH in a user-writable directory.
if ! command -v doppler >/dev/null 2>&1; then
  echo "[doppler-hook] Installing Doppler CLI (standalone binary)..."
  DOPPLER_INSTALL_DIR="${HOME}/.local/bin"
  mkdir -p "$DOPPLER_INSTALL_DIR"

  # Detect architecture
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64)  DOPPLER_ARCH="amd64" ;;
    aarch64) DOPPLER_ARCH="arm64" ;;
    armv7l)  DOPPLER_ARCH="armv7" ;;
    *)
      echo "[doppler-hook] ERROR: Unsupported architecture: $ARCH"
      exit 1
      ;;
  esac

  DOPPLER_URL="https://github.com/DopplerHQ/cli/releases/latest/download/doppler_linux_${DOPPLER_ARCH}.tar.gz"
  echo "[doppler-hook] Downloading from $DOPPLER_URL"
  curl -fsSL "$DOPPLER_URL" -o /tmp/doppler.tar.gz
  tar -xzf /tmp/doppler.tar.gz -C /tmp doppler
  mv /tmp/doppler "$DOPPLER_INSTALL_DIR/doppler"
  chmod +x "$DOPPLER_INSTALL_DIR/doppler"
  rm -f /tmp/doppler.tar.gz

  # Ensure the install dir is on PATH for this script
  export PATH="$DOPPLER_INSTALL_DIR:$PATH"

  echo "[doppler-hook] Doppler CLI installed to $DOPPLER_INSTALL_DIR/doppler"
  doppler --version
else
  echo "[doppler-hook] Doppler CLI already installed."
fi

# Which Doppler project + config to pull from.
# Override via EAS env vars if you use a different project name.
DOPPLER_PROJECT="${DOPPLER_PROJECT:-veilpay}"
DOPPLER_CONFIG="${DOPPLER_CONFIG:-prd}"

ENV_FILE="./.env"
ENV_FILE_RAW="./.env.doppler.raw"

echo "[doppler-hook] Downloading secrets from Doppler (project: $DOPPLER_PROJECT, config: $DOPPLER_CONFIG)..."

# Download all secrets in .env format. The Doppler token authenticates.
# --format=env outputs KEY="value" per line (default is JSON, which Metro/dotenv can't parse).
# --no-file prints to stdout instead of writing a file.
doppler secrets download \
  --token="$DOPPLER_TOKEN" \
  --project="$DOPPLER_PROJECT" \
  --config="$DOPPLER_CONFIG" \
  --format=env \
  --no-file > "$ENV_FILE_RAW"

# Fail fast if the download produced nothing useful.
if [ ! -s "$ENV_FILE_RAW" ]; then
  echo "[doppler-hook] ERROR: Doppler download produced an empty .env."
  echo "[doppler-hook] Check that DOPPLER_TOKEN is valid and the project/config exist."
  exit 1
fi

# SECURITY: Filter to keep ONLY EXPO_PUBLIC_* vars + DOPPLER metadata.
# This strips backend secrets (JWT_SECRET, DATABASE_URL, REDIS_URL, etc.) so
# they never touch the frontend .env that Metro reads — defense in depth so a
# compromised build server or accidental process.env read can't leak them.
grep -E '^(EXPO_PUBLIC_|DOPPLER_)' "$ENV_FILE_RAW" > "$ENV_FILE" || true
rm -f "$ENV_FILE_RAW"

# Verify the critical vars are present — fail the build if any are missing.
REQUIRED_VARS=(
  "EXPO_PUBLIC_BACKEND_BASE_URL"
  "EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID"
)

MISSING=()
for VAR in "${REQUIRED_VARS[@]}"; do
  if ! grep -q "^${VAR}=" "$ENV_FILE" || grep -q "^${VAR}=\"\"\$" "$ENV_FILE"; then
    MISSING+=("$VAR")
  fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "[doppler-hook] ERROR: Required secrets missing from Doppler:"
  for m in "${MISSING[@]}"; do
    echo "  - $m"
  done
  echo "[doppler-hook] Add them to your Doppler project ($DOPPLER_PROJECT / $DOPPLER_CONFIG)."
  exit 1
fi

echo "[doppler-hook] Successfully injected secrets from Doppler into .env"
echo "[doppler-hook] Variables present (names only):"
# Print only the keys, never the values, for build-log safety.
sed -E 's/=.*//' "$ENV_FILE" | sort | sed 's/^/  - /'

exit 0
