#!/usr/bin/env bash
#
# Wrapper reproduzível do Graphify — LiciGov Pro.
#
# Garante a versão EXATA fixada (tools/graphify/requirements.txt) num venv isolado e executa a
# CLI `graphify`. NÃO depende de instalação global. Idempotente: cria/atualiza o venv só quando
# necessário. Uso: tools/graphify/run.sh update .   (ou qualquer subcomando do graphify)
#
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$DIR/../.." && pwd)"
REQ="$DIR/requirements.txt"
VENV="${GRAPHIFY_VENV:-$REPO/.venv-graphify}"
PIN="$(grep -oE 'graphifyy==[0-9.]+' "$REQ" | head -1)"   # ex.: graphifyy==0.9.32
WANT_VERSION="${PIN#graphifyy==}"

if [ -z "$WANT_VERSION" ]; then
  echo "[graphify] versão não fixada em $REQ" >&2
  exit 1
fi

need_install=0
if [ ! -x "$VENV/bin/graphify" ]; then
  need_install=1
else
  have="$("$VENV/bin/python" -m pip show graphifyy 2>/dev/null | awk -F': ' '/^Version:/{print $2}')"
  [ "$have" = "$WANT_VERSION" ] || need_install=1
fi

if [ "$need_install" -eq 1 ]; then
  echo "[graphify] preparando venv isolado com graphifyy==$WANT_VERSION…" >&2
  python3 -m venv "$VENV"
  "$VENV/bin/python" -m pip install --quiet --upgrade pip
  "$VENV/bin/python" -m pip install --quiet -r "$REQ"
fi

exec "$VENV/bin/graphify" "$@"
