#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "O PentaMark precisa do Node.js instalado: https://nodejs.org/"
  exit 1
fi

if [ ! -f "local-dist/index.html" ]; then
  echo "Preparando o PentaMark pela primeira vez..."
  npm install
  npm run local:build
fi

node local/server.mjs
