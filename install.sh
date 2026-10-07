#!/usr/bin/env bash
set -euo pipefail

REPO="${ANTI_SLOP_REPO:-KonstantinAxt/anti-slop}"
INSTALL_ROOT="${ANTI_SLOP_INSTALL_DIR:-$HOME/.anti-slop}"
BIN_DIR="${ANTI_SLOP_BIN_DIR:-$HOME/.local/bin}"
VERSION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version|-v)
      VERSION="$2"
      shift 2
      ;;
    --bin-dir)
      BIN_DIR="$2"
      shift 2
      ;;
    --install-dir)
      INSTALL_ROOT="$2"
      shift 2
      ;;
    -h|--help)
      echo "anti-slop installer"
      echo ""
      echo "Usage: curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | bash -s -- [options]"
      echo ""
      echo "Options:"
      echo "  -v, --version <ver>   Install specific version (e.g. 0.1.0 or v0.1.0)"
      echo "  --bin-dir <path>      Directory for anti-slop executable symlink (default: ~/.local/bin)"
      echo "  --install-dir <path>  Directory to unpack anti-slop app files (default: ~/.anti-slop)"
      echo "  -h, --help            Show this help text"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

echo "==> Installing anti-slop..."

# 1. Ensure Node.js or Bun runtime is available
RUN_CMD=""
if command -v node >/dev/null 2>&1; then
  RUN_CMD="node"
elif command -v bun >/dev/null 2>&1; then
  RUN_CMD="bun"
else
  echo "Error: Node.js (v20+) or Bun runtime is required to run anti-slop." >&2
  echo "Please install Node.js from https://nodejs.org or Bun from https://bun.sh" >&2
  exit 1
fi

# 2. Detect OS and architecture
OS="$(uname -s)"
case "$OS" in
  Linux|Darwin) ;;
  *)
    echo "Error: Unsupported operating system '$OS'. anti-slop supports Linux and macOS." >&2
    exit 1
    ;;
esac

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64|arm64|aarch64) ;;
  *)
    echo "Error: Unsupported architecture '$ARCH'." >&2
    exit 1
    ;;
esac

# 3. Fetch release assets (supporting local dir, custom URL, or GitHub release)
TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

if [[ -n "${ANTI_SLOP_BASE_DIR:-}" ]]; then
  echo "==> Using local asset directory $ANTI_SLOP_BASE_DIR..."
  cp "$ANTI_SLOP_BASE_DIR/anti-slop.tgz" "$TMP_DIR/anti-slop.tgz"
  cp "$ANTI_SLOP_BASE_DIR/checksums.txt" "$TMP_DIR/checksums.txt"
elif [[ -n "${ANTI_SLOP_BASE_URL:-}" ]]; then
  BASE_URL="${ANTI_SLOP_BASE_URL%/}"
  echo "==> Fetching release assets from $BASE_URL..."
  curl -fsSL "$BASE_URL/anti-slop.tgz" -o "$TMP_DIR/anti-slop.tgz"
  curl -fsSL "$BASE_URL/checksums.txt" -o "$TMP_DIR/checksums.txt"
else
  GITHUB_HOST="${GITHUB_HOST:-github.com}"
  if [[ -z "$VERSION" ]]; then
    BASE_URL="https://$GITHUB_HOST/$REPO/releases/latest/download"
  else
    # Strip leading 'v' if user passed v0.1.0
    CLEAN_VER="${VERSION#v}"
    BASE_URL="https://$GITHUB_HOST/$REPO/releases/download/v${CLEAN_VER}"
  fi
  echo "==> Fetching release assets from $BASE_URL..."
  curl -fsSL "$BASE_URL/anti-slop.tgz" -o "$TMP_DIR/anti-slop.tgz"
  curl -fsSL "$BASE_URL/checksums.txt" -o "$TMP_DIR/checksums.txt"
fi

# 4. Verify SHA-256 checksum
echo "==> Verifying SHA-256 checksum..."
EXPECTED_SHA="$(grep -F "anti-slop.tgz" "$TMP_DIR/checksums.txt" | awk '{print $1}')"
if [[ -z "$EXPECTED_SHA" ]]; then
  echo "Error: anti-slop.tgz not listed in checksums.txt" >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_SHA="$(sha256sum "$TMP_DIR/anti-slop.tgz" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  ACTUAL_SHA="$(shasum -a 256 "$TMP_DIR/anti-slop.tgz" | awk '{print $1}')"
else
  echo "Warning: Neither sha256sum nor shasum found; skipping checksum verification." >&2
  ACTUAL_SHA="$EXPECTED_SHA"
fi

if [[ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]]; then
  echo "Error: Checksum mismatch for anti-slop.tgz!" >&2
  echo "  Expected: $EXPECTED_SHA" >&2
  echo "  Got:      $ACTUAL_SHA" >&2
  exit 1
fi

# 5. Extract to target directory
TARGET_APP_DIR="$INSTALL_ROOT/app"
mkdir -p "$TARGET_APP_DIR" "$BIN_DIR"
rm -rf "${TARGET_APP_DIR:?}"/*

tar -xzf "$TMP_DIR/anti-slop.tgz" -C "$TARGET_APP_DIR"

# 6. Install production dependencies
echo "==> Installing production dependencies..."
if command -v pnpm >/dev/null 2>&1; then
  (cd "$TARGET_APP_DIR" && pnpm install --prod --frozen-lockfile)
elif command -v bun >/dev/null 2>&1; then
  (cd "$TARGET_APP_DIR" && bun install --production)
else
  (cd "$TARGET_APP_DIR" && npm install --omit=dev)
fi

# 7. Create wrapper executable shim
WRAPPER="$BIN_DIR/anti-slop"
cat <<EOF > "$WRAPPER"
#!/usr/bin/env bash
exec $RUN_CMD "$TARGET_APP_DIR/bin/anti-slop" "\$@"
EOF
chmod +x "$WRAPPER"

echo ""
echo "✔ anti-slop installed successfully to $WRAPPER"

# 8. Check if BIN_DIR is in PATH
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    echo ""
    echo "Notice: '$BIN_DIR' is not in your PATH."
    echo "Add it to your shell configuration file (e.g. ~/.bashrc or ~/.zshrc):"
    echo ""
    echo "  export PATH=\"$BIN_DIR:\$PATH\""
    echo ""
    ;;
esac
