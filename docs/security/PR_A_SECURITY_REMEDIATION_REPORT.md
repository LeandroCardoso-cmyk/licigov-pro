# PR A — Relatório de Remediação de Segurança e Isolamento
### LiciGov Pro · Bloco A · Pré-piloto interno Moreira Sales · RC-SEC-PR-A

> Sprint de implementação (Bloco A do plano de remediação). Sem migration, sem
> alteração de schema, sem Railway, sem deploy. Commits locais; sem push.

## 1. Escopo

Eliminar acessos cross-tenant/IDOR, endpoints institucionais públicos, escalação
de privilégio, ingresso automático indevido na organização da Prefeitura e
credencial administrativa default. Achados-alvo: TENANT-001/002/006/007/008,
AUTH-003, RBAC-004, CONFIG-005, SEC-017/018/022/034/035/037, TENANT-030/031/038.

## 2. Base

- Branch: `claude/rebuild-licigov-pro-bFyTO`.
- Base (origin/main no início): `d9490fef7267598204de3169fa40d85400bfd4ae`.
- HEAD inicial da branch: `5dc52720656b8c62644aa8fb9a55fb3968fe199e`.

## 3. Achados tratados e estado

| Achado | Estado | Observação |
|---|---|---|
| TENANT-001 (processos IDOR) | `CODE_RESOLVED` | tenantProcedure + *ForOrganization |
| TENANT-002 (tarefas/atividades/comentários IDOR) | `CODE_RESOLVED` | idem; anexos SEC-037 abaixo |
| TENANT-006 (contratação direta) | `CODE_RESOLVED` | analytics e leituras por org |
| TENANT-007 (IA sobre processo alheio) | `CODE_RESOLVED` | buildContext por org |
| TENANT-008 (documentos) | `CODE_RESOLVED` | cadeia processo→documento→versão por org |
| AUTH-003 (deployment/stability públicos) | `CODE_RESOLVED` | adminProcedure |
| RBAC-004 (onboarding self-grant) | `CODE_RESOLVED` | orgRoleProcedure('admin'); org/ator do ctx |
| CONFIG-005 (senha admin default) | `PARTIALLY_RESOLVED` / `OPERATOR_ACTION_REQUIRED` | código exige ADMIN_PASSWORD em produção; verificação no Railway pendente |
| SEC-017 (registro + fallback org1) | `CODE_RESOLVED` | fallback removido; registro fail-closed |
| SEC-018 (.env versionado) | `PARTIALLY_RESOLVED` / `OPERATOR_ACTION_REQUIRED` | .env fora do índice; segredos a rotacionar (runbook) |
| SEC-022 (sessão 1 ano) | `CODE_RESOLVED` | TTL 24h configurável |
| SEC-034 (rate limit spoofável) | `PARTIALLY_RESOLVED` | identificador endurecido; store ainda in-memory (fallback documentado) |
| SEC-035 (cookie sameSite none) | `CODE_RESOLVED` | sameSite lax |
| SEC-037 (anexos de tarefa) | `PARTIALLY_RESOLVED` | addAttachment SAFE_DISABLED; list/delete isolados por org |
| TENANT-038 (catmat público) | `CODE_RESOLVED` | tenantProcedure + rate limit |
| TENANT-030 (tabelas-filhas sem org) | `MITIGATED_BY_PARENT_GUARD` | validação pela entidade-pai (coluna org própria seria `MIGRATION_REQUIRED`, fora de escopo) |
| TENANT-031 (assertTenantOwnership sem uso) | `DEFERRED_BY_SCOPE` | padrão *ForOrganization adotado; helper legado não removido |

## 4. Routers auditados (13) e procedures migradas

- **Núcleo:** processesRouter (12 proc), taskRouter (12), departmentTasksRouter (13),
  activitiesRouter (1), commentsRouter (4), documentsRouter (16), aiAssistantRouter (6)
  → todas de `protectedProcedure` para `tenantProcedure`.
- **Contratação direta:** directContractsRouter (37) → todas `tenantProcedure`.
- **Ops:** deploymentRouter (11) e stabilityRouter (12) → `adminProcedure`.
- **Onboarding:** onboardingRouter (7) → `tenantProcedure`/`orgRoleProcedure('admin')`.
- **Catálogo:** catmatRouter (4) → `tenantProcedure` + rate limit.
- **Total:** ~148 procedures auditadas; ~135 migradas a tenant, 23 a admin, 2
  deliberadamente mantidas fora de tenant (nenhuma institucional).

## 5. Repositories criados / reutilizados (funções *ForOrganization)

- `server/db/processes.ts`: listProcessesForOrganization, searchProcessesForOrganization,
  updateProcessStatusForOrganization, getDocumentByIdForOrganization,
  getDocumentsByProcessForOrganization, getDocumentByProcessAndTypeForOrganization,
  getDocumentVersionsForOrganization, updateDocumentStatusForOrganization
  (+ getProcessByIdForOrganization já existente).
- `server/db/processItems.ts`: getProcessItemsForOrganization, saveProcessItemsForOrganization,
  updateProcessItemForOrganization, deleteProcessItemForOrganization,
  createCatmatSuggestionForOrganization, getCatmatSuggestionsByItemForOrganization,
  getCatmatSuggestionByIdForOrganization, updateCatmatSuggestionForOrganization,
  rejectOtherSuggestionsForOrganization (validação pela entidade-pai).
- `server/db/tasks.ts`, `server/db/comments.ts`, `server/db/collaboration.ts`:
  variantes *ForOrganization (tarefas/comentários/atividades e filhas).
- `server/db/directContracts.ts`: listDirectContractsForOrganization,
  updateDirectContractForOrganization, getDirectContractsOverviewForOrganization,
  getDirectContractsChartDataForOrganization, getTopSuppliersForOrganization,
  getTopLegalArticlesForOrganization, getRecentDirectContractsForOrganization,
  updateDirectContractDocumentForOrganization, updateQuotationForOrganization
  (+ getDirectContractByIdForOrganization já existente).

## 6. Funções globais congeladas

`getProcessById`, `getDocumentById`, `getDirectContractById`, `listDirectContracts`,
`updateDirectContract` e as analytics globais permanecem exportadas para consumidores
fora do escopo (outros domínios), marcadas como INSEGURAS/legado. Nenhum router
corrigido as consome; o teste de congelamento impede o retorno.

## 7. Matriz de tenant (resumo)

Todo recurso institucional é resolvido por `ctx.organizationId` (servidor), nunca
pelo input. Tabelas com coluna org (processes/documents/tasks/comments/activityLogs/
direct_contracts) filtram por id+organizationId. Tabelas-filhas sem coluna org
(processItems/catmatSuggestions/taskComments/taskAttachments/directContract{Documents,
Quotations,AuditLogs,Checklist}) são validadas pela entidade-pai. Cross-tenant e
inexistente retornam NOT_FOUND idêntico.

## 8. Testes MySQL reais

Nova suíte de isolamento tenant A × B: `server/__tests__/integration/rc-sec-pr-a-*-mysql-smoke.test.ts`
(processos/tarefas/documentos/IA/contratação direta) — ver seção 19 para resultado.

## 9. Testes arquiteturais

`server/__tests__/integration/rc-sec-pr-a-tenant-freeze.test.ts` (17 testes): impede
regressão de protectedProcedure/publicProcedure, consultas globais por ID, fallback
org1, senha default, `.env` rastreado, catmat público, onboarding self-grant.

## 10. Auth / RBAC

- `deployment`/`stability`/`onboarding.grantDepartmentPermission` exigem privilégio
  adequado; `approvedBy`/`createdBy`/`grantedBy`/`organizationId` derivados do contexto.
- Escopo global de permissão restrito a admin de plataforma. Sem autoelevação.

## 11. Registro e membership

Registro público fail-closed (`ALLOW_PUBLIC_REGISTRATION`, default false). Usuário
sem membership não ingressa na org 1 — recebe FORBIDDEN/`NO_ORGANIZATION_MEMBERSHIP`.

## 12. Sessão / cookies / rate limit

TTL 24h configurável (`SESSION_TTL_HOURS`) no cookie e no JWT; cookie `sameSite: lax`,
httpOnly, secure em produção; rate limiter com identificador resistente a spoofing
(usuário → `req.ip`; nunca `x-forwarded-for` cru), documentado como fallback in-memory.

## 13. `.env`

Removido do índice (`git rm --cached .env`; preservado localmente e ignorado).
`.env.example` sanitizado e completado (APP_ENV, AWS_*, SESSION_TTL_HOURS,
ALLOW_PUBLIC_REGISTRATION, ADMIN_PASSWORD, AI_*).

## 14. Segredos

Nenhum valor de segredo no diff, testes, logs ou neste relatório. O histórico do Git
ainda contém os valores previamente commitados → rotação operacional obrigatória.

## 15. Ações operacionais pendentes

Ver `docs/security/PR_A_SECRET_ROTATION_RUNBOOK.md` (`OPERATOR_ACTION_REQUIRED`):
rotacionar `JWT_SECRET`, `DATABASE_URL`, `GEMINI_API_KEY` (e AWS/ADMIN se aplicável);
definir `ADMIN_PASSWORD` no Railway; confirmar `ALLOW_PUBLIC_REGISTRATION=false`.

## 16. Riscos remanescentes

- Tabelas-filhas sem coluna org própria dependem do parent-guard (adicionar coluna
  seria `MIGRATION_REQUIRED`, fora de escopo — Bloco D/futuro).
- Rate limit in-memory (não distribuído) — Redis fora de escopo.
- SEC-037: fluxo seguro de upload de anexo de tarefa a implementar em PR B.
- Permissões de onboarding ainda em memória (rastreabilidade plena = Bloco C).

## 17. Itens fora do escopo

Blocos B/C/D, dashboard, provider/timeout de IA, transações gerais, CI/health/backup,
migrations, limpeza de dados.

## 18. Estado por achado

Ver tabela da seção 3 (CODE_RESOLVED / PARTIALLY_RESOLVED / OPERATOR_ACTION_REQUIRED /
DEFERRED_BY_SCOPE / MITIGATED_BY_PARENT_GUARD).

## 19. Resultado das validações

- **Typecheck** (`tsc --noEmit`): 0 erros.
- **Build** (`vite build` + esbuild): sucesso.
- **Suíte completa** (sem DATABASE_URL): **3822 passed / 84 skipped / 0 falhas**
  (baseline 3805/74; +17 freeze arquitetural, +10 smoke MySQL skipado sem DB; zero regressões).
- **Smokes MySQL reais (isolados, DB real):** rc-sec-pr-a-core-isolation **10/10**;
  legal-opinions-tenant-isolation **26/26**; contracts-legacy-full-isolation **18/18**.
- **Teste arquitetural de congelamento** (rc-sec-pr-a-tenant-freeze): **17/17**.
- **Lint:** 358 erros no total (baseline 360; nenhum novo nos arquivos alterados).
- **Segredos:** nenhum valor no diff; `git diff --check` limpo.
- Nenhum teste removido; nenhum novo skip injustificado (os skips do smoke são
  `describe.skipIf(!DB)`, executam com DATABASE_URL).

## 20. Parecer

O Bloco A elimina, com evidência automatizada (freeze + MySQL-real), os vetores de
IDOR/cross-tenant, endpoints públicos e escalação de privilégio do pré-piloto, e
fecha registro/sessão/credencial. Os itens `OPERATOR_ACTION_REQUIRED` (rotação de
segredos, ADMIN_PASSWORD no Railway) dependem de ação humana no ambiente e mantêm
G4/G5 do gate como não-`PASS` até verificação. Sem migration/schema/Railway.
