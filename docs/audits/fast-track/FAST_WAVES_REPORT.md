# Fast-Wave A / Fast-Wave B — relatório

Base `main` = `ee70c81eeeba6f54413b625e64ee8c03ae108e55`; candidate = `1aebba4977d67478d1b2d03e35adba7900584a11` (inalterados no remoto). Baseline `SEMANTIC_AUTHORITY_CROSS_MODULE_AUDIT.md` sha256 `08edc734…0810b3` intacto.
PKG-01 não reaplicado (equivalência de patch/árvore; os 6 commits-fonte ficaram de fora).

## Contagem (desvio explicado)
58 commits remanescentes provados. **Críticos = 49 / post-G0 = 9** (esperado 47/11). Dois commits foram movidos de post-G0 para críticos por **dependência provada nos gates**, sem redesenho:
- `a05debe` (SEM-035): o guard SEM-034 (`bc74f6f`, crítico) afirma o estado final do `itemIntelligenceRouter` (1 escritor governado de CATMAT); sem o commit o guard falhou (3 escritores).
- `5081ec7` (NEW-030): o smoke 0288 (da main) dropava `import_sessions` no banco compartilhado da cadeia CI; sem o fix o passo "R9/R10 (2º passe)" falha (colunas ausentes).
Ambos são apenas CATMAT-ledger/infra de teste (não tocam contrato de template). Tabelas: `CRITICAL_COMMITS_49.md`, `POST_G0_COMMITS_9.md`.

## Wave A — `integration/semantic-fast-wave-a` @ `dda9fea71915a9bfdfbf47c2ac8448c9eef08776`
17 commits sobre main: 1 docs de decisões (HD-01/10/11/12; bloqueios preservados), 14 picks (0310–0314 + PR-13 + RBAC base), FIXUP-M (snapshots 0311–0314 alinhados à forma final da 0310) e 1 regeneração única do Graphify.
Gate: tsc ✔, lint dos arquivos alterados ✔ (--max-warnings 0), 558 testes focados ✔, 19 smokes MySQL (184) ✔, suíte completa 6514 ✔, cadeia CI real (44 passos) ✔, security smoke 28 arquivos/298 testes ✔, build ✔, audit:gate ✔, baseline ✔, árvore limpa ✔, Graphify idempotente ✔.
## Wave B — `integration/semantic-fast-wave-b` @ `5827b7f4fa6b351d3232eae485a4e190cef5f62c` (base = head da A)
34 picks/ajustes + regeneração única do Graphify (inclui 0315, source authority, upstreamAuthority, digests, autoria/emissão, autoridade numérica, lineage oficial, SEM-043, guards R11 comportamentais e equivalentes de d6904da/bc74f6f/4037745/35a6c6d/df1a717/22d0ed8).
Gate: tsc ✔, lint alterados ✔, 1499 focados ✔, 52 smokes MySQL (434) ✔, suíte completa 6972 ✔, cadeia CI (44 passos) ✔ **exceto uma falha intermitente** (ver abaixo; reexecução verde 38/38 arquivos, 391/391), build ✔, audit:gate ✔, baseline ✔, árvore limpa ✔, Graphify idempotente ✔.
Validação explícita (smokes MySQL reais verdes): Document Engine/export, OfficialDocumentLifecycleService, ledger de artefatos oficiais (0315, append-only por formato), ledger de decisões institucionais, autoria TR/Edital, `source_changed`, digests de fonte, `upstreamAuthority`, marcador de edição humana, pré-condições de emissão, autoridade numérica, isolamento multi-tenant, replay/idempotência.

### Falha intermitente pré-existente (NÃO introduzida pela integração)
`sem084-sem062-sem040-contract-instruments-mysql-smoke` K1 (8 aditivos concorrentes) falha de forma intermitente (query `SELECT MAX(version) … FOR UPDATE` / `INSERT official_documents` em `createAddendum`). Medido: **6/20 falhas na própria candidate** (código idêntico) e 3/20 na Wave B. Origem: commit-fonte R9 (SEM-084, `27e9992`). Correção seria semântica (retry de deadlock/ordenação de locks) ⇒ **não aplicada** (`FAST_TRACK_INTEGRATION_SEMANTIC_FIX_REQUIRED` evitado por não ser fixup mecânico). Risco: a PR da Wave B pode ter o job `mysql-smoke` vermelho intermitente. **Requer decisão do owner** (aceitar re-run ou autorizar correção).

## Cadeia de migrations
0310 → 0311 → 0312 → 0313 → 0314 (Wave A) → 0315 (Wave B), estritamente nessa ordem; o migrator real (`migrate:release`) aplica por journal; journal = ledger ✔; replay ✔; upgrade main→A e A→B ✔; tudo em MySQL 8 (não MariaDB). `db:generate`: o drift pré-existente da main (7 `ADD COLUMN` em `operation_records`, snapshots 0307–0309 ausentes) **desaparece exatamente no commit `1e29176`** (snapshot 0310 completo na forma final) e permanece zerado em A e A+B.
0310 sem UNIQUE de número de contrato (HD-15 pendente; SQL em `drizzle/policy-pending/`).

## FIXUPs (todos mecânicos, sem mudança de comportamento)
- FIXUP-0: lista `test:smoke:security` = lista da candidate ∩ arquivos existentes, ordem da candidate.
- FIXUP-3: passo CI "2º passe" restrito a smokes existentes (remove legal-opinion pinning, operational indicators, task deadline — commits post-G0).
- FIXUP-5: colapso da 0310 (12+32).
- FIXUP-M: snapshots 0311–0314 alinhados à forma final da 0310.
- Conflitos de `package.json`/journal/snapshots/docs resolvidos mecanicamente pelo driver de pick (0 resolução semântica); Graphify nunca carregado dos commits-fonte (regenerado 1× por onda com `PYTHONHASHSEED=0`).

## Post-G0 (9, fora das ondas)
Ver `POST_G0_COMMITS_9.md` — todos LOW exceto `988e555` (UI de identidade de item) = MEDIUM; nenhum toca contrato crítico de Templates.
