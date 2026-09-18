# Handoff — Risco de integração: `phases-cdefx-integration` (DATA-039/G8) × `feat/f-emb1-embedding-lineage`

> **Análise READ-ONLY.** Nenhuma integração/merge/rebase/cherry-pick foi executado. Objetivo:
> preparar a integração FUTURA e explicitar riscos. Snapshot em 2026-09-16.

## 1. Merge-base
`f90757dba28d9a2c46794c6d6e4492b7675c6b53` (= `origin/main`, série A2). As duas branches divergem
de um ponto **anterior** à linhagem A3-RD1; ambas carregam A3-RD1 por cima da base.

## 2. Commits exclusivos de cada branch (vs merge-base)
- `claude/phases-cdefx-integration` (HEAD `0a0b3a0`): **32** commits — linhagem A3-RD1 (≈23) + **DATA-039 + G8** (9).
- `feat/f-emb1-embedding-lineage` (HEAD `bf5089b`): **34** commits — linhagem A3-RD1 (≈23) + **F-EMB1** (embedding lineage/reindex).
> Divergência real: ~9 commits meus × ~11 do F-EMB1 acima da linhagem A3-RD1 compartilhada.

## 3. Arquivos potencialmente conflitantes
**Superfície do DATA-039/G8** (o que MINHA linha alterou desde a base A3-RD1 `191b324`):
`server/db/procurement.ts`, `server/routers/procurementProcessRouter.ts`,
`server/__tests__/integration/data039-atomicity-mysql-smoke.test.ts`,
`server/__tests__/integration/procurement-create-process.test.ts`,
`server/__tests__/unit/data039-fail-closed.test.ts`,
`client/src/app-routing-guard.test.ts`, `docs/ops/DATA_039_ADDENDUM_ATOMICITY_FOLLOWUP.md`,
e **uma linha** em `.github/workflows/ci.yml`.

| Arquivo | F-EMB1 toca? | Conflito | Estratégia |
|---|---|---|---|
| `server/db/procurement.ts` | **não** (changed=0) | **LOW** | aplica limpo |
| `server/routers/procurementProcessRouter.ts` | **não** | **LOW** | aplica limpo |
| `server/__tests__/.../data039-atomicity-mysql-smoke.test.ts` | **não** | **LOW** | novo — aplica limpo |
| `server/__tests__/.../procurement-create-process.test.ts` | **não** | **LOW** | aplica limpo |
| `server/__tests__/unit/data039-fail-closed.test.ts` | **não** | **LOW** | novo — aplica limpo |
| `client/src/app-routing-guard.test.ts` | **não** | **LOW** | novo — aplica limpo |
| `docs/ops/DATA_039_ADDENDUM_ATOMICITY_FOLLOWUP.md` | **não** | **LOW** | novo — aplica limpo |
| `.github/workflows/ci.yml` | sim (steps embedding) | **MEDIUM** | **união** dos steps de smoke (sem sobreposição lógica) |
| `drizzle/schema.ts` | sim (embedding lineage) | **LOW** p/ DATA-039/G8 | DATA-039/G8 **não altera** schema — tomar a versão reconciliada A3-RD1+embedding |
| `drizzle/meta/_journal.json` | sim (+idx 301) | **LOW** p/ DATA-039/G8 | DATA-039/G8 **não altera** o journal — entrada 301 é aditiva |
| `package.json` | sim (`db:embedding:reindex`) | **LOW** p/ DATA-039/G8 | DATA-039/G8 **não altera** package.json |

## 3-bis. Matriz de classificação A–F (superfície verificada)

Snapshot: `MY=3cb10dd`, `FEMB1=bf5089b`, `BASE=f90757d`; ~11 commits DATA-039/G8 × ~11 F-EMB1 acima da
linhagem A3-RD1 compartilhada. Método: `comm -12` entre `diff(BASE..MY)` e `diff(BASE..FEMB1)`, e o
recorte do que a linha DATA-039/G8 realmente mudou (`diff 191b324..MY`).

| Classe | Definição | Arquivos |
|---|---|---|
| **A — exclusivos desta branch (DATA-039/G8)** | mudados só aqui | `server/db/procurement.ts` (hunks DATA-039), `server/routers/procurementProcessRouter.ts`, `server/__tests__/integration/data039-atomicity-mysql-smoke.test.ts`, `server/__tests__/integration/procurement-create-process.test.ts`, `server/__tests__/unit/data039-fail-closed.test.ts`, `client/src/app-routing-guard.test.ts`, `docs/ops/DATA_039_ADDENDUM_ATOMICITY_FOLLOWUP.md`, `docs/architecture/data039-transactional-atomicity.md`, este handoff |
| **B — exclusivos F-EMB1** | mudados só lá | `scripts/reindex-legal-embeddings.ts`, tabela `embedding_reindex_runs` + colunas de lineage em `schema.ts`, `drizzle/0301_f_emb1_embedding_lineage.sql` (+snapshot), script `db:embedding:reindex` |
| **C — alterados nas duas branches** | tocados dos dois lados | **linhagem A3-RD1 compartilhada**: `drizzle/schema.ts`, `drizzle/meta/_journal.json`, `package.json`, `scripts/{install-reference,predeploy-release,approve-legal-reference-set}.ts`, `server/db/legalReference.ts`, `server/domain/legalReference/*`, routers/serviços A3, docs F-LEGAL — **e** `.github/workflows/ci.yml` |
| **D — conflito textual provável** | overlap real de hunks | **apenas `.github/workflows/ci.yml`** (ambos anexam steps de smoke) |
| **E — merge automático provável** | sem overlap de hunks | todos os arquivos da classe A (F-EMB1 não os toca) |
| **F — revisão semântica mesmo sem conflito textual** | precisa olho humano | `.github/workflows/ci.yml` (união de steps, sem duplicar nomes); `drizzle/schema.ts` + `_journal.json` (garantir A3-RD1 `0299/0300` + F-EMB1 `0301`; DATA-039/G8 não contribui); confirmar que `recordProcessEvent(idempotencyKey)` sobrevive à integração |

**Conclusão da matriz:** a superfície DATA-039/G8 é **classe A/E** (auto-merge) exceto **um único
arquivo classe D/F** (`ci.yml`, união mecânica). A classe C é a linhagem A3-RD1 compartilhada — sua
reconciliação é **independente** do DATA-039/G8 (que não altera schema/journal/package).

## 4. Riscos semânticos
- **Baixíssimo acoplamento semântico:** DATA-039/G8 mexe no fluxo de **criação de processo / pesquisa
  de preços** e na **guarda de rotas**; F-EMB1 mexe em **embeddings / RAG lineage**. Domínios
  disjuntos — nenhuma sobreposição de regra de negócio.
- `recordProcessEvent` ganhou `idempotencyKey` opcional (retrocompatível; default inalterado): não
  afeta consumidores existentes nem o F-EMB1.

## 5. Risco de ordenação de migration
**BAIXO/NENHUM.** DATA-039/G8 **não criou migration** (max = `0300`, herdada). F-EMB1 detém `0301`.
Não há colisão de número. Qualquer migration futura do follow-up de aditivo (ver
`docs/ops/DATA_039_ADDENDUM_ATOMICITY_FOLLOWUP.md`) deve ser **≥ 0302** e criada **só após** a
reconciliação das branches (PENDING INTEGRATION).

## 6. Risco de conflito no journal
**BAIXO.** `_journal.json`: meu max idx = **300**; F-EMB1 = **301** (aditivo). Como DATA-039/G8 não
toca o journal, a reconciliação preserva 0..300 (compartilhado) + 0301 (F-EMB1) sem perda.

## 7. Risco de perder o lineage do F-EMB1
Presente **apenas** se alguém sobrescrever `schema.ts`/`_journal.json`/`package.json`/`0301` com a
versão da minha branch. **Mitigação:** integrar DATA-039/G8 **por caminho aditivo** (os 6 arquivos de
código/teste que o F-EMB1 não toca + a união do CI), **sem** trazer schema/journal/package do meu lado
(que ali só refletem a linhagem A3-RD1, não DATA-039/G8). Nunca forçar meu `schema.ts` sobre o do F-EMB1.

## 8. Risco de perder o DATA-039
Presente apenas se a reconciliação priorizar a árvore do F-EMB1 e **descartar** os 6 arquivos de
código/teste do DATA-039/G8. **Mitigação:** aplicar explicitamente esses arquivos (F-EMB1 não os
toca → aplicação limpa) + adicionar o step de CI do DATA-039.

## 9. Estratégia recomendada de integração
1. Escolher um **tronco de reconciliação da linhagem A3-RD1** comum às duas branches (ou `main` após
   A3-RD1 entrar) — pré-condição independente de ambos os trabalhos.
2. Aplicar **F-EMB1** (embedding lineage/reindex, `0301`, schema/journal/package/CI dele) — é a linha
   com mudança de schema.
3. Aplicar **DATA-039/G8** por cima, **aditivo**: os 6 arquivos de código/teste (aplicam limpos) +
   **união** do step de CI DATA-039 com os steps do F-EMB1.
4. **Não** trazer `schema.ts`/`_journal.json`/`package.json` do lado DATA-039/G8 (sem mudança relevante ali).

## 10. Ordem recomendada (cherry-pick/merge/rebase)
- Preferir **cherry-pick dos 9 commits DATA-039/G8** sobre a árvore já contendo F-EMB1 (ordem
  cronológica): `3323a02 → 59f4431 → bb6c947 → 6f19a87 → 5d7118f → 59bd6f8 → 73cf2eb → 7029e69 → 0a0b3a0`.
  Como F-EMB1 não toca esses arquivos (exceto CI), o único ponto de resolução manual é `ci.yml` (união).
- Alternativa: merge da minha branch **após** rebase da linhagem A3-RD1 comum — maior risco de ruído
  na linhagem A3-RD1; o cherry-pick isolado é mais limpo para DATA-039/G8.
- **Nunca** force-push/rebase destrutivo sobre `feat/f-emb1-embedding-lineage`.

## 11. Gates obrigatórios após a integração
`pnpm check` · `pnpm lint` (0 warnings nos alterados) · `pnpm test` (suíte completa) · `pnpm build` ·
**todos os smokes MySQL** — incluindo A3-RD1 (reference set + bridge), DATA-039 (atomicidade/
concorrência/rollback), F-EMB1 (embedding lineage/reindex) — e o **migration chain** (`0..0301`) em
MySQL real (clean install/upgrade/replay). CI verde antes de qualquer avanço.

## 12. Comandos/testes a rodar
```
pnpm check && pnpm lint && pnpm test && pnpm build
pnpm exec vitest run server/__tests__/integration/data039-atomicity-mysql-smoke.test.ts
pnpm exec vitest run server/__tests__/integration/reconciliation-mysql-smoke.test.ts   # migration chain 0..0301
pnpm exec vitest run server/__tests__/unit/data039-fail-closed.test.ts
pnpm exec vitest run client/src/app-routing-guard.test.ts
# + smokes A3-RD1 e F-EMB1 (embedding lineage/reindex)
```
(CI da branch integrada via workflow_dispatch; job `deploy` restrito à `main`.)

## 13. Pontos que exigem revisão manual
- `.github/workflows/ci.yml`: **união** dos steps de smoke (DATA-039 + A3-RD1 + F-EMB1) — verificar
  ausência de nomes duplicados de step.
- `drizzle/schema.ts` / `_journal.json`: garantir que a versão integrada contém **A3-RD1 (0299/0300) +
  F-EMB1 (0301)**; DATA-039/G8 não contribui aqui.
- Confirmar que `recordProcessEvent` no tronco integrado mantém o parâmetro `idempotencyKey`
  (replay-safety do evento inicial depende dele).
- Reconfirmar contratos fail-closed: RAG jurídico/embedding permanece fail-closed (F-EMB1) e a criação
  autoritativa permanece fail-closed sem DB (DATA-039). Nenhum reintroduz fallback silencioso.
