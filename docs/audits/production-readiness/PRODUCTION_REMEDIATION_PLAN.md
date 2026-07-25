# Plano Consolidado de Correções
### LiciGov Pro · Piloto Moreira Sales · 2026-07-22

Os 68 achados agrupados em **4 blocos**. Ordem recomendada: **A → B → D** antes do piloto;
**C** durante o piloto. Cada bloco é dimensionado para caber em uma sprint consolidada.

> Este documento **não** contém prompts de implementação — apenas o agrupamento, dependências,
> critérios de aceite e testes necessários. A execução ocorre em sprints futuras autorizadas.

---

## Bloco A — Segurança e Isolamento (P0 obrigatório)

**Objetivo:** eliminar todo acesso não autorizado antes de qualquer usuário real entrar.

**Achados incluídos:** TENANT-001, TENANT-002, TENANT-006, TENANT-007, TENANT-008, AUTH-003,
RBAC-004, CONFIG-005, SEC-017, SEC-018, SEC-022, SEC-037, TENANT-038, SEC-034, SEC-035.

**Arquivos prováveis:** `server/routers/processesRouter.ts`, `taskRouter.ts`,
`departmentTasksRouter.ts`, `activitiesRouter.ts`, `commentsRouter.ts`, `aiAssistantRouter.ts`,
`onboardingRouter.ts`, `deploymentRouter.ts`, `stabilityRouter.ts`, `directContractsRouter.ts`;
`server/db/processes.ts`, `tasks.ts`, `processItems.ts`, `collaboration.ts`, `directContracts.ts`;
`server/bootstrap.ts`, `_core/cookies.ts`, `authRouter.ts`; `.env`/`.gitignore`.

**Padrão de correção (já validado em PRs #182/#183):** migrar procedures institucionais para
`tenantProcedure`; criar funções `*ForOrganization` no repository; validar registro-pai da org
para tabelas-filhas sem `organizationId`; cross-tenant e inexistente retornam erro idêntico.
Proteger `deployment`/`stability` com `adminProcedure`. Remover auto-concessão em `onboarding`.
Forçar `ADMIN_PASSWORD` obrigatória (falhar boot se ausente em produção). Rotacionar
`JWT_SECRET` e `git rm --cached .env`. Fechar registro público (convite) ou remover fallback org 1.

**Dependências:** nenhuma externa. **Risco de execução:** médio (mexe no core; alta cobertura de teste existente).
**Critérios de aceite:**
- Todo acesso a processo/tarefa/documento/comentário exige pertencimento à org do recurso.
- `deployment`/`stability`/`onboarding` inacessíveis sem privilégio adequado.
- Boot em produção falha sem `ADMIN_PASSWORD`; `.env` fora do git; segredo rotacionado.
- Suíte verde + novos smokes MySQL de isolamento para processes/tasks/documents.

**Testes necessários:** smokes MySQL de isolamento cross-tenant (mesmo padrão dos existentes)
para processes, tasks, documents, comments; testes de autorização para deployment/stability/onboarding.
**Cabe em 1 sprint?** Sim. **Esforço:** média.

---

## Bloco B — Fluxo canônico e interface (P1)

> **Status: ENTREGUE para homologação** (corte controlado para o pipeline canônico —
> Opção 2). Detalhes em [`PR_B_CANONICAL_CUTOVER.md`](./PR_B_CANONICAL_CUTOVER.md).
> Confirmado não haver dados legados a migrar; legado desativado e inerte; SEC-037
> implementado. Sem merge — aguardando homologação.

**Objetivo:** o servidor navega e opera o fluxo principal sem cair em telas legadas/duplicadas
ou de debug, e o que ele cria aparece na Central.

**Achados incluídos:** LEGACY-010, LEGACY-011, LEGACY-013, DATA-013, DASH-021, NAV-023, ERR-047,
UI-054, UI-055, DOC-058, NAV-081, NAV-082, UX-079, UX-080.

**Decisão-chave (arquitetural):** unificar o fluxo de Processos/DFD/ETP/TR. Duas opções:
1. **Blindar o legado** (mais rápido): manter `Dashboard`/`documentsRouter`, aplicar Bloco A,
   fazer a Central ler também as tabelas legadas.
2. **Conectar o canônico** (mais alinhado ao North Star): rotear os Workspaces
   `components/procurement/*` + `procurementProcessRouter`, migrar/coexistir dados.
   *Recomendação: começar por (1) para o piloto, planejar (2) como evolução.*

**Arquivos prováveis:** `client/src/App.tsx` (ocultar rotas legadas e `/test*`), `DashboardLayout.tsx`,
`DepartmentOperationHome.tsx`, `departmentOperationService.ts`, `NotFound.tsx`, componentes de domínio.

**Dependências:** Bloco A (o legado só pode ficar exposto depois de seguro).
**Critérios de aceite:** navegação completa pela sidebar sem URL manual; rotas legadas e de teste
fora da navegação; botão de relatório e cliques da home funcionais; processos criados aparecem na
Central; sem tela duplicada; erros tratados em pt-BR.
**Cabe em 1 sprint?** Sim (opção 1). **Esforço:** média.

---

## Bloco C — Governança cognitiva e documental (P1-P2, durante o piloto)

**Objetivo:** rastreabilidade, idempotência e supervisão da IA e das aprovações.

**Achados incluídos:** AUDIT-020, DOC-016, ARCH-025, TENANT-032, TENANT-033, OBS-045, REPLAY-046,
DOC-084, e a governança de prompts/versionamento de IA.

**Arquivos prováveis:** `server/_core/llm.ts`, `services/gemini.ts`, `catmatMatcher.ts`,
`humanApprovalService.ts`, `idempotencyService.ts`, `institutionalRagRouter.ts`, `aiAuditService.ts`.

**Escopo:** rotear geração legada por `_core/llm.ts`; persistir input/output/correlationId de IA;
idempotency key em geração/export/upload/aprovação; aprovações no DB com validação de tenant e
reviewer≠autor; CATMAT com confirmação humana obrigatória e sem código alucinado; propagar
`X-Correlation-Id` do client.

**Dependências:** Blocos A e B. **Risco:** médio.
**Critérios de aceite:** toda saída de IA rastreável e supervisionada; retry não duplica registros;
aprovação institucional persistida e íntegra. **Cabe em 1 sprint?** Parcialmente — dividir em 2 se necessário.
**Esforço:** média. **Fora do piloto imediato:** postergável ao início do piloto.

---

## Bloco D — Produção e resiliência (P1-P2)

**Objetivo:** deploy seguro, observável e reversível.

**Achados incluídos:** DEPLOY-019, DEPLOY-049, DEPLOY-050, DEPLOY-051, DATA-012, AI-014, AI-015,
OBS-043, OBS-044, ERR-048, SEC-036, DATA-039, DATA-040/041/042, PERF-052, DOC-056, DOC-057.

**Arquivos prováveis:** `.github/workflows/ci.yml`, `server/_core/index.ts` (endpoint `/health`,
port binding), `_core/llm.ts`/`ai/gemini.ts` (timeout/retry/AbortController + fallback visível),
operações críticas (transações), `config/*.ts`, `CLAUDE.md`/`.env.example`, `railway.*` (criar).

**Escopo:** gate de CI real (build + typecheck + lint + smokes de isolamento antes do deploy);
endpoint HTTP `/health`; transações nas operações multi-tabela (numeração, versão, sequences);
timeout/retry em IA + sinalização quando cair em mock; corrigir mismatch `AWS_REGION`; atualizar
`.env.example`; **backup e restauração para produção interna** (ver abaixo).

**Backup e restauração — estado atual vs condição para o go-live:**
- *Estado atual (auditado):* backup manual (workflow_dispatch, artifact 7 dias), retenção
  limitada, procedimento de DR documentado, **restore nunca testado** (DEPLOY-051).
- *Condição para produção interna:* backup automatizado ou comprovadamente agendado; retenção
  definida; procedimento de restauração documentado; **pelo menos um teste de restauração
  executado com sucesso**, com resultado registrado sem exposição de dados ou segredos.
- O backup manual atual **não é suficiente** para o go-live. Nenhum backup/restore deve ser
  executado nesta etapa documental.

**Dependências:** independente de A/B para o gate de CI; transações se beneficiam do Bloco A.
**Critérios de aceite:** main verde = projeto compila + typecheck + isolamento testado; `/health`
responde HTTP 200; retry não duplica; IA nunca serve mock silenciosamente como oficial; backup
agendado com pelo menos um teste de restauração bem-sucedido registrado.
**Cabe em 1 sprint?** Sim (gate de CI + /health + timeout são a parte crítica). **Esforço:** pequena-média.

---

## Itens que ficam FORA de qualquer bloco (P3 / pós-piloto)

Limpeza de legado (LEGACY-070/072/073/074), `.manus/*` (SEC-075), deps não usadas (DEP-076),
seeds quebrados (DATA-077), índices/FKs (DATA-041/078), 28 routers órfãos (LEGACY-071),
cobertura de testes de Gestão/billing (TEST-053), mocks dead-code (UI-083). Fazer durante o
piloto como faxina progressiva, sem bloquear o go-live.

---

## Resumo de sequenciamento

| Bloco | Quando | Esforço | Depende de | PRs |
|---|---|---|---|---|
| **A — Segurança** | Pré-piloto (obrigatório) | Média | — | 1 |
| **B — Fluxo/UI** | Pré-piloto | Média | A | 1 |
| **D — Produção** | Pré-piloto (gate de CI) | Pequena-média | — | 1 |
| **C — Governança IA** | Durante o piloto | Média | A, B | 1-2 |

**Estimativa total:** **3 PRs obrigatórias antes do piloto** (A, B, D) + **1 a 2 PRs durante o
piloto** (C, dividida em duas apenas se o escopo exigir) = **4 a 5 PRs**.
**Caminho mínimo até o piloto:** Blocos A + B + D.
