# C.2 — Operacionalização da Governança Cognitiva e Documental (entrega)

> Continuação de C.1 ([`docs/architecture/COGNITIVE_GOVERNANCE.md`](../architecture/COGNITIVE_GOVERNANCE.md))
> e do handoff C.2 ([`C2_GOVERNANCE_OPERATIONALIZATION_HANDOFF.md`](./C2_GOVERNANCE_OPERATIONALIZATION_HANDOFF.md)).
> C.1 entregou a FUNDAÇÃO (serviços canônicos). Esta PR C.2 **liga** a governança à operação de
> CATMAT/CATSER, com idempotência canônica, ledger imutável e infraestrutura de limiar — **sem
> escolher o valor do limiar** (decisão institucional).

## 1. Escopo entregue nesta PR

### Bloco A — Idempotência canônica ligada à mutação supervisionada
- A decisão CATMAT/CATSER passa pelo serviço ÚNICO `runWithIdempotency` (nenhum segundo mecanismo):
  - `idempotencyKey` **explícito** na entrada (`decidirCATMAT`);
  - mesma chave + mesmo payload → **replay** do resultado anterior (`replayed:true`);
  - mesma chave + payload diferente → **CONFLICT**;
  - concorrência → execução única (UNIQUE tenant-aware `idempotency_org_user_key`);
  - falha nunca é cacheada como sucesso; tenant+ator-aware.
- Segunda barreira no ledger: `UNIQUE (organizationId, idempotencyKey)` em `catmat_decisions`.

### Bloco B — CATMAT/CATSER operacional supervisionado
- **Ledger imutável** `catmat_decisions` (append-only): cada decisão humana carrega
  código/descrição/proveniência(`source`)/score/justificativa/correlationId/processo/item/ator/
  timestamp e o **limiar em vigor no momento** (`thresholdMinScore`/`thresholdConfigId`).
- **Estados explícitos:** `confirmado` · `rejeitado` · `substituido` · `sem_correspondencia_segura`.
- **Nunca fabrica código:** `confirmado` só aceita código de uma sugestão real; `substituido` exige
  código informado explicitamente pelo servidor (override manual). Regras puras e testadas em
  `server/domain/catmatGovernance.ts`.
- **Nunca auto-confirma:** o ator é sempre um humano autenticado (`tenantProcedure`); a IA/heurística
  apenas SUGERE (domínio determinístico `catmatMatching`).
- **Histórico imutável:** `getCATMATDecisions` devolve a trilha completa; a decisão vigente é a
  última linha (nunca sobrescreve).

### Limiar (fail-closed) — infraestrutura versionada, SEM valor
- Tabela `catmat_threshold_config` (versionada, tenant-aware, com ator/vigência/lineage).
- **Nenhum valor é semeado.** Sem linha ativa, o domínio permanece fail-closed
  (`assessMatchSafety` → `threshold_not_configured`). O valor é definido em runtime por papel
  autorizado (`setCATMATThreshold`, mínimo `manager`) — **o código nunca escolhe o número**.

### Bloco E — Correlação / lineage / observabilidade
- `correlationId` propagado ponta a ponta (contexto tRPC → serviço → ledger → timeline do processo).
- Efeito de lineage aplicado uma única vez (nunca em replay): fixação do código no item
  (`confirmado`/`substituido`) e evento na `process_timeline`.
- Sem chain-of-thought e sem conteúdo sensível integral no ledger (apenas dados estruturais).

## 2. Isolamento multi-tenant (validado)
Toda leitura/escrita filtra `organizationId`. Cobertura explícita cross-tenant em
`catmat-governance-mysql-smoke.test.ts`: a MESMA `idempotencyKey` em orgs distintas gera linhas
independentes (não é replay entre tenants); histórico e limiar de uma org não vazam para outra.

## 3. Artefatos
- Migration aditiva **`drizzle/0292_catmat_governance.sql`** (`catmat_decisions`, `catmat_threshold_config`)
  — idempotente (`CREATE TABLE IF NOT EXISTS`), sem `ALTER`/backfill; espelhada em `bootstrap.ts`.
- Domínio: `server/domain/catmatGovernance.ts`. DB: `server/db/catmatGovernance.ts`.
  Serviço: `server/services/catmatGovernanceService.ts`. Router: procedures novas em
  `server/routers/itemIntelligenceRouter.ts`.
- Testes: `catmat-governance-decision.test.ts` (unit, sem DB) e
  `catmat-governance-mysql-smoke.test.ts` (MySQL real, CI).

## 4. Bloco F — IA legada
Ver [`docs/architecture/AI_LEGACY_MIGRATION_PLAN.md`](../architecture/AI_LEGACY_MIGRATION_PLAN.md):
inventário completo + plano shadow/rollback. **Nenhum cutover, nenhuma remoção, nenhuma alteração de
allowlist** nesta PR.

## 5. Diferido (não incluído — intersecta código congelado)
- **Bloco C/D (aprovação version-aware + UI institucional de documentos):** o fluxo de aprovação de
  DOCUMENTOS vive hoje no `documentsRouter` (congelado `LEGACY_ACTIVE_MAINTENANCE_ONLY`). Reconciliar
  esse fluxo exige tocar código congelado ou construir o caminho canônico paralelo — decisão de
  sequência que fica para uma PR dedicada, sob autorização. A base SoD (`assertInstitutionalDecisionRules`,
  `documentWorkflowService`) já existe e permanece reutilizável.

## 6. ⚠️ DECISÃO INSTITUCIONAL NECESSÁRIA — LIMIAR CATMAT/CATSER

O sistema entrega a **infraestrutura** do limiar (versionada, auditável, tenant-aware, fail-closed),
mas **não define o valor**. Enquanto nenhum valor for definido por um responsável autorizado
(`setCATMATThreshold`), o domínio permanece fail-closed: nenhuma correspondência é considerada
"segura" automaticamente e as sugestões continuam exigindo decisão humana explícita.

**Requer decisão institucional:** o valor de `minScore` (0..1) por organização — número que o código
deliberadamente **não** escolhe.
