#!/bin/zsh
set -euo pipefail
cd "$(dirname "$0")"
source ./worker.env
NODE_BIN="/Users/masakiikeda/Desktop/moltbot-setup/.node-install/node-v22.22.0-darwin-arm64/bin/node"
export PATH="/Users/masakiikeda/Desktop/moltbot-setup/.node-install/node-v22.22.0-darwin-arm64/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
exec "$NODE_BIN" dist/worker.js
