# Matriz de integração pré-PR — branches pós-night-shift (simulação local)

> **Nota de importação (2026-10-01):** documento importado sem alteração de conteúdo da branch `audit/r2-2-r2-3-prep`
> (`f4d8cbc`) para a branch de integração `work/autonomous-semantic-remediation-r3-r11`. Os artefatos
> `integration-fixups/*` citados abaixo **não** foram importados (referem SHAs de 28–29/09 e continuam na branch de origem);
> a reintegração sobre a main `aac4241` está registrada em `AUTONOMOUS_REMEDIATION_COMMIT_MAP.md`.

> **Natureza:** simulação DESCARTÁVEL, 100% local. Nada foi enviado ao remoto: nenhum push, nenhum branch remoto criado/alterado, nenhum PR.
> Worktree destacado `/home/user/licigov-pro/.claude/worktrees/integ` sobre `origin/main = 5924b4a` (branches baseadas em `5cd9d50`),
> merges `git merge --no-ff --no-edit origin/<branch>` em sequência, commits locais só no HEAD destacado. Banco próprio `licigov_p9_integ`
> (MariaDB 10.11, 127.0.0.1). Data da execução: 28–29/09/2026.
> HEAD final da simulação: `c02a8eb` (49 commits sobre 5924b4a: 17 merges + 7 fix-ups `integ(...)`).
> Artefatos para o integrador real (versionados junto deste documento): `integration-fixups/000{1..7}-integ-*.patch` (fix-ups) e
> `integration-fixups/remerge-<sha>.diff` (resolução de cada merge conflitado via `git show --remerge-diff`). O remerge do merge da PR-09
> (`remerge-1cd4a91.diff`, ~1 MB por conter os snapshots do drizzle) **não** foi versionado; sua resolução está descrita em §3 W4.3/M8.
> O bundle da simulação e o HEAD `c02a8eb` existem apenas localmente (efêmeros) e **não** foram enviados ao remoto.

## 1. Ordem validada

| Pos. | Branch | Head mergeado | Resultado do merge |
|---|---|---|---|
| W1.1 | fix/r2-pr02-disable-legacy-endpoints | `f1beb2c` | limpo |
| W1.2 | fix/r2-leg005-disable-legacy-items-catmat | `00209a9` | textual: package.json |
| W1.3 | fix/r2-leg009-disable-legacy-documents | `c483faf` | textual: package.json, legacyBoundaries.ts · semântico: documentsRouter (import), tenant-freeze test |
| W1.4 | fix/r2-leg028-disable-memory-production-apis | `a98101f` | limpo |
| W1.5 | fix/r2-leg032-disable-public-contact | `ccaf0f8` | limpo |
| W1.6 | fix/new-002-disable-lgpd-hard-delete | `81622d8` | textual: package.json |
| W2.1 | fix/new-005-direct-procurement-rbac | `fbe9328` | textual: package.json, directProcurementRouter.ts (imports) |
| W2.2 | fix/new-006-contract-workspace-rbac | `db7fefc` | textual: package.json, server/_core/trpc.ts (orgRoleProcedure) |
| W2.3 | fix/new-007-legal-opinion-rbac | `ed8ac75` | textual: package.json |
| W3.1 | fix/r2-pr04a-direct-price-import | `6a8e8a9` | textual: package.json, directProcurementRouter.ts (imports + importPriceResearch) |
| W3.2 | fix/r3-pr05-create-not-reset-processes | `fcdb3b1` | textual: directProcurementRouter.ts, procurementProcessRouter.ts · semântico: `const log` duplicado, grep test |
| W3.3 | fix/r3-pr06-create-not-reset-legal-contract | `b655087` | textual: package.json, legalOpinionWorkspaceService.ts · semântico: smoke PR-06 × NEW-006/NEW-007 |
| W4.1 | fix/r4-pr08-rbac-state-machine | `dd03480` | textual: package.json, contractService.ts |
| W4.2 | fix/r5-pr12-contract-governed-change | `6fab8c7` | textual: package.json · semântico: CAS × UNIQUE 0308, smoke PR-06 C12/C13 |
| W4.3 | fix/r5-pr09-regeneration-human-state | **`ddb148c`** (novo head) | textual: package.json, journal, 0308_snapshot (add/add), collaboration smoke · migração renumerada 0308→**0309** · semântico: smoke 0308 da PR-06 |
| W5.1 | cutover/r2-pr04-canonical-price-ingestion | `1568c40` | textual: package.json, procurementProcessRouter.ts |
| W5.2 | audit/r2-2-r2-3-prep | `335a68e` | limpo (só docs) |

**PR-09:** o head antigo `c5b116f` já havia sido substituído no remoto por `ddb148c` ("fix(r5): persist edital institutional parameters",
28/09 23:41 UTC, pai `c5b116f`) quando a W3 terminou; nenhuma espera foi necessária. Re-checado ao final: todos os heads remotos continuam
idênticos aos mergeados (inclusive `ddb148c`). Foi mergeado o **novo head `ddb148c`** (inclui a migration de critério/regime do Edital).

**Veredito sobre a ordem:** a ordem candidata é **válida sem reordenação**. Todas as dependências abaixo são satisfeitas por ela; os
conflitos são inevitáveis em qualquer ordem (sobreposição de arquivos) e as correções necessárias estão listadas na §4. Ajustes
recomendados apenas de disciplina: (a) PR-09 sempre DEPOIS da PR-06 (a PR-06 fica com 0308; a PR-09 é renumerada para 0309);
(b) PR-12 sempre depois de PR-06 **e** de NEW-006 (o CAS precisa do mapeamento do UNIQUE e os fixtures NEW-006 já são PR-12-compatíveis);
(c) cutover PR-04 depois de PR-05 (mesmo bloco de helpers em procurementProcessRouter).

## 2. Dependências de ordem (verificadas)

| Dependência | Tipo | Evidência |
|---|---|---|
| PR-02 antes de NEW-005 | recomendada | NEW-005 deixa `directProcurement.updateStage` como `tenantProcedure` e classifica como `LEGACY_TO_DISABLE (LEG-011) → desligado por PR-02` (comentário do router + matriz `directProcurementRbacMatrix.ts`). Sem PR-02 a procedure fica viva sem piso de papel. |
| PR-02 × LEG-005 | semântica (qualquer ordem) | PR-02 desliga `processes.updateStatus` (LEG-006); o teste da LEG-005 afirmava que `updateStatus` segue viva → reescrito (fix-up 0002). |
| PR-02 × LEG-009 | semântica (qualquer ordem) | Juntas desligam as 16 procedures de `documentsRouter` → `TRPCError` sem uso (lint) e `rc-sec-pr-a-tenant-freeze` perde o `getDocumentByIdForOrganization` (fix-ups 0001 e 0007). |
| NEW-005 ⇄ NEW-006 (trpc.ts) | textual obrigatória | Cada uma traz UMA correção de tipagem do `orgRoleProcedure`. Com a implementação ORIGINAL (5cd9d50) o tree integrado dá **18 erros TS** (`ctx.user` possibly null em contractWorkspaceRouter/directProcurementRouter + `assertOrgRoleAtLeast` inexistente). Qualquer uma das duas basta para tipar; a resolução mantém uma única implementação (inline da NEW-005 + helpers/log da NEW-006). |
| NEW-006 antes de PR-06? | **não é obrigatória** | PR-06 isolada usa `ctx.user.id` sob `tenantProcedure` (já estreitado) e tipa sozinha. Só quando NEW-006 converte essas rotas para `orgRoleProcedure` é que a correção de tipagem (NEW-005 ou NEW-006) passa a ser necessária — e ela vem dentro da própria NEW-006. |
| NEW-005 × PR-05 | semântica (qualquer ordem) | `process-create-contract.test.ts:142` procurava `createProcess: tenantProcedure`; após NEW-005 é `createProcess: orgRoleProcedure("operator")` (fix-up 0003). `indexOf` = -1 fazia o slice falhar. |
| NEW-005/PR-04A antes de PR-05 | — | PR-04A e PR-05 declaram `const log = serviceLogger(...)` e importam `serviceLogger` em pontos diferentes → auto-merge gera redeclaração (ver §4, item M3). |
| NEW-007 × PR-06 | semântica | Smoke PR-06 L1 `e4` e L3 `eActor`: agora `FORBIDDEN LEGAL_OPINION_ASSIGNMENT_REQUIRED` (autoridade de atribuição precede o Create≠Reset). |
| NEW-006 × PR-06 | semântica | Smoke PR-06 C12 muda status via `updateContract` com ator `operator` → NEW-006 exige piso `manager` para mudança de status. |
| PR-06 → PR-12 | semântica obrigatória | PR-12 troca o upsert `insertContractWorkspace` (que mapeava ER_DUP_ENTRY → CONFLICT `CONTRACT_ALREADY_EXISTS`) pelo UPDATE condicional `compareAndSetContractWorkspace`. Sem mapeamento, renomear para número já usado ⇒ **INTERNAL_SERVER_ERROR** (provado: C13 recebe `INTERNAL_SERVER_ERROR` sem o fix). Além disso `expectedUpdatedAt` passou a ser obrigatório no input. |
| PR-06 → PR-09 | migração | Ambas criaram `0308`. PR-06 mantém 0308; PR-09 vira 0309. O smoke `contract-number-unique-0308` precisa construir o estado pré-0308 como PREFIXO do journal (mesmo padrão que a PR-09 já aplicou ao smoke da 0307). |
| PR-05 × cutover PR-04 | textual | Helpers `resolveExistingProcurementCreate` (PR-05) e `assertLegacyPriceResearchPasteAllowed` (PR-04) no mesmo ponto; manter ambos. |

## 3. Matriz por branch

Legenda: **T** = conflito textual; **S** = conflito semântico (merge textual limpo, mas quebra de build/lint/teste ou de contrato).

### W1.1 — fix/r2-pr02-disable-legacy-endpoints (`f1beb2c`)
- **Arquivos (9):** package.json; `server/routers/{directProcurementRouter,documentsRouter,processesRouter,procurementProcessRouter}.ts`; `server/services/legacyEndpointGuard.ts` (blob `dc6d3d4`); testes `r2-pr02-legacy-endpoints-disabled{,-mysql-smoke}.test.ts`, `rc-sec-pr-a-core-isolation-mysql-smoke.test.ts`.
- **Conflitos:** nenhum (primeira da fila).
- **Smoke a preservar:** `r2-pr02-legacy-endpoints-disabled-mysql-smoke.test.ts`.
- **Testes alterados na integração:** nenhum dela; ela causa mudanças em testes de LEG-005 e do tenant-freeze (ver W1.2/W1.3).
- **Migração:** não. **Posição:** 1ª (pré-requisito recomendado da NEW-005).

### W1.2 — fix/r2-leg005-disable-legacy-items-catmat (`00209a9`)
- **Arquivos (6):** package.json; `server/kernel/architecture/legacyBoundaries.ts`; `server/routers/processesRouter.ts`; `legacyEndpointGuard.ts` (idêntico `dc6d3d4`); testes `r2-leg005-legacy-items-catmat-{disabled,mysql-smoke}.test.ts`.
- **Conflitos:** T `package.json` (união). S teste `r2-leg005-legacy-items-catmat-disabled.test.ts` ("procedures fora do escopo…" esperava `updateStatus` viva → recebe `LEGACY_ENDPOINT_DISABLED` da PR-02). `processesRouter.ts` auto-mergeou limpo com PR-02.
- **Resolução:** fix-up 0002 — `list/search/getById` seguem vivas sem evento; `updateStatus` agora rejeita `LEGACY_ENDPOINT_DISABLED` com evento `surfaceId: "LEG-006"` (nunca LEG-005).
- **Smoke a preservar:** `r2-leg005-legacy-items-catmat-mysql-smoke.test.ts`. **Migração:** não.

### W1.3 — fix/r2-leg009-disable-legacy-documents (`c483faf`)
- **Arquivos (11):** package.json; `legacyBoundaries.ts`; `documentsRouter.ts`; `legacyEndpointGuard.ts` (`dc6d3d4`); testes `document-settings-governance-contract`, `document-generation-mysql-smoke`, `documents`, `r2-leg009-legacy-documents-disabled{,-mysql-smoke}`, `rc-sec-pr-a-core-isolation-mysql-smoke`, `security`.
- **Conflitos:** T `package.json`; T `legacyBoundaries.ts` (linhas adjacentes em `BOUNDARY_CLASSIFICATIONS`: LEG-009 reescreveu a nota de `documentsRouter.ts`, LEG-005 a de `processesRouter.ts`). S `documentsRouter.ts`: `import { TRPCError }` ficou sem uso (lint). S `rc-sec-pr-a-tenant-freeze.test.ts:87` exigia `getDocumentByIdForOrganization` (não resta procedure viva que o use). `documentsRouter.ts` e `rc-sec-pr-a-core-isolation-mysql-smoke.test.ts` auto-mergearam limpos com PR-02.
- **Resolução:** `legacyBoundaries` = nota de documentsRouter da LEG-009 + nota de processesRouter da LEG-005. Fix-up 0001 remove o import. Fix-up 0007 reescreve o teste para o contrato mais forte: nenhum acesso `db.*(` em runtime e exatamente 16 `throwLegacyEndpointDisabled("documents.*", "LEG-008|LEG-009")`.
- **Smoke a preservar:** `r2-leg009-legacy-documents-disabled-mysql-smoke.test.ts`. **Migração:** não.

### W1.4 — fix/r2-leg028-disable-memory-production-apis (`a98101f`)
- **Arquivos (17):** `.env.example`; `server/config/experimentalApis.ts`; `server/services/experimentalApiGate.ts`; `legacyEndpointGuard.ts` (`dc6d3d4`); 12 routers experimentais (approvalWorkflow, clause, collaborationComments, export, itemAnalytics, itemTr, pilotReadiness, productionReadiness, reviewWorkspace, structuredExport, trComposition, webhook); teste `r2-leg028-experimental-api-gate.test.ts`.
- **Conflitos:** nenhum. **Smoke:** não adiciona ao `test:smoke:security`. **Migração:** não.

### W1.5 — fix/r2-leg032-disable-public-contact (`ccaf0f8`)
- **Arquivos (3):** `contactRouter.ts`; `legacyEndpointGuard.ts` (`dc6d3d4`); teste `r2-leg032-contact-disabled.test.ts`.
- **Conflitos:** nenhum. **Smoke:** nenhum. **Migração:** não.

### W1.6 — fix/new-002-disable-lgpd-hard-delete (`81622d8`)
- **Arquivos (6):** package.json; `server/db/lgpd.ts`; `lgpdRouter.ts`; `server/services/accountRemovalGuard.ts`; testes `new-002-account-hard-delete-{disabled,mysql-smoke}.test.ts`.
- **Conflitos:** T `package.json`. **Smoke a preservar:** `new-002-account-hard-delete-mysql-smoke.test.ts`. **Migração:** não.

**`legacyEndpointGuard.ts`:** blob `dc6d3d4` idêntico em PR-02, LEG-005, LEG-009, LEG-028, LEG-032, PR-08 e cutover PR-04 → nenhum conflito; tree final = `dc6d3d4`.

### W2.1 — fix/new-005-direct-procurement-rbac (`fbe9328`)
- **Arquivos (11):** 5 componentes `client/src/components/direct-procurement/*`; package.json; `server/_core/trpc.ts`; `directProcurementRbacMatrix.ts` (novo); `directProcurementRouter.ts`; testes `direct-procurement-rbac-{contract,mysql-smoke}.test.ts`.
- **Conflitos:** T `package.json`; T `directProcurementRouter.ts` (imports: PR-02 `throwLegacyEndpointDisabled` × NEW-005 `orgRoleProcedure`).
- **Resolução:** união dos imports. `updateStage` fica `tenantProcedure` + `throwLegacyEndpointDisabled(LEG-011)` (desenho da NEW-005).
- **Smoke a preservar:** `direct-procurement-rbac-mysql-smoke.test.ts`. **Migração:** não. **Dependência:** depois de PR-02.

### W2.2 — fix/new-006-contract-workspace-rbac (`db7fefc`, 4 commits)
- **Arquivos (6):** package.json; `trpc.ts`; `contractWorkspaceRbac.ts` (novo); `contractWorkspaceRouter.ts`; testes `new006-contract-workspace-rbac{,-mysql-smoke}.test.ts`.
- **Conflitos:** T `package.json`; T `server/_core/trpc.ts` — NEW-005 reescreveu `orgRoleProcedure` inline (`tenantProcedure.use(async opts => …; return next())`); NEW-006 adicionou `hasOrgRoleAtLeast`/`assertOrgRoleAtLeast` (+ log `rbac/org_role_denied`, fail-closed sem membership) e trocou `next({ ctx })` por `next()` dentro de `t.middleware`.
- **Resolução (semântica):** mantidos os helpers e o log da NEW-006 + uma única implementação:
  ```ts
  export function orgRoleProcedure(minRole: OrgRole) {
    return tenantProcedure.use(async opts => {
      const { ctx, next, path } = opts;
      assertOrgRoleAtLeast(ctx, minRole, path);
      return next();
    });
  }
  ```
  Tipagem estreitada preservada (`pnpm check` 0 erros), mesma mensagem/ranking, recusa logada.
- **Smoke a preservar:** `new006-contract-workspace-rbac-mysql-smoke.test.ts`. **Migração:** não. Os fixtures já são PR-12-compatíveis (commits 0e5dadb/db7fefc).

### W2.3 — fix/new-007-legal-opinion-rbac (`ed8ac75`)
- **Arquivos (10):** 2 componentes legal-opinion; package.json; `server/db/legalOpinionAssignment.ts` (novo); `legalOpinionWorkspaceRouter.ts`; `legalOpinionAuthorityService.ts` (novo); `legalOpinionWorkspaceService.ts`; testes `new007-legal-opinion-{assignment-authority,assignment-rbac-mysql-smoke,receive-claim}.test.ts`.
- **Conflitos:** T `package.json`. **Smoke a preservar:** `new007-legal-opinion-assignment-rbac-mysql-smoke.test.ts`. **Migração:** não.
- **Efeito posterior:** muda expectativas do smoke da PR-06 (W3.3).

### W3.1 — fix/r2-pr04a-direct-price-import (`6a8e8a9`)
- **Arquivos (9):** `PriceJustificationWorkspace.tsx`; package.json; `server/db/directPriceImport.ts`, `server/domain/directPriceImport.ts` (novos); `directProcurementRouter.ts`; `directProcurementService.ts`; testes `direct-price-import-contract`, `direct-price-import-governed-mysql-smoke`, `sprint5z-direct-procurement`.
- **Conflitos:** T `package.json`; T `directProcurementRouter.ts` (imports: + `serviceLogger`; bloco `importPriceResearch`: NEW-005 já trocara para `orgRoleProcedure("operator")`, PR-04A também, com input `idempotencyKey` e try/catch governado).
- **Resolução:** imports = guard + `router, tenantProcedure, orgRoleProcedure` + `serviceLogger`; `importPriceResearch` = versão PR-04A integral (já `orgRoleProcedure("operator")`).
- **Smoke a preservar:** `direct-price-import-governed-mysql-smoke.test.ts`. **Migração:** não.

### W3.2 — fix/r3-pr05-create-not-reset-processes (`fcdb3b1`)
- **Arquivos (11):** `.github/workflows/ci.yml` (novo step de smoke); `server/db/{directProcurement,procurement}.ts`; `server/domain/processCreateContract.ts` (novo); `directProcurementRouter.ts`; `procurementProcessRouter.ts`; testes `create-not-reset-{processes-mysql-smoke,router}`, `data039-atomicity-mysql-smoke`, `procurement-create-mysql-smoke`, `unit/process-create-contract`.
- **Conflitos:** T `directProcurementRouter.ts` (tipos do import de domínio); T `procurementProcessRouter.ts` (tipos). **S** `directProcurementRouter.ts`: o auto-merge deixou **dois** `import { serviceLogger }` e **dois** `const log = serviceLogger(...)` (PR-04A `"DirectProcurementRouter"`, PR-05 `"directProcurementRouter"`) — redeclaração. **S** `unit/process-create-contract.test.ts:142`.
- **Resolução:** tipos de domínio = `DirectStartOption, DirectProcurementType, DirectProcurementWorkspace` (sem `DirectProcurementStage`, removido pela PR-02); procurement = `+ ProcurementWorkspace` (sem `ProcessStage`, sem uso). Um único import de `serviceLogger` e um único `const log = serviceLogger("directProcurementRouter")` (nenhum teste depende do nome do serviço). Fix-up 0003 no grep test. `createProcess` final = `orgRoleProcedure("operator")` + INSERT puro com evento + `resolveExistingDirectCreate`.
- **Smoke/CI a preservar:** `create-not-reset-processes-mysql-smoke.test.ts` (step no `ci.yml`; NÃO entra em `test:smoke:security`). **Migração:** não.

### W3.3 — fix/r3-pr06-create-not-reset-legal-contract (`b655087`, 2 commits)
- **Arquivos (20):** `NewContractWizard.tsx`, `LegalOpinionEditor.tsx`; **`drizzle/0308_contract_number_unique_per_org.sql`**, `drizzle/meta/0308_snapshot.json`, `_journal.json`, `drizzle/schema.ts`; package.json; `scripts/preflight-0308.sql`; `server/db/{contractWorkspace,legalOpinionWorkspace}.ts`; `server/domain/{contractCreation,legalOpinionDraft}.ts` (novos); `contractWorkspaceRouter.ts`; `contractService.ts`; `legalOpinionWorkspaceService.ts`; testes `collaboration-stage-assignment-atomicity-mysql-smoke`, `contract-number-unique-0308-mysql-smoke`, `contrato-avulso-mysql-smoke`, `create-not-reset-legal-contract{,-mysql-smoke}`.
- **Conflitos:** T `package.json`; T `legalOpinionWorkspaceService.ts` (bloco de import de `../db/legalOpinionWorkspace`: NEW-007 removeu `insertLegalOpinionWorkspace/insertLawyerAssignment`, adicionou claim/authority; PR-06 removeu `insertLegalOpinionDraft`, adicionou `claimNewLegalOpinionDraft/updateUnsignedLegalOpinionDraft/listLegalOpinionDraftsByWorkspace` + `serviceLogger`). Funções alteradas são disjuntas. `contractWorkspaceRouter.ts` (rename `_contractId` idêntico) auto-mergeou.
- **Resolução:** união dos imports **usados** (calculado por uso no corpo; removidos os 3 órfãos). **S** smoke `create-not-reset-legal-contract-mysql-smoke.test.ts` — fix-up 0004: L1 `e4` e L3 `eActor` → `FORBIDDEN` + `LEGAL_OPINION_ASSIGNMENT_REQUIRED` (snapshot "zero mutação" mantido); C12: novo usuário `managerA` (role `manager`) faz a transição `vigente` (NEW-006), incluído no cleanup.
- **Smokes a preservar:** `contract-number-unique-0308-mysql-smoke.test.ts`, `create-not-reset-legal-contract-mysql-smoke.test.ts`.
- **Migração:** **0308** (idx 308, when `1790619028946`, snapshot id `b455cc58…`, prevId `bb880ba9…` = 0306; não existe snapshot 0307 no main — pré-existente). Mantém o número.

### W4.1 — fix/r4-pr08-rbac-state-machine (`dd03480`, 2 commits)
- **Arquivos (13):** `AddendumWorkspace.tsx`, `ApostilleWorkspace.tsx`; `docs/design/CONTRACT_ACTIVATION_TRANSITION.md`; package.json; `server/db/contractWorkspace.ts`; `server/domain/contractWorkspace.ts`; `contractWorkspaceRouter.ts`; `itemIntelligenceRouter.ts`; `contractService.ts`; `legacyEndpointGuard.ts` (`dc6d3d4`); testes `pr08-rbac-state-machine{,-mysql-smoke}`, `v1-functional-closure-mysql-smoke`.
- **Conflitos:** T `package.json`; T `contractService.ts` (imports de domínio e de db; `const log` `"contractService"` × `"ContractService"`); **S** import duplicado de `serviceLogger` (PR-08 no topo, PR-06 no fim do bloco).
- **Resolução:** domínio = `createContractWorkspace, CONTRACT_DOMAIN_COPILOTS, planInstrumentStatusChange, type ContractWorkspace, type ContractOriginType, type ContractInstrumentKind, type InstrumentStatusChangePlan`; db = `getContractWorkspace, compareAndSetContractWorkspaceStatus, type ContractWsExecutor` (+ resto), **removidos** `insertContractWorkspace` e `updateContractWorkspaceStatus` (sem uso após PR-06/PR-08); um só `serviceLogger`; `log = serviceLogger("contractService")`. Router: `orgRoleProcedure("manager")` (NEW-006) + `.catch(mapInstrumentStatusError)` (PR-08) auto-mergeados.
- **Smoke a preservar:** `pr08-rbac-state-machine-mysql-smoke.test.ts`. **Migração:** não.

### W4.2 — fix/r5-pr12-contract-governed-change (`6fab8c7`, 2 commits)
- **Arquivos (9):** `ContractEditor.tsx`; package.json; `server/db/contractWorkspace.ts`; `server/domain/contractWorkspace.ts`; `contractWorkspaceRouter.ts`; `server/services/contractEditService.ts` (novo); testes `pr12-contract-governed-change{,-mysql-smoke}`, `sprint5w-contracts`.
- **Conflitos:** T só `package.json` (NEW-006 isolou sua linha de import para não colidir com PR-08/PR-12). **S (importante)** `compareAndSetContractWorkspace` (UPDATE simples) × UNIQUE(organization_id, normalized_number) da 0308: renomear para número tomado ⇒ ER_DUP_ENTRY ⇒ `INTERNAL_SERVER_ERROR`. **S** `updateContract` exige `expectedUpdatedAt` (Zod) ⇒ C12/C13 do smoke da PR-06 recebiam `BAD_REQUEST`.
- **Resolução (fix-up 0005, implementada na simulação):** `server/db/contractWorkspace.ts` — `compareAndSetContractWorkspace` envolve o `db.update` em try/catch; `isDuplicateKeyError(err)` ⇒ `TRPCError CONFLICT` com a mesma mensagem/tokens `CONTRACT_ALREADY_EXISTS` do upsert legado (nada gravado: statement único falha inteiro; o evento de timeline não é gravado porque vem depois). `mapContractEditError` repassa `TRPCError`. Smoke PR-06: C12 e C13 enviam `expectedUpdatedAt: <workspace>.updatedAt`. Comprovado: sem o mapeamento C13 falha com `INTERNAL_SERVER_ERROR`; com ele passa (21/21).
- **Smoke a preservar:** `pr12-contract-governed-change-mysql-smoke.test.ts`. **Migração:** não.

### W4.3 — fix/r5-pr09-regeneration-human-state (**`ddb148c`**; head antigo `c5b116f`)
- **Arquivos (novo head vs 5cd9d50):** client procurement (`ETPWorkspace`, `EditalWorkspace`, `TRWorkspace`, `RegenerationConfirmDialog`, `RegenerationBlockedNotice`, `regenerationGuard{,.test}`, `regenerationR5.test`); package.json; **`drizzle/0308_edital_institutional_parameters.sql`**, `drizzle/meta/0308_snapshot.json`, `_journal.json`, `drizzle/schema.ts` (`generated_documents.judgment_criterion/execution_regime` varchar(100) NULL); `server/db/procurement.ts`; `server/domain/{draftRegeneration,generatedDocument}.ts`; `procurementProcessRouter.ts`; `procurementProcessService.ts`; `server/services/authoring/editalContext.ts`; testes `c4a-replay-safe-generation`, `c4b1-official-promotion-mysql-smoke`, `collaboration-stage-assignment-atomicity-mysql-smoke`, `p0-edital-generation`, `pr09-regeneration-human-state{,-mysql-smoke}`, `unit/pr09-draft-regeneration-domain`, `unit/pr09-r5-edital-institutional-parameters-domain`.
- **Conflitos:** T `package.json`; T `drizzle/meta/_journal.json` (idx 308 em ambas); T add/add `drizzle/meta/0308_snapshot.json`; T `collaboration-stage-assignment-atomicity-mysql-smoke.test.ts` (PR-06 e PR-09 reescreveram o mesmo teste pelo mesmo motivo — "0307 deixou de ser a última"). `procurementProcessRouter.ts`, `db/procurement.ts` auto-mergearam com PR-02/PR-05.
- **Renumeração 0308 → 0309 (feita no merge):**
  - `git mv drizzle/0308_edital_institutional_parameters.sql drizzle/0309_edital_institutional_parameters.sql`; cabeçalho `-- 0309 —`, nota de NUMERAÇÃO atualizada e procedure `licigov_0308_add_col`/variáveis → `licigov_0309_*` (SQL ainda não aplicado em nenhum ambiente ⇒ mudança de hash sem impacto).
  - `_journal.json`: idx 308 = `0308_contract_number_unique_per_org` (PR-06, when 1790619028946); **idx 309** = `0309_edital_institutional_parameters`, when `1790637161152` (o da PR-09; monotônico).
  - `meta/0308_snapshot.json` = byte a byte o da PR-06. `meta/0309_snapshot.json` = snapshot da PR-06 + as 2 colunas de `generated_documents` (ordem de colunas da PR-09), `id = d38bd35e…` (o da PR-09), **`prevId = b455cc58…`** (0308 da PR-06). Verificado: PR-06 difere de 0306 só em `contract_workspaces`, PR-09 só em `generated_documents`; `pnpm db:generate` no tree integrado ⇒ **"No schema changes, nothing to migrate"**.
  - Referências "0308" do código/testes da PR-09 → "0309" (comentários em `procurementProcessService.ts`, `editalContext.ts`, `procurementProcessRouter.ts`, `db/procurement.ts`, `domain/{draftRegeneration,generatedDocument}.ts`, `EditalWorkspace.tsx`, `regenerationGuard.ts`, `schema.ts:5449`, testes pr09); no smoke pr09: arquivo `drizzle/0309_…sql`, `ROUTINE_NAME LIKE 'licigov_0309%'`, `journal.entries.at(-1)` = `{ idx: 309, tag: "0309_edital_institutional_parameters" }`.
  - `collaboration-stage-assignment-atomicity-mysql-smoke.test.ts`: mantida a versão da PR-06 (HEAD; genérica via `FROM_0307_TAGS` derivado do journal — cobre 0308+0309).
- **S** `contract-number-unique-0308-mysql-smoke.test.ts` (PR-06) — fix-up 0006: o estado "pré-0308" excluía só a 0308; com a 0309 presente o migrator (por timestamp) aplicava a 0309 e **pulava** a 0308 (M2 não abortava; M3 contava +1). Reescrito para PREFIXO do journal (idx < 308, só os arquivos dessas entries); ledger esperado = `+ fromTag0308Count` (0308 + posteriores); M2: o validator do boot nomeia a migration MAIS RECENTE não aplicada (`0309_…`), então a asserção usa a última tag do journal (o "0308 não registrada" continua provado pelo ledger inalterado).
- **Smoke a preservar:** `pr09-regeneration-human-state-mysql-smoke.test.ts`. **Migração:** **0309** (renumerada).

### W5.1 — cutover/r2-pr04-canonical-price-ingestion (`1568c40`)
- **Arquivos (9):** `PesquisaPrecosWorkspace.tsx`; `useIngestionCapabilities.ts`; `procurement-presentation-fallbacks.test.ts`; package.json; `procurementProcessRouter.ts`; `legacyEndpointGuard.ts` (`dc6d3d4`); testes `pr04-legacy-price-research-guard{,-mysql-smoke}`, `procurement-candidate-eligibility-mysql-smoke`.
- **Conflitos:** T `package.json`; T `procurementProcessRouter.ts` (mesmo ponto: `resolveExistingProcurementCreate` da PR-05 × `assertLegacyPriceResearchPasteAllowed` da PR-04). Imports auto-mergeados (`isFeatureEnabled`, `CANONICAL_INGESTION_FLAG` + os da PR-05).
- **Resolução:** manter as duas funções (PR-05 primeiro, depois PR-04). O guard estático da PR-05 (corpo até `\n}\n`) continua passando.
- **Smoke a preservar:** `pr04-legacy-price-research-guard-mysql-smoke.test.ts`. **Migração:** não.

### W5.2 — audit/r2-2-r2-3-prep (`335a68e`, 3 commits, só docs)
- **Arquivos (4):** `docs/audits/{POST_NIGHT_SHIFT_DECISIONS,POST_NS_TRIAGE_NEW_003_004_015,R2_CANONICAL_INGESTION_TENANT_DECISION,R2_LEGACY_DATA_USAGE_READONLY}.md`. Merge limpo; nenhum arquivo congelado tocado.

## 4. `package.json` → `test:smoke:security`

Resolução em todos os merges: **união ordenada** (paths do HEAD + novos do branch, sem duplicar). Main tem 9 paths; tree final tem **23** (9 + 14), todos existentes, sem duplicata:
PR-02 `r2-pr02-legacy-endpoints-disabled-mysql-smoke` · LEG-005 `r2-leg005-legacy-items-catmat-mysql-smoke` · LEG-009 `r2-leg009-legacy-documents-disabled-mysql-smoke` · NEW-002 `new-002-account-hard-delete-mysql-smoke` · NEW-005 `direct-procurement-rbac-mysql-smoke` · NEW-006 `new006-contract-workspace-rbac-mysql-smoke` · NEW-007 `new007-legal-opinion-assignment-rbac-mysql-smoke` · PR-04A `direct-price-import-governed-mysql-smoke` · PR-06 `contract-number-unique-0308-mysql-smoke` + `create-not-reset-legal-contract-mysql-smoke` · PR-08 `pr08-rbac-state-machine-mysql-smoke` · PR-12 `pr12-contract-governed-change-mysql-smoke` · PR-09 `pr09-regeneration-human-state-mysql-smoke` · PR-04 `pr04-legacy-price-research-guard-mysql-smoke`.
(LEG-028, LEG-032, PR-05 e docs não alteram a lista; PR-05 adiciona step próprio no `ci.yml`.)

## 5. Gates por onda (tree acumulado)

| Onda | `pnpm -s check` | eslint (arquivos das resoluções) | Testes-alvo sem DB (acumulado) | Smokes MySQL (DB novo) |
|---|---|---|---|---|
| W1 | 0 erros | 0 (após fix-up 0001) | 9 arquivos / 188 testes ✔ (após fix-up 0002) | 6 / 27 ✔ |
| W2 | 0 | 0 (`trpc.ts`, `directProcurementRouter.ts`, `contractWorkspaceRouter.ts`) | 13 / 416 ✔ | W2: 3 / 33 ✔ |
| W3 | 0 | 0 (`directProcurementRouter.ts`, `procurementProcessRouter.ts`, `legalOpinionWorkspaceService.ts`, testes) | 18 / 491 ✔ (após fix-up 0003) | W3: 8 / 88 (3 falhas → fix-up 0004) ⇒ W1–W3: 17 / 148 ✔ |
| W4 PR-08 | 0 | 0 | 19 / 521 ✔ | 19 / 177 ✔ |
| W4 PR-12 | 0 | 0 | 21 / 602 ✔ | 20 / 186 ✔ (após fix-up 0005; antes 2 falhas C12/C13) |
| W4 PR-09 | 0 | 0 | 29 / 720 ✔ (+ `schema.test.ts`) | 23 / 212 ✔ (após fix-up 0006; antes M2/M3) — inclui `reconciliation-mysql-smoke` |
| W5 | 0 | 0 (`procurementProcessRouter.ts`) | 2 / 17 ✔ | 2 / 11 ✔ |

## 6. Gates no tree totalmente integrado (`c02a8eb`)

| Gate | Resultado |
|---|---|
| `db:migrate:release` em DB limpo | ✔ 310 linhas no ledger = 310 entries do journal; `normalized_number` + `uq_ctw_org_normalized_number` + `judgment_criterion`/`execution_regime` presentes; rerun = no-op (310) |
| `pnpm db:generate` (drift schema × snapshot) | ✔ "No schema changes, nothing to migrate" |
| `DATABASE_URL=… pnpm -s test:smoke:security` | ✔ **23 arquivos / 262 testes** passaram |
| `env -u DATABASE_URL pnpm -s test` | ✔ **298 passed \| 71 skipped arquivos; 6416 passed \| 609 skipped testes** (baseline main: 275 \| 56; 5843 \| 476). Antes do fix-up 0007: 1 falha (`rc-sec-pr-a-tenant-freeze`). |
| `pnpm -s check` | ✔ 0 erros |
| eslint `--max-warnings 0` nos 127 `.ts/.tsx` alterados vs main | ✔ 0 problemas |
| `pnpm -s lint` (repo inteiro) | ✘ pré-existente: 698 problemas (289 err / 409 warn) vs **main 763 (312 / 451)** — integração reduz, não introduz |
| `pnpm -s build` | ✔ (dist/index.js 2.6 MB) |
| `git diff --check origin/main HEAD` | ✔ limpo; `git status` limpo |
| Todas as 71 `*mysql-smoke*` sequenciais num único DB (extra) | 68 ✔ / 3 ✘ (14 testes): `invitations` (2 — **pré-existente no main**: `ctx.res.cookie is not a function`, falha também isolado no main), `ingestion-process-binding` (3) e `ingestion-promotion` (9) — **passam isolados** (poluição entre arquivos, padrão conhecido). Main no mesmo modo: 56 arquivos, 5 ✘ / 24 testes (inclui os mesmos + `document-generation` e `procurement-candidate-eligibility`). Nenhuma regressão atribuível à integração. |
| Boot validator / latest-hash | ✔ `contract-number-unique-0308` M1/M3 (`collectSchemaProblems` = [] após release) e M2 (acusa a última tag não aplicada); `schema.test.ts` ✔ |

## 7. Fix-ups que o integrador real DEVE aplicar (arquivos/linhas exatos)

Patches prontos em `integration-fixups/000N-*.patch` (aplicáveis com `git am` na mesma ordem de merge); resoluções de merge em `remerge-<sha>.diff`.

**Resoluções de merge (conflitos textuais + semânticos no próprio merge):**
- **M1** `package.json` `test:smoke:security` — união (nunca descartar path); conferir 23 paths existentes.
- **M2** `server/kernel/architecture/legacyBoundaries.ts` (~L209–210, `BOUNDARY_CLASSIFICATIONS`) — nota de `documentsRouter.ts` da LEG-009 + nota de `processesRouter.ts` da LEG-005.
- **M3** `server/routers/directProcurementRouter.ts`:
  - imports (~L24–26): `throwLegacyEndpointDisabled`; `router, tenantProcedure, orgRoleProcedure`; **um** `serviceLogger`;
  - import de domínio (~L29–31): `type DirectStartOption, type DirectProcurementType, type DirectProcurementWorkspace` (sem `DirectProcurementStage`);
  - remover o 2º `import { serviceLogger }` (após `../domain/processCreateContract`) e o 2º `const log` — manter um só `const log = serviceLogger("directProcurementRouter")` (~L70);
  - `importPriceResearch` = bloco da PR-04A (orgRoleProcedure + `idempotencyKey` + try/catch).
- **M4** `server/_core/trpc.ts` `orgRoleProcedure` (~L207–217) — implementação única da §3 W2.2 (inline + `assertOrgRoleAtLeast` + `next()`); manter `hasOrgRoleAtLeast`, `assertOrgRoleAtLeast`, import `structuredLog`.
- **M5** `server/routers/procurementProcessRouter.ts` — import de domínio: `+ type ProcurementWorkspace` (sem `ProcessStage`); após cutover: manter `resolveExistingProcurementCreate` (PR-05) **e** `assertLegacyPriceResearchPasteAllowed` (PR-04) (~L90 e ~L134).
- **M6** `server/services/legalOpinionWorkspaceService.ts` (~L39–51) — import de `../db/legalOpinionWorkspace` = `getLegalOpinionWorkspace, getLegalOpinionWorkspaceByRequest, updateLegalOpinionWorkspaceStage, getLegalOpinionDraftByWorkspace, insertLegalOpinionVersion, countLegalOpinionHistory, insertLegalOpinionHistory, listLegalOpinionHistory, listLegalOpinionVersions, claimNewLegalOpinionDraft, updateUnsignedLegalOpinionDraft, listLegalOpinionDraftsByWorkspace` + imports NEW-007 (`canRequestTransition`, `claimLegalOpinionWorkspaceForLawyer`, authority service) + `serviceLogger`.
- **M7** `server/services/contractService.ts` (~L13–55) — imports conforme §3 W4.1; um `serviceLogger`; `const log = serviceLogger("contractService")`.
- **M8** Migrações (merge da PR-09): renumeração 0308→0309 conforme §3 W4.3 (arquivo SQL, journal idx/tag/when, `0309_snapshot.json` com `prevId = b455cc58-8a20-40b4-a985-cda0e178e1d9`, referências no código/testes da PR-09). Validar com `pnpm db:generate` = sem mudanças.
- **M9** `server/__tests__/integration/collaboration-stage-assignment-atomicity-mysql-smoke.test.ts` — ficar com a versão da PR-06 (genérica por journal).

**Commits de fix-up (pós-merge):**
1. `server/routers/documentsRouter.ts:19` — remover `import { TRPCError } from "@trpc/server";` (sem uso após PR-02 + LEG-009).
2. `server/__tests__/integration/r2-leg005-legacy-items-catmat-disabled.test.ts:~255–268` — `updateStatus` agora `LEGACY_ENDPOINT_DISABLED` com evento `LEG-006` (motivo: PR-02/LEG-006).
3. `server/__tests__/unit/process-create-contract.test.ts:142` — `dp.indexOf("createProcess: orgRoleProcedure(\"operator\")")` (motivo: NEW-005).
4. `server/__tests__/integration/create-not-reset-legal-contract-mysql-smoke.test.ts` — fixture `managerA` (role `manager`, + cleanup); L1 `e4` (~L191) e L3 `eActor` (~L242) → `FORBIDDEN` + `LEGAL_OPINION_ASSIGNMENT_REQUIRED` (motivo: NEW-007); C12 (~L638) transição `vigente` pelo `managerA` (motivo: NEW-006).
5. `server/db/contractWorkspace.ts` `compareAndSetContractWorkspace` (~L166–200) — try/catch `isDuplicateKeyError` ⇒ `TRPCError CONFLICT … (CONTRACT_ALREADY_EXISTS)` (**correção de produto, não só de teste**: PR-06 × PR-12); smoke PR-06 C12/C13 enviam `expectedUpdatedAt` (motivo: PR-12 tornou o CAS obrigatório).
6. `server/__tests__/integration/contract-number-unique-0308-mysql-smoke.test.ts` — estado pré-0308 = prefixo do journal (`fromTag0308Count`); ledger M3/rerun `+ fromTag0308Count`; M2 compara com a última tag do journal (motivo: 0309 da PR-09).
7. `server/__tests__/integration/rc-sec-pr-a-tenant-freeze.test.ts:83–93` — sem `db.*(` em runtime e 16 `throwLegacyEndpointDisabled("documents.*", "LEG-008|LEG-009")` (motivo: PR-02 + LEG-009 desligam todas as procedures; contrato mais forte, cobertura não removida).

## 8. Achados para decisão (não corrigidos na simulação)

- **`insertContractWorkspace` virou código morto em produção** após PR-12 (único caller era `updateContract`); só os mocks de teste (`sprint5w-contracts`, `new006-*`, `pr12-*`, `create-not-reset-legal-contract`) o referenciam. As docstrings em `server/db/contractWorkspace.ts` (~L68–73 e ~L103: "segue restrito à edição `updateContract` — escopo da PR-12") ficaram desatualizadas. Tratamento proposto: PR de limpeza pós-integração (remover ou marcar `@deprecated`), sem pressa. Severidade: baixa.
- `contractWorkspaceRouter.ts` L19–20: dois imports de `../_core/trpc` (intencional da NEW-006 para evitar conflito) — consolidar após a integração.
- `pr09-regeneration-human-state-mysql-smoke.test.ts:440` exige que a 0309 seja a **última** entry do journal — quebrará na próxima migration (mesma fragilidade que PR-06/PR-09 já corrigiram no smoke da 0307). Sugestão: afirmar por tag, não por posição.
- `invitations-mysql-smoke` falha no main (`ctx.res.cookie is not a function`, 2 testes) — pré-existente, fora do `test:smoke:security`.
- `pnpm lint` repo-wide não está verde nem no main (763 problemas) — pré-existente.
- Graphify: regenerar o grafo uma única vez após a integração (exceção registrada nos commits das branches).

## 9. Rodada final de hardening pré-PR (2026-09-29) — W0 + reintegração completa

> Nova simulação DESCARTÁVEL, 100% local, num ambiente novo (nada herdado da execução anterior): worktree destacado sobre
> `origin/main = 5924b4a`, merges `--no-ff` locais na ordem abaixo, banco próprio (MariaDB 10.11). Nenhum merge foi enviado.
> Resoluções de merge: as dos `remerge-<sha>.diff` versionados, **reaplicadas mecanicamente** (marcadores normalizados +
> `git apply` com contexto exato — qualquer divergência abortaria); `package.json` por união; PR-09 pela M8
> (`m8-pr09-renumber-0309.py`, novo, executável e determinístico). HEAD final local: 20 merges + 10 fix-ups sobre 5924b4a.

### 9.1 Ordem executada e resultado de cada merge

| Pos. | Branch | Head | Merge |
|---|---|---|---|
| W0.1 | fix/new-016-official-document-immutability | `674662f` | limpo |
| W0.2 | fix/new-003-disable-lgpd-export | `f99fcf8` | T package.json |
| W0.3 | fix/new-022-block-generic-contract-activation | `9905413` | T package.json |
| W1.1–W1.6 | PR-02 · LEG-005 · LEG-009 · LEG-028 · LEG-032 · NEW-002 | inalterados | idem §1 (remerge 445012f/4e9a75c/7792959 reaplicados) |
| — | fix-ups 0001 · 0002 · 0007 · **0008** | | aplicados (`git am`) |
| W2.1–W2.3 | NEW-005 · NEW-006 · NEW-007 | inalterados | idem §1 (remerge 867a80e/ca50b1b/e914837) |
| W3.1–W3.3 | PR-04A · PR-05 · PR-06 | inalterados | idem §1 (remerge 76ee900/2026165/4ceff41); fix-ups 0003 · 0004 |
| W4.1–W4.2 | PR-08 · PR-12 | inalterados | idem §1 (remerge 644b689/451062c); fix-ups 0005 · **0009** · **0010** |
| W4.3 | PR-09 | `ddb148c` | T package.json, journal, 0308_snapshot (add/add), smoke colaboração ⇒ M8 (0308→0309) + M9; fix-up 0006 |
| W5.1 | cutover PR-04 | `1568c40` | idem §1 (remerge 1617065) |
| W5.2 | audit/r2-2-r2-3-prep | `7cf887e` | limpo |

**W0 não conflita semanticamente com W1–W5 no código de produto**; os ajustes foram todos em testes (0008–0010) e um
achado de typecheck corrigido na própria NEW-016 (INTEG-016-05, §9.3).

### 9.2 Revalidação dos fix-ups existentes (0001–0007)

Heads idênticos aos da execução anterior ⇒ os 7 patches aplicaram com `git am` **sem ajuste**, nos mesmos pontos, e cada
um continua necessário (o teste correspondente falha sem ele — provado na execução anterior e reconfirmado pelos gates
abaixo com o tree completo). O patch 0005 é **correção de produto** (PR-06 × PR-12), os demais são de teste/lint.

### 9.3 Fix-ups novos e ajustes em branch

| Id | Onde | Motivo | Tipo |
|---|---|---|---|
| **0008** | `new-002-account-hard-delete-mysql-smoke.test.ts` | NEW-003 desativa `exportMyData`; o smoke da NEW-002 afirmava que "continua funcionando" | teste (após NEW-002) |
| **0009** | `create-not-reset-legal-contract-mysql-smoke.test.ts` C12 | NEW-022 fecha `minuta → vigente` pelo editor genérico; C12 usava esse caminho para chegar a `vigente` | teste (após 0004 e 0005) |
| **0010** | `pr12-contract-governed-change.test.ts` | "minuta → vigente permitido via CAS" contradiz NEW-022; cobertura do CAS preservada com vigente → encerrado | teste (após PR-12/0005) |
| INTEG-016-05 | branch NEW-016 (`674662f`) | `isDuplicateKeyError` exportado por `db/procurement.ts` (PR-05) e `db/officialDocuments.ts` ⇒ TS2308 via `db/index.ts` | produto, corrigido na branch |
| NEW-016 `cde5db5` | smoke NEW-016 T8 | PR-09 recusa regenerar documento já emitido (PRECONDITION_FAILED) | teste, na branch |
| NEW-022 `961c711` | import do guard | colidia com o import inserido pela PR-12 na mesma linha | produto (só posição), na branch |
| NEW-022 `802dc88` / `9905413` | smoke NEW-022 | NEW-006 recusa viewer antes do handler; PR-12 exige `expectedUpdatedAt` e trava `object` pós-minuta | teste, na branch |

### 9.4 Migration numbering (decisão)

- PR-06 mantém **0308**; PR-09 vira **0309** somente no merge de integração (M8). **Não** renumerada agora na própria
  branch: sobre a main atual (sem a PR-06) a PR-09 precisa da 0308 para ser validável isoladamente, e renumerar criaria um
  buraco no journal (idx 308 ausente) que o validator de boot trataria como inconsistência.
- A mudança exata para depois que a PR-06 estiver na main é o script `m8-pr09-renumber-0309.py` (rebase/merge da PR-09
  sobre a nova main ⇒ SQL `0309_…`, journal idx 309 com o `when` da PR-09, `0309_snapshot.json` = snapshot 0308 da PR-06 +
  `generated_documents` da PR-09, `id d38bd35e…`, `prevId b455cc58…`, e as referências "0308" da própria PR-09). Resultado
  verificado: `pnpm db:generate` ⇒ "No schema changes".

### 9.5 Gates no tree totalmente integrado (W0–W5)

| Gate | Resultado |
|---|---|
| `pnpm -s check` | ✔ 0 erros |
| `pnpm db:generate` (drift schema × snapshot) | ✔ "No schema changes, nothing to migrate" |
| `db:migrate:release` em DB limpo | ✔ 310 linhas no ledger = 310 entries do journal (…0308_contract_number_unique_per_org, 0309_edital_institutional_parameters); `normalized_number` + `uq_ctw_org_normalized_number` + `judgment_criterion`/`execution_regime` presentes; rerun = no-op (310) |
| `DATABASE_URL=… pnpm -s test:smoke:security` (DB novo migrado) | ✔ **26 arquivos / 300 testes** (antes 23 / 262; +NEW-016 14, +NEW-003 12, +NEW-022 12) |
| `env -u DATABASE_URL pnpm -s test` | ✔ **301 passed \| 74 skipped arquivos; 6446 passed \| 647 skipped testes** (antes 298 \| 71; 6416 \| 609) |
| smokes MySQL extras das áreas do W0 (c4a, c4b1, v1-functional-closure, contrato-avulso, create-not-reset-processes, document-generation) | ✔ 6 / 62 |
| eslint `--max-warnings 0` nos 137 `.ts/.tsx` alterados vs main | ✔ 0 problemas |
| `pnpm -s lint` (repo inteiro) | ✘ pré-existente: 698 (289 err / 409 warn) — **idêntico** ao tree anterior; W0 não introduz nenhum; main = 763 |
| `pnpm -s build` | ✔ |
| `git diff --check origin/main HEAD` | ✔ limpo |

**Pares descartáveis exigidos (cada um sobre main + as duas branches, com os testes das duas frentes):**

| Par | Textual | Semântico | Resultado |
|---|---|---|---|
| NEW-016 × PR-09 | package.json | T8 da NEW-016 × regra "emitido não regenera" da PR-09 ⇒ ajustado na NEW-016 (`cde5db5`) | ✔ smokes NEW-016 14 + PR-09 10 + C.4B.1 12 + C.4A 7; unit/integração 100/100; check 0 |
| NEW-016 × cutover PR-04 / PR-04A | package.json | nenhum (PR-04 não toca Document Engine) | ✔ (merge-tree) — coberto pelo tree completo |
| NEW-016 × PR-05 | limpo | TS2308 `isDuplicateKeyError` ⇒ corrigido na NEW-016 (`674662f`) | ✔ check 0 |
| NEW-003 × NEW-002 (2 ordens) | package.json | smoke NEW-002 "exportMyData funciona" ⇒ **0008** | ✔ 19/19 smokes + 27/27 unit; check 0; eslint 0 |
| NEW-022 × NEW-006 | package.json | viewer recusado pelo RBAC antes do handler ⇒ smoke NEW-022 ajustado (`802dc88`) | ✔ NEW-022 12/12; NEW-006 smoke + unit 121/121 |
| NEW-022 × PR-06 | package.json | C12 ativava pelo editor genérico ⇒ **0009** | ✔ (C12 verde no tree completo) |
| NEW-022 × PR-08 | package.json | nenhum | ✔ 41/41 smokes + 65/65 unit |
| NEW-022 × PR-12 | package.json (após `961c711`) | CAS obrigatório (smoke NEW-022 ajustado, `9905413`) + teste PR-12 "minuta → vigente via CAS" ⇒ **0010** | ✔ NEW-022 12/12; PR-12 51/51 com 0010 |
