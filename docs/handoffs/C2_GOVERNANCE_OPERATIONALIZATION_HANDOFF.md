# Handoff Portátil — Fase C.2: Operacionalização da Governança Cognitiva e Documental

> **Objetivo deste documento:** permitir iniciar a C.2 em **outro ambiente**, sem acesso ao histórico
> desta sessão. Encerramento da C.1: [`../releases/C1_GOVERNANCE_FOUNDATION_CLOSURE.md`](../releases/C1_GOVERNANCE_FOUNDATION_CLOSURE.md).
> Arquitetura da governança: [`../architecture/COGNITIVE_GOVERNANCE.md`](../architecture/COGNITIVE_GOVERNANCE.md).

## 1. Estado atual da arquitetura

A C.1 estabeleceu a **fundação** (ledger cognitivo, idempotência reforçada, SoD no state machine
canônico, contrato CATMAT fail-closed, correlationId confirmado). Tudo aditivo, sem migration e sem
tocar produção congelada. A C.2 **operacionaliza**: liga a idempotência às operações, cria a UI de
revisão/aprovação, torna a aprovação version-aware no fluxo real da UI, implementa a confirmação humana
de CATMAT/CATSER e planeja a migração supervisionada dos legados de IA.

## 2. SHAs e PRs de referência

| Ref | Valor |
|---|---|
| PR da fundação | **#195** |
| Squash na `main` | `ae2f995ada092066098547a7c44dfafe625daa7e` |
| CI da `main` (verde) | run `31145264496` — 6/6 SUCCESS |
| Branch de desenvolvimento | `claude/rebuild-licigov-pro-bFyTO` |
| SHA final da branch | `1118b05c211c9aadc9885e41ee4fc247235148d8` |

## 3. Arquivos e serviços canônicos (pontos de reuso — NÃO duplicar)

| Preocupação | Canônico |
|---|---|
| Gateway cognitivo | `executeCognitiveTask` (Cognitive Kernel) — `server/services/aiExecutionEngine.ts` |
| Fronteira legada de IA | `invokeLLM`/Gemini-raw allowlistados em `server/kernel/architecture/legacyBoundaries.ts` |
| Idempotência | `server/services/idempotencyService.ts` (`checkIdempotency`/`save`/`fail`/`runWithIdempotency`) |
| Correlation | `server/middleware/correlationMiddleware.ts` + `TrpcContext.correlationId` (`server/_core/context.ts`) |
| Workflow/aprovação (canônico) | `server/services/documentWorkflowService.ts` (`assertInstitutionalDecisionRules`) |
| CATMAT/CATSER | domínio puro `server/domain/catmatMatching.ts`; API real `server/routers/catmatRouter.ts`; determinístico `server/routers/itemIntelligenceRouter.ts` |
| Observabilidade cognitiva | tabela `cognitive_observability`; `server/services/cognitive/cognitiveObservabilityService.ts` + `observabilityRepository.ts` + `server/db/cognitiveObservability.ts` |
| RBAC | `OrgRole` (`drizzle/schema.ts`) + `orgRoleProcedure`/`tenantProcedure` (`server/_core/trpc.ts`) |

## 4. Divergências entre documentação histórica e código (código = verdade operacional)

- Enunciados históricos citam `server/_core/llm.ts` como "gateway canônico". **Falso operacionalmente**:
  o canônico é `executeCognitiveTask`; `llm.ts`/`invokeLLM` são **fronteira legada allowlistada**.
- Existem **duas implementações de CATMAT**: (a) LLM legada (`server/services/catmatMatcher.ts` via
  `processesRouter`) usada pela UI e que pode **fabricar** código; (b) determinística
  (`server/domain/catmatMatching.ts` + `itemIntelligenceRouter`) **não ligada à UI**. A C.1 reforçou o
  domínio (a); a consolidação é da C.2.
- Tabelas de governança **órfãs** existem (`ai_execution_audits`, `provider_executions`) — DDL sem
  writers. A C.1 **não** as usou (preferiu o `payload` de `cognitive_observability`). Avaliar em C.2.
- Vários fluxos de aprovação/review coexistem (alguns **em memória**: `humanApprovalService`,
  `reviewWorkspaceRouter`, `itemTrRouter`); o **wired à UI** de documentos é `documentsRouter`
  (owner-only, `LEGACY_ACTIVE_MAINTENANCE_ONLY`).

## 5. Restrições institucionais (invioláveis)

- **Não** assumir `llm.ts` como gateway canônico.
- **Não** criar segundo mecanismo de idempotência.
- **Não** criar domínio paralelo de aprovação nem RBAC paralelo.
- **Não** permitir autoaprovação (IA/sistema ou autor = aprovador).
- **Não** migrar legado em *big-bang*; **nenhuma remoção antes de equivalência comprovada**.
- **Não** alterar produção sem autorização; `LEGACY_ACTIVE_MAINTENANCE_ONLY` = congelado.
- **Não** escolher limiar CATMAT arbitrário (fail-closed até definição institucional).
- **Não** persistir chain-of-thought.
- **Não** quebrar isolamento multi-tenant.
- Toda operação deve ser **replay-safe, auditável e correlation-aware**.
- IA permanece **supervisionada e approval-aware**; decisões jurídicas/institucionais permanecem
  **humanas**.

## 6. Escopo recomendado da C.2 (documentar/implementar quando autorizado)

1. **Wiring de idempotência** (via `runWithIdempotency`, chave por tRPC input `idempotencyKey`) em:
   geração por IA; regeneração; exportação; upload/importação; aprovação/rejeição; confirmação
   CATMAT/CATSER.
2. **Aprovação version-aware** no fluxo efetivamente usado pela UI (reconciliar `documentsRouter` com o
   state machine canônico + SoD; nova alteração ⇒ nova versão ⇒ nova revisão).
3. **Interface institucional** para: revisar; aprovar; rejeitar; solicitar ajustes; visualizar fontes;
   confiança; explicação institucional; histórico e lineage.
4. **CATMAT/CATSER operacional**: confirmação humana; rejeição; substituição; ator; timestamp; processo;
   item; correlationId; idempotência; histórico imutável.
5. **Definição institucional do limiar CATMAT/CATSER**: configurável; tenant-aware se aplicável;
   versionado; fail-closed; **nunca** arbitrário no código.
6. **Plano supervisionado de migração dos legados de IA**: inventário; compatibilidade; *shadow mode*;
   comparação de resultados; *rollout* gradual; *feature flag*; *rollback*; **zero big-bang**; nenhuma
   remoção antes de equivalência comprovada.

## 7. Ordem segura de implementação (sugerida)

1. Wiring de idempotência nas operações **não-frozen** já existentes (menor risco, alto valor).
2. Persistência de confirmação CATMAT/CATSER (ator/quando/processo/item) + rejeição/substituição, sobre
   o domínio já fail-closed.
3. Definição institucional do limiar CATMAT (config versionada) — desbloqueia `safe:true`.
4. Aprovação version-aware + reconciliação do fluxo da UI com o state machine canônico + SoD.
5. UI institucional de revisão/aprovação (consome os contratos acima).
6. Migração supervisionada dos legados de IA (shadow → compare → flag → rollout → rollback-ready).

## 8. Condições de parada (parar e reportar; não decidir sozinho)

- Risco de perda de dados ou migration destrutiva.
- Necessidade de novo domínio estrutural.
- Quebra incompatível de contrato.
- Mudança de produção / alteração de `LEGACY_ACTIVE_MAINTENANCE_ONLY` sem autorização.
- Decisão jurídica ou institucional não definida (ex.: limiar CATMAT).

## 9. Gates obrigatórios

`pnpm check` · `pnpm lint` (arquivos alterados, `--max-warnings 0`) · `pnpm test` · `pnpm build` ·
`pnpm test:smoke:security` · migration-chain e smoke MySQL **se houver migration** · legacy-freeze ·
boundary-enforcement (`rc352`, `rc41`). Graphify: **consultar antes de busca ampla, confirmar no
código, código é a verdade operacional, atualizar somente após mudança estrutural relevante.**

## 10. Definição de pronto (Definition of Done) para itens da C.2

- Reutiliza os canônicos (§3); nenhum mecanismo/domínio paralelo.
- Tenant-aware, replay-safe, idempotente, correlation-aware e auditável (histórico imutável).
- Sem autoaprovação; SoD aplicada; decisões humanas preservadas.
- CATMAT nunca fabrica código; `safe:true` só com limiar institucional configurado.
- Sem chain-of-thought persistida; sem exposição de conteúdo sensível integral.
- Testes cobrindo: isolamento multi-tenant, autor tentando aprovar, sem permissão, replay,
  conflito de idempotência, concorrência, rollback, correlationId ponta a ponta, "sem correspondência
  segura", ausência de aprovação automática, nenhuma chamada de IA fora do gateway (quando aplicável).
- Todos os gates verdes; migração de legado só com equivalência comprovada e rollback pronto.
