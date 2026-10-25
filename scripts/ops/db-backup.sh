#!/usr/bin/env bash
# Backup lógico CIFRADO do MySQL (usado por .github/workflows/db-backup.yml; testado por
# server/__tests__/unit/db-backup-script.test.ts com binários sintéticos).
#
# SEC-AUD-2026-10 — invariantes:
#   1. Sem BACKUP_DATABASE_URL ou BACKUP_ENCRYPTION_KEY ⇒ falha ANTES de conectar ao banco.
#      Não existe mais modo "sem cifra".
#   2. O dump nunca toca o disco em claro: mysqldump | gzip | openssl enc ⇒ <arquivo>.sql.gz.enc.
#      Mesmo formato de antes (AES-256-CBC, PBKDF2, salt) ⇒ o drill de restauração e os backups
#      já retidos continuam compatíveis.
#   3. TLS obrigatório. Com BACKUP_DB_SSL_CA (PEM da CA do servidor) ⇒ VERIFY_CA (identidade
#      verificada); sem ela ⇒ REQUIRED (cifra o transporte, mas NÃO autentica o servidor — limitação
#      registrada no log). A sessão é conferida (Ssl_version) antes do dump.
#   4. Qualquer falha (dump, compressão, cifra, verificação, checksum) remove o que foi gerado: o
#      diretório de saída fica vazio e o upload (que só roda em sucesso) não tem o que publicar.
#   5. Nada de senha/chave/host/conteúdo no log: credenciais num arquivo de opções 0600 temporário;
#      só nome do banco, versões, tamanho e checksum são impressos.
#
# Entrada (env): BACKUP_DATABASE_URL, BACKUP_ENCRYPTION_KEY, [BACKUP_DB_SSL_CA], [BACKUP_OUT_DIR=.],
#                [GITHUB_ENV]. Saída: <out>/backup-<db>-<UTC>.sql.gz.enc + .sha256.
set -Eeuo pipefail
umask 077

OUT_DIR="${BACKUP_OUT_DIR:-.}"
WORK="$(mktemp -d)"
ARTIFACT=""
OK=0

cleanup() {
  rm -rf "$WORK"
  if [ "$OK" != "1" ] && [ -n "$ARTIFACT" ]; then
    rm -f "$ARTIFACT" "${ARTIFACT}.sha256"
  fi
}
trap cleanup EXIT

fail() { echo "❌ $*" >&2; exit 1; }

[ -n "${BACKUP_DATABASE_URL:-}" ] || fail "BACKUP_DATABASE_URL ausente."
[ -n "${BACKUP_ENCRYPTION_KEY:-}" ] || fail "BACKUP_ENCRYPTION_KEY ausente — backup sem cifra não é permitido."
[ -d "$OUT_DIR" ] || fail "Diretório de saída inexistente."

# mysql://usuario:senha@host[:porta]/banco[?params] — senha literal; usa o ÚLTIMO '@' (senha pode ter '@').
url="${BACKUP_DATABASE_URL#mysql://}"
[ "$url" != "$BACKUP_DATABASE_URL" ] || fail "BACKUP_DATABASE_URL deve começar com mysql://."
case "$url" in *@*) : ;; *) fail "BACKUP_DATABASE_URL sem credenciais (falta usuario:senha@)." ;; esac
creds="${url%@*}"
rest="${url##*@}"
DB_USER="${creds%%:*}"
DB_PASS=""
[ "$creds" = "$DB_USER" ] || DB_PASS="${creds#*:}"
hostport="${rest%%/*}"
DB_NAME="${rest#*/}"; DB_NAME="${DB_NAME%%\?*}"
[ "$DB_NAME" != "$rest" ] || DB_NAME=""
DB_HOST="${hostport%%:*}"
DB_PORT="3306"
[ "$hostport" = "$DB_HOST" ] || DB_PORT="${hostport#*:}"
[ -n "$DB_USER" ] && [ -n "$DB_HOST" ] && [ -n "$DB_NAME" ] || fail "BACKUP_DATABASE_URL incompleta (usuário, host e banco são obrigatórios)."
case "$DB_PORT" in ''|*[!0-9]*) fail "Porta inválida em BACKUP_DATABASE_URL." ;; esac
case "$DB_NAME" in *[!A-Za-z0-9_\$-]*) fail "Nome de banco com caracteres não suportados." ;; esac

# Arquivo de opções do cliente (fora da linha de comando e do ambiente dos processos filhos).
CNF="$WORK/client.cnf"
esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
{
  echo "[client]"
  echo "user=\"$(esc "$DB_USER")\""
  echo "password=\"$(esc "$DB_PASS")\""
  echo "host=\"$(esc "$DB_HOST")\""
  echo "port=$DB_PORT"
  echo "protocol=TCP"
  if [ -n "${BACKUP_DB_SSL_CA:-}" ]; then
    printf '%s\n' "$BACKUP_DB_SSL_CA" > "$WORK/server-ca.pem"
    echo "ssl-mode=VERIFY_CA"
    echo "ssl-ca=$WORK/server-ca.pem"
  else
    echo "ssl-mode=REQUIRED"
  fi
} > "$CNF"
chmod 600 "$CNF"
unset BACKUP_DATABASE_URL DB_PASS

if [ -n "${BACKUP_DB_SSL_CA:-}" ]; then
  echo "🔐 TLS: VERIFY_CA (certificado do servidor verificado contra a CA informada)."
else
  echo "🔐 TLS: REQUIRED — transporte cifrado; identidade do servidor NÃO verificada (defina BACKUP_DB_SSL_CA para VERIFY_CA)."
fi
echo "Cliente: $(mysqldump --version 2>/dev/null | head -n1 || echo 'versão indisponível')"

# Sessão TLS de fato negociada + versão do servidor (metadados não sensíveis), antes de qualquer dump.
SESSION="$(mysql --defaults-extra-file="$CNF" -N -B -e "SELECT VERSION(); SHOW SESSION STATUS LIKE 'Ssl_version'; SHOW SESSION STATUS LIKE 'Ssl_cipher';")" \
  || fail "Falha ao conectar com TLS obrigatório (não há fallback para texto puro)."
SERVER_VERSION="$(printf '%s\n' "$SESSION" | sed -n '1p')"
SSL_VERSION="$(printf '%s\n' "$SESSION" | awk -F'\t' '$1=="Ssl_version"{print $2}')"
SSL_CIPHER="$(printf '%s\n' "$SESSION" | awk -F'\t' '$1=="Ssl_cipher"{print $2}')"
[ -n "$SSL_VERSION" ] || fail "Sessão sem TLS (Ssl_version vazio) — abortando antes do dump."
echo "Servidor: ${SERVER_VERSION:-?} | TLS ${SSL_VERSION} (${SSL_CIPHER:-?})"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
ARTIFACT="${OUT_DIR%/}/backup-${DB_NAME}-${STAMP}.sql.gz.enc"
echo "Iniciando backup do banco \"$DB_NAME\"…"

# Stream: nenhum byte do dump em claro no disco. pipefail ⇒ falha de qualquer estágio derruba o script.
mysqldump --defaults-extra-file="$CNF" \
    --single-transaction --routines --triggers --events \
    --set-gtid-purged=OFF --no-tablespaces \
    "$DB_NAME" \
  | gzip -c \
  | openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_ENCRYPTION_KEY -out "$ARTIFACT" \
  || fail "Dump/compressão/cifra falhou — nada será publicado."

BYTES="$(stat -c%s "$ARTIFACT")"
[ "$BYTES" -ge 1024 ] || fail "Artefato suspeito (${BYTES} bytes) — abortando."

# Verificação: decifra em memória, valida o gzip e o marcador final do mysqldump (dump completo).
TAIL="$(openssl enc -d -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_ENCRYPTION_KEY -in "$ARTIFACT" | gzip -dc | tail -c 512)" \
  || fail "Artefato não decifra/descomprime — abortando."
[[ "$TAIL" == *"-- Dump completed"* ]] || fail "Dump incompleto (sem marcador final do mysqldump)."

( cd "$(dirname "$ARTIFACT")" && sha256sum "$(basename "$ARTIFACT")" > "$(basename "$ARTIFACT").sha256" ) \
  || fail "Falha ao gerar checksum."

OK=1
echo "🔒 Backup cifrado (AES-256-CBC/PBKDF2): $(basename "$ARTIFACT") (${BYTES} bytes)."
echo "   Checksum: $(cut -d' ' -f1 "${ARTIFACT}.sha256")"
if [ -n "${GITHUB_ENV:-}" ]; then
  echo "BACKUP_ARTIFACT=$ARTIFACT" >> "$GITHUB_ENV"
fi
