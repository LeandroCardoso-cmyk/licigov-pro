#!/usr/bin/env bash
# Seleção FAIL-CLOSED do ambiente de banco (produção × staging) para os workflows operacionais
# (db-backup.yml, schema-audit.yml). Testado em server/__tests__/unit/db-target-select.test.ts.
#
# SEC-AUD-2026-10 — por que existe: os secrets dos workflows são do repositório (sem GitHub Environment) e o
# backup agendado aponta para PRODUÇÃO. Ensaiar em staging trocando BACKUP_DATABASE_URL/AUDIT_DATABASE_URL
# deixaria o agendamento de produção apontado para staging (ou o inverso). Aqui cada ambiente tem secrets
# com NOME próprio e não existe fallback entre eles:
#   - produção: BACKUP_DATABASE_URL, BACKUP_ENCRYPTION_KEY, BACKUP_DB_SSL_CA, AUDIT_DATABASE_URL,
#               AUDIT_DB_SSL_CA, RESTORE_TARGET_URL  (nomes atuais, valores intactos);
#   - staging:  STAGING_<mesmo nome>.
# O workflow entrega os candidatos como PRODUCTION_<nome> e STAGING_<nome>; este script escolhe UM conjunto,
# exporta-o com o nome canônico (<nome>), apaga os demais candidatos e só então executa o comando.
#
# Regras (qualquer violação ⇒ exit 1 ANTES de conectar; nenhum valor é impresso):
#   1. evento `schedule` ⇒ sempre produção (um input diferente é erro);
#   2. `workflow_dispatch` ⇒ DB_TARGET_INPUT obrigatório e exatamente `production` ou `staging`;
#   3. qualquer outro evento ou execução fora do Actions ⇒ erro;
#   4. secrets obrigatórios do alvo ausentes ⇒ erro (staging NUNCA cai para o secret de produção);
#   5. staging no mesmo host:porta de produção, ou com a mesma chave de cifra ⇒ erro;
#   6. drill: destino ≠ origem (host:porta), destino ≠ banco do outro ambiente e nome do banco de destino
#      identificado como descartável (`licigov_restore_drill*`).
#
# Uso: bash scripts/ops/select-db-target.sh <backup|audit|drill> -- <comando> [args…]
# Saída não sensível: GITHUB_OUTPUT ← target=<production|staging>; variável DB_TARGET no comando.
set -Eeuo pipefail

fail() { echo "❌ $*" >&2; exit 1; }

# mysql://user:senha@host[:porta]/banco[?…] → "host:porta" (minúsculo) e banco. Usa o ÚLTIMO '@'.
endpoint_of() {
  local rest="${1##*@}" hostport host port
  hostport="${rest%%/*}"; host="${hostport%%:*}"; port="3306"
  [ "$hostport" = "$host" ] || port="${hostport#*:}"
  printf '%s:%s' "$(printf '%s' "$host" | tr '[:upper:]' '[:lower:]')" "$port"
}
database_of() {
  local rest="${1##*@}" db
  db="${rest#*/}"; db="${db%%\?*}"
  [ "$db" != "$rest" ] || db=""
  printf '%s' "$db"
}

KIND="${1:-}"; shift || true
[ "${1:-}" = "--" ] || fail "Uso: select-db-target.sh <backup|audit|drill> -- <comando>"
shift
[ "$#" -gt 0 ] || fail "Comando ausente."

case "$KIND" in
  backup) REQUIRED=(BACKUP_DATABASE_URL BACKUP_ENCRYPTION_KEY); OPTIONAL=(BACKUP_DB_SSL_CA) ;;
  audit)  REQUIRED=(AUDIT_DATABASE_URL AUDIT_DB_SSL_CA); OPTIONAL=() ;;
  drill)  REQUIRED=(BACKUP_DATABASE_URL BACKUP_ENCRYPTION_KEY RESTORE_TARGET_URL); OPTIONAL=() ;;
  *) fail "Tipo desconhecido: '$KIND' (esperado backup|audit|drill)." ;;
esac

EVENT="${GITHUB_EVENT_NAME:-}"
INPUT="${DB_TARGET_INPUT:-}"
case "$EVENT" in
  schedule)
    [ -z "$INPUT" ] || [ "$INPUT" = "production" ] || fail "Execução agendada é sempre produção (input '$INPUT' recusado)."
    TARGET="production" ;;
  workflow_dispatch)
    case "$INPUT" in
      production|staging) TARGET="$INPUT" ;;
      *) fail "Informe o ambiente (input target = production | staging); valor ausente ou ambíguo." ;;
    esac ;;
  *) fail "Evento '${EVENT:-<nenhum>}' não suportado (só schedule e workflow_dispatch)." ;;
esac

if [ "$TARGET" = "staging" ]; then
  # Staging sem CA não tem legado a preservar: exige VERIFY_CA desde o primeiro run.
  [ "$KIND" != "backup" ] || REQUIRED+=(BACKUP_DB_SSL_CA)
  OPTIONAL=()
fi
PREFIX="$(printf '%s' "$TARGET" | tr '[:lower:]' '[:upper:]')_"
OTHER_PREFIX="PRODUCTION_"; [ "$TARGET" = "production" ] && OTHER_PREFIX="STAGING_"

declare -A CHOSEN=()
for name in "${REQUIRED[@]}"; do
  src="${PREFIX}${name}"
  [ -n "${!src:-}" ] || fail "Secret obrigatório ausente para ${TARGET}: ${PREFIX#PRODUCTION_}${name} (sem fallback para outro ambiente)."
  CHOSEN[$name]="${!src}"
done
for name in "${OPTIONAL[@]}"; do
  src="${PREFIX}${name}"
  CHOSEN[$name]="${!src:-}"
done

# Guardas de separação entre ambientes (comparação local; nada é impresso).
if [ "$TARGET" = "staging" ]; then
  for name in BACKUP_DATABASE_URL AUDIT_DATABASE_URL; do
    [ -n "${CHOSEN[$name]:-}" ] || continue
    prod="PRODUCTION_${name}"
    if [ -n "${!prod:-}" ] && [ "$(endpoint_of "${CHOSEN[$name]}")" = "$(endpoint_of "${!prod}")" ]; then
      fail "STAGING_${name} aponta para o mesmo host:porta de produção — recusado."
    fi
  done
  if [ -n "${CHOSEN[BACKUP_ENCRYPTION_KEY]:-}" ] && [ -n "${PRODUCTION_BACKUP_ENCRYPTION_KEY:-}" ] \
     && [ "${CHOSEN[BACKUP_ENCRYPTION_KEY]}" = "${PRODUCTION_BACKUP_ENCRYPTION_KEY}" ]; then
    fail "STAGING_BACKUP_ENCRYPTION_KEY igual à chave de produção — use uma chave própria de staging."
  fi
fi

if [ "$KIND" = "drill" ]; then
  tgt="${CHOSEN[RESTORE_TARGET_URL]}"
  [ "$(endpoint_of "$tgt")" != "$(endpoint_of "${CHOSEN[BACKUP_DATABASE_URL]}")" ] \
    || fail "Destino do drill no mesmo host:porta da origem — recusado."
  other="${OTHER_PREFIX}BACKUP_DATABASE_URL"
  if [ -n "${!other:-}" ] && [ "$(endpoint_of "$tgt")" = "$(endpoint_of "${!other}")" ]; then
    fail "Destino do drill no mesmo host:porta do banco do outro ambiente — recusado."
  fi
  case "$(database_of "$tgt")" in
    licigov_restore_drill|licigov_restore_drill_*) : ;;
    *) fail "Destino do drill não identificado como descartável: o banco precisa se chamar licigov_restore_drill[_sufixo]." ;;
  esac
fi

# Remove TODOS os candidatos (dos dois ambientes) antes de executar o comando.
for v in $(compgen -e); do
  case "$v" in PRODUCTION_*|STAGING_*) unset "$v" ;; esac
done
unset DB_TARGET_INPUT
for name in "${!CHOSEN[@]}"; do
  export "$name=${CHOSEN[$name]}"
done
export DB_TARGET="$TARGET"
[ -z "${GITHUB_OUTPUT:-}" ] || echo "target=$TARGET" >> "$GITHUB_OUTPUT"
echo "🎯 Alvo: ${TARGET} (evento ${EVENT}; tipo ${KIND})." >&2
exec "$@"
