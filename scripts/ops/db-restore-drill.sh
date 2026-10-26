#!/usr/bin/env bash
# DRILL de restauração REAL (usado por .github/workflows/db-backup.yml, job restore-drill; antes inline no YAML).
# Executar SEMPRE via scripts/ops/select-db-target.sh drill -- …, que escolhe o ambiente (DB_TARGET), exige
# destino ≠ origem e ≠ banco do outro ambiente, e banco de destino nomeado licigov_restore_drill[_sufixo].
#
# Entrada (env): DB_TARGET, BACKUP_DATABASE_URL (origem, só comparação), RESTORE_TARGET_URL (destino),
# BACKUP_ENCRYPTION_KEY. Diretório corrente = onde o artifact cifrado foi baixado.
# Invariantes: destino acessível e VAZIO; dump cifrado + checksum conferido antes de decifrar; nada de
# host/URL/secret/registro no log (só contagens); arquivos decifrados removidos também em FALHA (trap);
# o banco de destino NÃO é dropado (descarte do projeto/instância é do operador, ver CONTAINMENT_CHECKLIST.md).
set -Eeuo pipefail
umask 077

case "${DB_TARGET:-}" in
  production|staging) : ;;
  *) echo "❌ DB_TARGET ausente ou inválido — execute via scripts/ops/select-db-target.sh."; exit 1 ;;
esac
SRC_URL="${BACKUP_DATABASE_URL:-}"
TGT_URL="${RESTORE_TARGET_URL:-}"
ENC_KEY="${BACKUP_ENCRYPTION_KEY:-}"
unset BACKUP_DATABASE_URL RESTORE_TARGET_URL
export ENC_KEY
unset BACKUP_ENCRYPTION_KEY

# Limpeza também em falha: nenhum dump (decifrado ou não) sobra no runner.
trap 'rm -f dump.sql.gz *.sql *.sql.gz.enc *.sql.gz.enc.sha256 2>/dev/null || true' EXIT

START=$SECONDS

# 0) Secrets obrigatórios presentes.
[ -n "${SRC_URL:-}" ] || { echo "❌ BACKUP_DATABASE_URL ausente."; exit 1; }
[ -n "${TGT_URL:-}" ] || { echo "❌ RESTORE_TARGET_URL ausente (destino obrigatório)."; exit 1; }
[ -n "${ENC_KEY:-}" ] || { echo "❌ BACKUP_ENCRYPTION_KEY ausente (drill exige backup cifrado)."; exit 1; }

# Parser via URL nativa do Node (robusto a porta ausente, caracteres especiais e '@' na
# senha percent-encoded). Emite ${P}_{USER,PASS,HOST,PORT,DB}_B64 (base64, seguro para
# eval e sem vazar nada no log); os valores são decodificados em seguida.
parse() { # $1=url ; $2=prefixo → define ${2}_USER/_PASS/_HOST/_PORT/_DB
  local kv
  kv=$(THE_URL="$1" P="$2" node -e '
    const raw = process.env.THE_URL.trim();
    const p = process.env.P;
    const b = s => Buffer.from(String(s == null ? "" : s)).toString("base64");
    const emit = (k, v) => console.log(p + "_" + k + "_B64=" + b(v));
    // Regex tolerante (NÃO usar new URL(): ela trunca a autoridade no 1º "/" da senha,
    // devolvendo o usuário como host). A senha ([\s\S]*) é gulosa e faz backtracking até
    // o último "@", então aceita "/", "@", ":", "#" literais. Senha usada LITERAL (sem
    // decode) — idêntico ao job de backup, que conecta com sucesso na mesma URL.
    const m = raw.match(/^[a-zA-Z][\w+.-]*:\/\/(?:([^:@\/]+)(?::([\s\S]*))?@)?([^:\/?#@]+)(?::(\d+))?(?:\/([^?#]*))?/);
    if (!m) { process.stderr.write("parse-failed"); process.exit(2); }
    emit("USER", m[1] || "");
    emit("PASS", m[2] || "");
    emit("HOST", m[3] || "");
    emit("PORT", m[4] || "3306");
    emit("DB", (m[5] || "").split("?")[0]);
  ') || { echo "❌ Falha ao parsear a URL de conexão (formato inválido)."; exit 1; }
  eval "$kv"
  local k
  for k in USER PASS HOST PORT DB; do
    eval "${2}_${k}=\$(printf %s \"\$${2}_${k}_B64\" | base64 -d)"
  done
}
parse "$SRC_URL" SRC
parse "$TGT_URL" TGT

# INVARIANTE: RESTORE_TARGET_URL bem-formada. O sintoma "host = usuário" (ex.: 'root')
# ocorre quando falta o segmento @host. Checagem sem expor o valor do secret.
case "$TGT_URL" in
  *@*) : ;;
  *) echo "❌ RESTORE_TARGET_URL malformada: não contém '@' (falta o segmento @host)."
     echo "   Formato esperado: mysql://usuario:senha@HOST:PORTA/banco (endpoint PÚBLICO do banco descartável)."
     exit 1;;
esac
# Host VAZIO (ex.: "@:porta" ou "@/banco"): o trecho após o ÚLTIMO '@' começa com ':' , '/',
# '?' ou '#' (ou está vazio). Robusto a '@' na senha (usa o último '@'). Sem expor valor.
TGT_AFTER_AT="${TGT_URL##*@}"
case "$TGT_AFTER_AT" in
  ""|:*|/*|"?"*|"#"*)
    echo "❌ RESTORE_TARGET_URL com hostname VAZIO (padrão '@:porta' ou '@/banco')."
    echo "   O host entre '@' e ':porta' está ausente — provavelmente a variável de host do Railway não foi resolvida na URL."
    echo "   Use o MYSQL_PUBLIC_URL completo: mysql://usuario:senha@HOST.proxy.rlwy.net:PORTA/banco."
    exit 1;;
esac
if [ -n "${TGT_USER:-}" ] && [ "$TGT_HOST" = "$TGT_USER" ]; then
  echo "❌ RESTORE_TARGET_URL malformada: o host resolveu para o próprio usuário (segmento @host ausente/incorreto)."
  echo "   Formato esperado: mysql://usuario:senha@HOST:PORTA/banco (endpoint PÚBLICO do banco descartável)."
  exit 1
fi

# INVARIANTE: destino precisa ter host público (nunca socket/localhost). Se vazio/localhost,
# é problema da RESTORE_TARGET_URL (não do drill) — falha com mensagem acionável, sem expor valor.
case "${TGT_HOST:-}" in
  ""|localhost|127.0.0.1|::1|"::"|0.0.0.0)
    echo "❌ RESTORE_TARGET_URL sem host público (vazio/localhost) — informe o endpoint público do banco descartável."; exit 1;;
esac

# 1) INVARIANTE: origem != destino (nunca restaurar sobre a origem).
if [ "$SRC_HOST" = "$TGT_HOST" ] && [ "$SRC_DB" = "$TGT_DB" ]; then
  echo "❌ Origem e destino coincidem (mesmo host+banco) — abortando o drill."; exit 1
fi
if [ "$SRC_HOST" = "$TGT_HOST" ] && [ "$SRC_PORT" = "$TGT_PORT" ] && [ "$SRC_DB" = "$TGT_DB" ]; then
  echo "❌ Origem e destino idênticos — abortando."; exit 1
fi
echo "✅ Origem e destino são distintos."

# --protocol=TCP força TCP (evita fallback para socket local mesmo que o host seja "localhost").
TGT() { MYSQL_PWD="$TGT_PASS" mysql --protocol=TCP --host="$TGT_HOST" --port="$TGT_PORT" --user="$TGT_USER" "$@"; }

# 2) Destino ACESSÍVEL.
TGT -N -e "SELECT 1;" >/dev/null || { echo "❌ Destino inacessível."; exit 1; }
echo "✅ Destino acessível."

# 3) Destino VAZIO (prod/staging teriam tabelas → salvaguarda contra alvo errado).
PRE=$(TGT -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$TGT_DB';")
if [ "$PRE" -ne 0 ]; then
  echo "❌ Destino NÃO está vazio (${PRE} tabelas) — recusando para não sobrescrever um banco real."; exit 1
fi
echo "✅ Destino vazio (0 tabelas) — descartável confirmado."

# 4) Artefato precisa estar CIFRADO (.enc) e com checksum íntegro.
ENC=$(ls -1 *.sql.gz.enc 2>/dev/null | head -n1 || true)
[ -n "$ENC" ] || { echo "❌ Nenhum dump cifrado (.enc) no artifact — drill exige backup cifrado."; exit 1; }
if ls -1 *.sql.gz 2>/dev/null | grep -qv '\.enc$'; then
  echo "❌ Há dump NÃO cifrado no artifact — abortando (política: apenas cifrado)."; exit 1
fi
sha256sum -c "${ENC}.sha256"
echo "✅ Checksum SHA-256 íntegro."
CHK=$(cut -d' ' -f1 "${ENC}.sha256")

# 5) Decifrar (AES-256-CBC/PBKDF2) → restaurar SOMENTE no destino, em stream (o dump em claro não toca o disco).
openssl enc -d -aes-256-cbc -pbkdf2 -salt -in "$ENC" -pass env:ENC_KEY | gunzip -c | TGT "$TGT_DB"
echo "✅ Restauração concluída no destino descartável."

# 6) Validações (só contagens/aggregates — nada de registros/e-mails/conteúdo).
TABLES=$(TGT -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$TGT_DB';")
echo "Tabelas restauradas: $TABLES"
[ "$TABLES" -gt 0 ] || { echo "❌ Nenhuma tabela após restore."; exit 1; }

# 6a) migrations aplicadas (journal do Drizzle).
MIG=$(TGT -N -e "SELECT COUNT(*) FROM \`$TGT_DB\`.\`__drizzle_migrations\`;" 2>/dev/null || echo "ERR")
[ "$MIG" != "ERR" ] || { echo "❌ Tabela __drizzle_migrations ausente (migrations não restauradas)."; exit 1; }
[ "$MIG" -ge 1 ] || { echo "❌ Journal de migrations vazio."; exit 1; }
echo "✅ Migrations aplicadas (journal com $MIG registros)."

# 6b) tabelas essenciais existem e são legíveis (COUNT executa).
ESSENTIAL="organizations users processes documents document_versions activity_logs official_documents"
for t in $ESSENTIAL; do
  TGT -N -e "SELECT 1 FROM information_schema.tables WHERE table_schema='$TGT_DB' AND table_name='$t';" | grep -q 1 \
    || { echo "❌ Tabela essencial ausente: $t"; exit 1; }
  C=$(TGT -N -e "SELECT COUNT(*) FROM \`$TGT_DB\`.\`$t\`;")
  echo "  - $t: $C linhas"
done
echo "✅ Tabelas essenciais presentes e legíveis."

# 6c) Isolamento multi-tenant + consistência mínima (aggregates; hard-fail só em corrupção clara).
ORGS=$(TGT -N -e "SELECT COUNT(*) FROM \`$TGT_DB\`.organizations;")
DOC_ORGS=$(TGT -N -e "SELECT COUNT(DISTINCT organizationId) FROM \`$TGT_DB\`.documents WHERE organizationId IS NOT NULL;")
ORPHANS=$(TGT -N -e "SELECT COUNT(*) FROM \`$TGT_DB\`.document_versions v LEFT JOIN \`$TGT_DB\`.documents d ON d.id=v.documentId WHERE d.id IS NULL;")
MISMATCH=$(TGT -N -e "SELECT COUNT(*) FROM \`$TGT_DB\`.document_versions v JOIN \`$TGT_DB\`.documents d ON d.id=v.documentId WHERE v.organizationId IS NOT NULL AND d.organizationId IS NOT NULL AND v.organizationId<>d.organizationId;")
echo "Organizações: $ORGS | orgs distintas em documents: $DOC_ORGS | versões órfãs: $ORPHANS | mismatch tenant versão↔doc: $MISMATCH"
[ "$ORPHANS" -eq 0 ] || { echo "❌ Consistência: há document_versions órfãs ($ORPHANS)."; exit 1; }
[ "$MISMATCH" -eq 0 ] || { echo "❌ Isolamento: version.organizationId difere do documento pai ($MISMATCH)."; exit 1; }
echo "✅ Isolamento multi-tenant e consistência mínima OK."

# 6d) Smoke funcional: join canônico processo/documento executa.
TGT -N -e "SELECT COUNT(*) FROM \`$TGT_DB\`.documents d JOIN \`$TGT_DB\`.document_versions v ON v.documentId=d.id;" >/dev/null
echo "✅ Smoke funcional (join documents↔document_versions) OK."

DUR=$((SECONDS - START))

# 7) Evidência SEGURA (sem dados/hosts/URLs/secrets) — só metadados agregados.
cat > restore-drill-evidence.md <<EOF
# Evidência — Drill de Restauração REAL (backup cifrado → destino descartável)

| Campo | Valor |
|---|---|
| Workflow / run | ${GITHUB_WORKFLOW:-local} #${GITHUB_RUN_NUMBER:-0} (id ${GITHUB_RUN_ID:-0}) |
| Data (UTC) | $(date -u +%Y-%m-%dT%H:%M:%SZ) |
| Ambiente | ${DB_TARGET} |
| Origem | backup cifrado de ${DB_TARGET} (somente leitura; não modificada) |
| Destino | banco descartável identificado (licigov_restore_drill*), isolado da origem e do outro ambiente; vazio antes do restore |
| Criptografia | AES-256-CBC / PBKDF2 (openssl) |
| Checksum SHA-256 (artifact) | ${CHK} |
| Duração do drill | ${DUR}s |
| Tabelas restauradas | ${TABLES} |
| Migrations (journal) | ${MIG} |
| Testes | destino vazio+acessível, origem≠destino, checksum, schema, migrations, tabelas essenciais, isolamento tenant, órfãs, smoke join |
| Isolamento | versões órfãs=${ORPHANS}, mismatch tenant=${MISMATCH} (ambos 0) |
| Resultado agregado | PASS |

> Nenhum registro, e-mail, host, URL ou secret é exposto nesta evidência.
EOF
echo "----- EVIDÊNCIA -----"; cat restore-drill-evidence.md

# 8) Cleanup: remover TODO arquivo decifrado/temporário do runner (mantém só a evidência).
rm -f dump.sql.gz *.sql.gz.enc *.sha256 *.sql 2>/dev/null || true
# `ls` sem correspondência sai com código 2; sob `set -euo pipefail` isso derrubaria o script
# (falso negativo — justamente porque o cleanup funcionou). O `|| true` neutraliza esse caso.
LEFT=$( { ls -1 *.sql.gz *.sql *.enc 2>/dev/null || true; } | wc -l | tr -d ' ')
[ "$LEFT" = "0" ] || { echo "❌ Restaram arquivos sensíveis no runner ($LEFT)."; exit 1; }
echo "✅ Cleanup: nenhum dump decifrado/cifrado remanescente no runner."
echo "ℹ️ O banco de destino NÃO foi dropado: o descarte da instância (com os dados restaurados) é do operador, logo após o drill."
