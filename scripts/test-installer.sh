#!/usr/bin/env bash
set -euo pipefail

echo "🧪 Running anti-slop installer test harness..."

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# 1. Static analysis if shellcheck is present
if command -v shellcheck >/dev/null 2>&1; then
  echo "==> Running shellcheck on install.sh..."
  shellcheck install.sh
  echo "✔ shellcheck passed."
else
  echo "ℹ shellcheck not found, skipping static analysis."
fi

# 2. Ensure project is built
echo "==> Ensuring build artifacts are present..."
pnpm run build

TEST_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT

RELEASE_DIST="$TEST_DIR/release-dist"
INSTALL_ROOT="$TEST_DIR/install-root"
BIN_DIR="$TEST_DIR/bin"
mkdir -p "$RELEASE_DIST" "$INSTALL_ROOT" "$BIN_DIR"
# 3. Create mock release package using same exclusions as release.yml
echo "==> Packaging test release archive..."
tar --exclude='./.git' \
    --exclude='./node_modules' \
    --exclude='./e2e-fixtures' \
    --exclude='./reports' \
    --exclude='./coverage' \
    --exclude='./release-dist' \
    -czf "$RELEASE_DIST/anti-slop.tgz" .

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$RELEASE_DIST" && sha256sum anti-slop.tgz > checksums.txt)
elif command -v shasum >/dev/null 2>&1; then
  (cd "$RELEASE_DIST" && shasum -a 256 anti-slop.tgz > checksums.txt)
else
  echo "Error: Neither sha256sum nor shasum available" >&2
  exit 1
fi

# 4. Positive test: run install.sh pointing to local release directory
echo "==> Executing install.sh smoke test..."
ANTI_SLOP_BASE_DIR="$RELEASE_DIST" \
ANTI_SLOP_INSTALL_DIR="$INSTALL_ROOT" \
ANTI_SLOP_BIN_DIR="$BIN_DIR" \
bash install.sh --version test

INSTALLED_CLI="$BIN_DIR/anti-slop"
TARGET_APP_DIR="$INSTALL_ROOT/app"

echo "==> Verifying installation directory structure and artifacts..."
if [[ ! -x "$INSTALLED_CLI" ]]; then
  echo "❌ Error: Installed CLI binary $INSTALLED_CLI is not executable!" >&2
  exit 1
fi

if [[ ! -f "$TARGET_APP_DIR/dist/cli.js" ]]; then
  echo "❌ Error: Expected $TARGET_APP_DIR/dist/cli.js to exist after installation!" >&2
  exit 1
fi

if [[ ! -d "$TARGET_APP_DIR/node_modules" ]]; then
  echo "❌ Error: Expected $TARGET_APP_DIR/node_modules to exist after installation!" >&2
  exit 1
fi

if ! grep -q "$TARGET_APP_DIR/bin/anti-slop" "$INSTALLED_CLI"; then
  echo "❌ Error: Wrapper shim $INSTALLED_CLI does not target $TARGET_APP_DIR!" >&2
  exit 1
fi
echo "✔ Installation directory, compiled artifacts, dependencies, and wrapper verified."

echo "==> Verifying installed CLI runs in an isolated directory outside repository root..."
ISOLATED_RUN_DIR="$TEST_DIR/isolated-run"
mkdir -p "$ISOLATED_RUN_DIR"

CLI_VERSION="$(cd "$ISOLATED_RUN_DIR" && "$INSTALLED_CLI" --version)"
EXPECTED_VERSION="$(node -p 'JSON.parse(fs.readFileSync("package.json")).version')"
if [[ "$CLI_VERSION" != *"$EXPECTED_VERSION"* ]]; then
  echo "❌ Error: Installed CLI reported version '$CLI_VERSION', expected '$EXPECTED_VERSION'!" >&2
  exit 1
fi
echo "✔ Installed CLI executed --version successfully (reported $CLI_VERSION)."

(cd "$ISOLATED_RUN_DIR" && "$INSTALLED_CLI" --help >/dev/null)
echo "✔ Installed CLI executed --help successfully from clean isolated directory."
# 5. Negative test: tampered checksum verification
echo "==> Verifying installer fails on corrupted checksum..."
BAD_DIST="$TEST_DIR/bad-dist"
mkdir -p "$BAD_DIST"
cp "$RELEASE_DIST/anti-slop.tgz" "$BAD_DIST/anti-slop.tgz"
echo "0000000000000000000000000000000000000000000000000000000000000000  anti-slop.tgz" > "$BAD_DIST/checksums.txt"

if ANTI_SLOP_BASE_DIR="$BAD_DIST" \
   ANTI_SLOP_INSTALL_DIR="$TEST_DIR/bad-install" \
   ANTI_SLOP_BIN_DIR="$TEST_DIR/bad-bin" \
   bash install.sh --version test >/dev/null 2>&1; then
  echo "❌ Error: install.sh should have failed on checksum mismatch!" >&2
  exit 1
fi
echo "✔ Tampered checksum correctly caused install.sh to abort."

echo "🎉 All installer tests passed successfully!"
