#!/usr/bin/env bash
set -euo pipefail

HTPASSWD_DIR="$(cd "$(dirname "$0")/../nginx" && pwd)"
HTPASSWD_FILE="$HTPASSWD_DIR/.htpasswd"

if [ $# -lt 2 ]; then
	echo "Uso: $0 <usuario> <password>"
	echo ""
	echo "Genera $HTPASSWD_FILE con las credenciales especificadas."
	echo ""
	echo "Advertencia: si el archivo ya existe, será sobrescrito."
	exit 1
fi

if [ -f "$HTPASSWD_FILE" ]; then
	echo "⚠️  Sobrescribiendo $HTPASSWD_FILE (ctrl+c para cancelar)..."
	sleep 2
fi

if command -v htpasswd &>/dev/null; then
	htpasswd -cb "$HTPASSWD_FILE" "$1" "$2"
	echo "✅ $HTPASSWD_FILE generado con usuario '$1'"
elif command -v openssl &>/dev/null; then
	HASH="$(openssl passwd -apr1 "$2")"
	echo "$1:$HASH" >"$HTPASSWD_FILE"
	echo "✅ $HTPASSWD_FILE generado con usuario '$1' (método: openssl)"
else
	echo "❌ Necesitas htpasswd (apache2-utils) u openssl"
	exit 1
fi
