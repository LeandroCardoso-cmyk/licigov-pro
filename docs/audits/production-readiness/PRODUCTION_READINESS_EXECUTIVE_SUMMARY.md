# LiciGov Pro — Resumo Executivo de Prontidão para Produção Interna
### Piloto Institucional Controlado — Prefeitura de Moreira Sales

> **Sprint de auditoria e diagnóstico (read-only).** Nenhum código funcional foi alterado.
> Sem migration, sem schema, sem Railway, sem push, sem PR, sem correção.
> Snapshot do código: branch `claude/rebuild-licigov-pro-bFyTO`, HEAD `cacd319` (main `8e93ef8`).
> Data: 2026-07-22. Método: Graph First + 6 auditores read-only paralelos + validação consolidada + verificação direta no código dos achados críticos.

---

## 1. Objetivo e contexto

Determinar, com evidência objetiva, o que **realmente impede** o uso do LiciGov Pro em um
**piloto institucional controlado em produção** — poucos servidores da Prefeitura de Moreira
Sales, ambiente conhecido, uso real supervisionado, um único órgão (single-tenant de fato).

Não é lançamento público nem comercial. O critério não é perfeição, e sim: *quais são os
poucos bloqueadores reais e qual o menor caminho seguro até o piloto.*

---

## 2. Estado geral

### `NÃO_PRONTO_POR_BLOQUEADORES_PONTUAIS`

A arquitetura é sólida e os módulos da "Fase 5" (Contratação Direta, Parecer Jurídico,
Contratos, Central de Operações) estão **canônicos, multi-tenant e utilizáveis**. Os
bloqueadores são **pontuais e concentrados**, não estruturais: um cluster de IDOR nas
procedures legadas do core (Processos/Documentos/Tarefas), dois routers institucionais
expostos sem autenticação, uma senha de admin default e um gate de CI que não compila o
projeto. Todos são corrigíveis em poucos blocos consolidados.

### Estado do dashboard: `DASHBOARD_HÍBRIDO`

A home canônica (Centro de Operações) existe, é servida em `/dashboard` e `/centro-operacoes`
dentro do shell, e consome **dados reais** via tRPC. Porém: (a) rotas legadas paralelas
seguem montadas (`/modulos`, `/direct-contracts*`, `/contracts*`, `/parecer-juridico*`);
(b) o **core do MVP (Processos + DFD/ETP/TR) roda inteiramente no caminho legado**, enquanto
o módulo canônico equivalente existe pronto porém **desconectado do frontend**; (c) algumas
interações centrais da home estão mortas (botão de relatório, cliques em eventos).

---

## 3. Números consolidados

| Severidade | Qtd | Definição |
|---|---:|---|
| **P0 — Bloqueador absoluto** | 5 | Vazamento cross-tenant, acesso não autorizado, credencial default, ops sem auth |
| **P1 — Bloqueador do piloto** | 19 | Impede uso institucional confiável (core no legado, sem transações, IA sem timeout, CI fake) |
| **P2 — Curto prazo** | 29 | Risco moderado, débito com exposição limitada, observabilidade incompleta |
| **P3 — Melhoria futura** | 15 | Legado inacessível, limpeza, refinamento, dead code |
| **Total** | **68** | |

> **Severidade ≠ decisão de go-live.** A severidade P0/P1/P2/P3 classifica a natureza e o
> impacto técnico de cada achado. Quem determina se um item bloqueia o piloto é a coluna de
> decisão e o **Gate de Produção Interna** (`INTERNAL_PRODUCTION_GATE.md`) — um achado P1 ou
> mesmo P2 pode bloquear a produção interna conforme exposição e contexto. A severidade não
> substitui o gate.

- **Bloqueadores reais para o piloto single-tenant:** 5 P0 + os P1 de core/CI/IA.
- **Módulos prontos (canônicos, tenant-safe, com UI):** 4 — Contratação Direta, Parecer Jurídico, Contratos/Aditivos, Central de Operações.
- **Módulos parcialmente prontos:** 3 — Processos, DFD/ETP/TR, Importação de itens (só Excel).
- **Módulos legados ainda expostos:** 5 rotas paralelas (`/modulos`, `/direct-contracts`, `/contracts`, `/parecer-juridico`, `/processos`).
- **Módulos canônicos inacessíveis pela UI:** módulo de Licitação canônico (procurementProcessRouter + Workspaces DFD/ETP/TR/Edital) — órfão do frontend.
- **Rotas quebradas:** 0 (nenhuma rota principal retorna erro); interações mortas na home (P1) e páginas órfãs (P3).
- **Endpoints inseguros:** ~12 procedures com IDOR/global no core legado + 23 procedures públicas em `deployment`/`stability`.
- **Testes ausentes:** módulo Gestão (tarefas) e billing sem teste dedicado; 5 de 7 smokes MySQL fora do CI.
- **Validações executadas neste snapshot:** typecheck ✅ 0 erros · build ✅ · suíte ✅ 3805 passed / 74 skipped / 0 falhas · lint ⚠️ 360 erros pré-existentes (todos `no-unused-vars`/`no-console` em scripts e testes, nenhum em rota de produção).

---

## 4. Principais bloqueadores (P0)

1. **TENANT-001 (P0)** — `processesRouter` tem IDOR direto: `getById`, `getProcessItems`,
   `addItemsToTR`, `updateProcessItem`, `deleteProcessItem`, `updateStatus` não validam dono
   nem organização. Qualquer usuário autenticado lê/edita/apaga qualquer processo por ID.
   *É o núcleo do MVP (fluxo DFD→ETP→TR).* Confirmado em `processesRouter.ts:113-329`.
2. **TENANT-002 (P0)** — `taskRouter`/`departmentTasksRouter`: `list`/`getById`/`update`/
   `delete`/anexos operam sobre id global sem filtro. `listTasks` retorna todas as tarefas do
   sistema. Confirmado em `taskRouter.ts:48-178`, `departmentTasksRouter.ts:48-114`.
3. **AUTH-003 (P0)** — `deploymentRouter` e `stabilityRouter` são 100% `publicProcedure`:
   criar/avançar/rollback de deployment e injetar métricas de qualquer org **sem login**.
   Confirmado em `deploymentRouter.ts:18-30`, montados em `routers.ts:119-120`.
4. **RBAC-004 (P0)** — `onboarding.grantDepartmentPermission` permite que qualquer usuário
   autenticado conceda a si próprio permissão `scope: global`. Confirmado em `onboardingRouter.ts:56-69`.
5. **CONFIG-005 (P0, condicional)** — Admin é seedado no boot com senha default `Admin@123`
   se `ADMIN_PASSWORD` não estiver setada no Railway. Confirmado em `bootstrap.ts:18,4225`.
   *Indeterminado sem acesso ao painel Railway* — mitigado se a variável estiver configurada.

---

## 5. Pontos fortes (o que já está bom)

- **Camada canônica de Fase 5 sólida:** Contratação Direta, Parecer, Contratos e Central de
  Operações usam `tenantProcedure` com `ctx.organizationId`, persistência real e Document Engine.
- **Tirar Dúvidas totalmente funcional e auditado:** corpus real (Lei 14.133 + 8.666 + Lei
  Municipal 769/Moreira Sales), citações verbatim, replay determinístico, persistência por tenant.
- **Isolamento multi-tenant já corrigido** em contratos (PR #182) e pareceres (PR #183).
- **Exportação DOCX/PDF real** (pdfkit + docx), hash SHA-256, lineage e signed URLs S3 no Document Engine.
- **Suíte de testes robusta:** 3805 testes verdes; testes arquiteturais de "freeze" de legado.
- **Backup e DR documentados** com RTO/RPO; migrations com journal 100% consistente (287/287).

---

## 6. Recomendação final e caminho mínimo

**Recomendação:** o sistema **não deve entrar em produção interna como está**, mas está a
**um esforço médio e concentrado** do piloto. Os bloqueadores são poucos, bem localizados e
agrupáveis. Recomenda-se **1 sprint de segurança (Bloco A) + 1 sprint de fluxo/CI (Blocos B+D
reduzidos)** antes do go-live, ocultando os módulos incompletos por trás de navegação.

**Caminho mínimo (ordem sugerida):**
1. **Bloco A — Segurança e isolamento** (P0 obrigatório): corrigir IDOR de processos/tarefas/
   documentos, proteger `deployment`/`stability`/`onboarding`, senha de admin, `.env`.
2. **Bloco B — Fluxo canônico e interface**: decidir e unificar o caminho de Processos/DFD/ETP/TR
   (conectar o canônico OU blindar o legado), ocultar rotas legadas e páginas de teste da navegação.
3. **Bloco D — Produção e resiliência**: gate de CI real (build+typecheck+smokes de isolamento),
   endpoint `/health`, transações nas operações críticas, timeout/fallback visível de IA.
4. **Bloco C — Governança cognitiva** (pós-piloto): rastreabilidade de IA legada, idempotência ampla, aprovações persistidas.

**Estimativa:** **3 PRs obrigatórias antes do piloto** (A — Segurança, B — Fluxo, D — Produção)
+ **1 a 2 PRs durante o piloto** (C — Governança Cognitiva, dividida em duas apenas se o escopo
exigir) = **total de 4 a 5 PRs**. Esforço relativo: Bloco A = média; Bloco B = média;
Bloco D = pequena-média; Bloco C = média (durante o piloto).

**Critério objetivo de encerramento do gate:** ver `INTERNAL_PRODUCTION_GATE.md`.

---

## 7. Documentos desta auditoria

| Arquivo | Conteúdo |
|---|---|
| `PRODUCTION_READINESS_EXECUTIVE_SUMMARY.md` | Este documento |
| `PRODUCTION_READINESS_FINDINGS.md` | Inventário consolidado dos 68 achados com IDs estáveis |
| `DASHBOARD_AND_NAVIGATION_AUDIT.md` | Auditoria de dashboard, home, navegação, UX |
| `INSTITUTIONAL_USER_JOURNEY.md` | Jornada ponta a ponta do servidor, etapa por etapa |
| `MODULE_READINESS_MATRIX.md` | Matriz de prontidão por módulo |
| `ROUTES_AND_ROUTERS_INVENTORY.md` | Inventário de páginas, rotas e ~74 routers tRPC |
| `PRODUCTION_REMEDIATION_PLAN.md` | Plano consolidado em 4 blocos de correção |
| `INTERNAL_PRODUCTION_GATE.md` | Checklist de gate PASS/FAIL para o go-live |
