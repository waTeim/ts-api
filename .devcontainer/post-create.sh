#!/usr/bin/env bash
set -euo pipefail

# Ensure scripts are executable if the repo was cloned on Windows, etc.
chmod +x .devcontainer/scripts/*.sh || true

# Fix npm cache ownership (prevents EACCES errors).
sudo mkdir -p /home/vscode/.npm
sudo chown -R vscode:vscode /home/vscode/.npm

# Install nvm (so we can easily switch to older Node if needed)
if ! command -v nvm >/dev/null 2>&1; then
  export NVM_DIR="/home/vscode/.nvm"
  mkdir -p "$NVM_DIR"
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
fi

# Load nvm in this shell
export NVM_DIR="/home/vscode/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Pre-install an older Node just in case legacy deps need it (adjust as needed)
nvm install 16
nvm alias default 22 || true

# Basic project bootstrap
if [ -f package-lock.json ]; then
  npm ci || npm install
elif [ -f package.json ]; then
  npm install
fi

# Build (best-effort)
if jq -e '.scripts.build' package.json >/dev/null 2>&1; then
  npm run build || true
fi

echo "post-create complete. You can try: nvm use 16  # if the build needs an older Node"
