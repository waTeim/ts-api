#!/usr/bin/env bash
set -euo pipefail

# Load nvm for interactive terminals
{
  echo 'export NVM_DIR="$HOME/.nvm"'
  echo '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"'
} >> /home/vscode/.bashrc

# Helpful echo for first start
echo "Devcontainer started. Try:"
echo "  npm run build    # (if defined)"
echo "  npm test         # (if tests exist)"
echo "Debug: set breakpoints and use the Node Debugger (9229 exposed)"
