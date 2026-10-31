#!/usr/bin/env bash
# Lint de NÃO-REGRESSÃO da CI (job quality de .github/workflows/ci.yml): eslint --max-warnings 0 só nos .ts/.tsx
# alterados em relação à base REAL da mudança. Testado em server/__tests__/unit/ci-lint-changed.test.ts.
#
# SEC-AUD-2026-10 — o passo anterior escondia falhas: `git fetch --depth=1 origin <base>` num clone completo
# marcava a ponta nova da base como shallow (sem pais); quando ela não era ancestral do head, deixava de existir
# merge-base, o `git diff` falhava ("no merge base") e `2>/dev/null` + `|| true` transformavam a falha em
# "nenhum arquivo alterado" — lint aprovado sem rodar o eslint. Aqui qualquer falha de seleção REPROVA:
#   - base inválida/ausente, fetch com erro, ref inexistente, repositório raso, sem merge-base ou diff com erro
#     ⇒ exit ≠ 0;
#   - diff vazio só aprova quando foi calculado com sucesso;
#   - nomes de arquivo lidos com -z e passados como argumentos (nunca reinterpretados pelo shell).
#
# Base por evento (valores chegam por variável de ambiente, nunca interpolados no script do workflow):
#   pull_request       → PR_BASE_REF (base real da PR);
#   workflow_dispatch  → DISPATCH_LINT_BASE (obrigatória; ex.: staging para a #317, o branch da #317 para a #319);
#   push               → PUSH_BEFORE (SHA anterior do push).
set -Eeuo pipefail

fail() { echo "❌ lint-changed: $*" >&2; exit 1; }

EVENT="${EVENT_NAME:-}"
case "$EVENT" in
  pull_request) BASE_KIND=branch; BASE="${PR_BASE_REF:-}" ;;
  workflow_dispatch) BASE_KIND=branch; BASE="${DISPATCH_LINT_BASE:-}" ;;
  push) BASE_KIND=sha; BASE="${PUSH_BEFORE:-}" ;;
  *) fail "evento '${EVENT:-<nenhum>}' sem regra de base." ;;
esac
[ -n "$BASE" ] || fail "base ausente para o evento ${EVENT} (informe a base explicitamente)."

[ "$(git rev-parse --is-shallow-repository)" = "false" ] \
  || fail "repositório raso: o checkout precisa de fetch-depth: 0 (merge-base indisponível)."

if [ "$BASE_KIND" = "branch" ]; then
  git check-ref-format --branch "$BASE" >/dev/null 2>&1 || fail "nome de branch base inválido."
  case "$BASE" in -*|*..*) fail "nome de branch base inválido." ;; esac
  # Histórico COMPLETO da base (nunca --depth): a merge-base precisa estar no grafo.
  git fetch --no-tags --quiet origin "+refs/heads/${BASE}:refs/remotes/origin/${BASE}" \
    || fail "falha ao buscar a base origin/${BASE}."
  BASE_SHA="$(git rev-parse --verify --quiet "refs/remotes/origin/${BASE}^{commit}")" \
    || fail "ref origin/${BASE} inexistente."
else
  [[ "$BASE" =~ ^[0-9a-f]{40}$ ]] && [ "$BASE" != "0000000000000000000000000000000000000000" ] \
    || fail "SHA anterior do push inválido."
  BASE_SHA="$(git rev-parse --verify --quiet "${BASE}^{commit}")" || fail "commit base ${BASE} ausente do histórico."
fi

HEAD_SHA="$(git rev-parse --verify HEAD)"
MERGE_BASE="$(git merge-base "$BASE_SHA" "$HEAD_SHA")" || fail "sem merge-base entre a base e o head."

LIST="$(mktemp)"
trap 'rm -f "$LIST"' EXIT
git diff -z --name-only --diff-filter=ACMR "$MERGE_BASE" "$HEAD_SHA" -- '*.ts' '*.tsx' > "$LIST" \
  || fail "git diff falhou."
FILES=()
while IFS= read -r -d '' f; do FILES+=("./$f"); done < "$LIST"

echo "base: ${BASE} (${BASE_SHA}) | head: ${HEAD_SHA} | merge-base: ${MERGE_BASE} | arquivos .ts/.tsx: ${#FILES[@]}"
[ -z "${GITHUB_STEP_SUMMARY:-}" ] || {
  echo "### Lint de não-regressão"
  echo "base \`${BASE}\` (\`${BASE_SHA}\`), head \`${HEAD_SHA}\`, merge-base \`${MERGE_BASE}\`: **${#FILES[@]}** arquivo(s) .ts/.tsx"
} >> "$GITHUB_STEP_SUMMARY"

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "Diff calculado com sucesso: nenhum .ts/.tsx alterado — lint de não-regressão OK."
  exit 0
fi
printf '  %s\n' "${FILES[@]}"
echo "eslint --max-warnings 0 em ${#FILES[@]} arquivo(s)…"
pnpm exec eslint --max-warnings 0 "${FILES[@]}"
echo "✅ eslint executado em ${#FILES[@]} arquivo(s) sem problemas."
