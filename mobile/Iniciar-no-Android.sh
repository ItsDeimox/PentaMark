#!/data/data/com.termux/files/usr/bin/bash
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PENTAMARK_MOBILE_DATA="${PENTAMARK_DATA_DIR:-$HOME/.pentamark}"

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "O Node.js ainda não está instalado. Rode:"
  echo "  pkg update && pkg install nodejs"
  echo
  exit 1
fi

if [ -d "$HOME/storage/shared" ]; then
  PENTAMARK_MOBILE_VAULT="${PENTAMARK_VAULT_DIR:-$HOME/storage/shared/PentaMark}"
else
  PENTAMARK_MOBILE_VAULT="${PENTAMARK_VAULT_DIR:-$PENTAMARK_MOBILE_DATA/vault}"
  echo "Dica: rode termux-setup-storage para salvar o cofre no armazenamento compartilhado."
fi

mkdir -p "$PENTAMARK_MOBILE_DATA" "$PENTAMARK_MOBILE_VAULT"
export PENTAMARK_DATA_DIR="$PENTAMARK_MOBILE_DATA"
export PENTAMARK_VAULT_DIR="$PENTAMARK_MOBILE_VAULT"
export PENTAMARK_NO_BROWSER=1

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock || true
fi

echo
echo "Cofre: $PENTAMARK_MOBILE_VAULT"
echo "Abra no celular: http://localhost:3417"
echo
exec node "$SCRIPT_DIR/local/server.mjs"
