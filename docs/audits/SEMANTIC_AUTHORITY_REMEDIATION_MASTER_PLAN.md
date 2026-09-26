# Programa Mestre de Remediação — Autoridade Semântica (documento vivo)

> **Roadmap:** v1.0 — congelado em 2026-09-26 (esta PR documental).
> **Baseline:** [`SEMANTIC_AUTHORITY_CROSS_MODULE_AUDIT.md`](./SEMANTIC_AUTHORITY_CROSS_MODULE_AUDIT.md) —
> auditoria sobre a main `5903cda`, versionada **byte-idêntica** ao arquivo produzido na auditoria
> (sha256 `08edc7344c9038889978e1b2f9204f4fd523e3fef36e6b29b47ff324ae0810b3`). O baseline **não** é editado para
> acomodar decisões: ele responde "o que foi encontrado naquele momento". Frases do baseline como "este arquivo NÃO
> está commitado" descrevem o estado na data da auditoria.
> **Escopo desta versão:** triagem dos 26 P0 (FIX / CUTOVER / DISABLE / LEGAL REVIEW), reachability, dependências,
> plano de PRs, invariantes, fases R0–R11, checkpoints e Master Progress Ledger. **Nenhuma correção implementada.**

---

## 1. Regras de governança do programa

1. **Pergunta obrigatória antes de qualquer correção:** *"Este caminho deve continuar existindo?"* — considerar
   REACHABILITY + USO + CAMINHO CANÔNICO + IMPACTO DE DESATIVAÇÃO. Não remendar profundamente fluxo legado que deve sair.
2. **Estratégias (exatamente quatro):**
   - **FIX** — fluxo válido/estratégico que continua no produto (ou infraestrutura compartilhada necessária) e remover não resolve.
   - **CUTOVER** — comportamento em fluxo legado ou ramo legado com substituto canônico definido; redirecionar/bloquear o antigo preservando a operação.
   - **DISABLE** — caminho redundante/inseguro/sem justificativa de continuidade; bloquear/retirar de forma governada.
   - **LEGAL REVIEW** — depende de interpretação jurídica/normativa; técnica não decide.
3. **Alcance (reachability):** `CANONICAL` · `LEGACY_REACHABLE` · `LEGACY_INERT` · `SHARED_INFRA` · `UNKNOWN`.
   "Arquivo existe" ≠ "fluxo operacionalmente acessível". Rota tRPC montada é alcançável por qualquer cliente autenticado
   mesmo sem botão — isso é registrado explicitamente. **Alcance ≠ explorabilidade:** `LEGACY_REACHABLE` significa
   "superfície (rota de UI ou API) ainda montada/alcançável", **não** "explorável por qualquer usuário sem pré-condição".
   Pré-condições de exploração (dados preexistentes, permissões) são registradas à parte, como
   **Exploitability / Preconditions**.
4. **Progresso** = checkpoints `PASS` / checkpoints congelados. Nada de percentual subjetivo. `IN_PROGRESS`, `BLOCKED` e
   `SUPERSEDED` não contam. PR aberta ≠ CI verde ≠ merge ≠ deploy SUCCESS ≠ comportamento validado em produção.
5. **Controle de mudança:** checkpoints congelados só mudam com nova versão do roadmap (v1.1, v2.0…), registrando
   motivo, data e checkpoints afetados (ver §10). Checkpoint removido vira `SUPERSEDED`, nunca some.
6. **Proibições permanentes até autorização explícita:** mutação de dados de produção, SQL manual, alteração de feature
   flag, migration não revisada, merge/deploy sem autorização humana.
7. **Bloco obrigatório:** toda execução desta frente termina com o bloco *PROGRESSO MESTRE — REMEDIAÇÃO DA AUDITORIA
   SEMÂNTICA* (§11), com todos os percentuais.

---

## 2. Evidência de reachability usada na triagem (main `5903cda`)

- **Menu (DashboardLayout):** `/dashboard`, `/centro-operacoes`, `/processos`, `/contratacao-direta`, `/parecer`,
  `/contratos`, `/tirar-duvidas`, `/templates`, `/usuarios`*, `/configuracoes`*, `/admin/platforms`**, `/admin/organizacoes`**.
- **Canônicos por rota de menu:** `/processos` → `ProcessoLicitatorio`; `/contratacao-direta` → `DirectProcurement`
  (`DirectProcurementHome`); `/parecer` → `ParecerJuridico` (`LegalOpinionHome`); `/contratos` → `ContratosWorkspace`
  (`ContractsHome`/`ContractWorkspace`).
- **Legados roteados só por deep link (sem entrada de menu nem link do fluxo canônico):** `/contratacao-direta/novo`
  (`NewDirectContract`), `/contratacao-direta/analytics`, `/contratacao-direta/:id` (`DirectContractDetails`),
  `/contratos/novo|alertas|:id` (`NewContract`, `ContractAlerts`, `ContractDetails`), `/parecer/novo|analytics|:id`
  (`NewLegalOpinion`, `LegalOpinionsAnalytics`, `LegalOpinionDetails`), `/analytics`, `/auditoria`, `/gestao-departamento`.
  Único link encontrado entre eles: `DirectContractDetails` → `/contratos/novo` e `/parecer/novo` (legado→legado).
- **Não roteado:** `pages/ProcessDetails.tsx` (e sua subárvore: `MembersDialog`, `DocTabContent` → `StageAssignmentPanel`);
  teste `pr-b-canonical-wiring.test.ts:32` proíbe importá-lo em `App.tsx`.
- **Routers montados** (`server/routers.ts`): inclusive os legados `processes`, `documents`, `collaboration`,
  `directContracts`, `contracts`, `legalOpinions`, `approvalWorkflow` → alcançáveis por API. Estar montado não implica que
  toda mutation execute: `processes.create` permanece registrada, mas chama `throwLegacyProcessPipelineDisabled()`
  (`server/routers/processesRouter.ts:84`, `server/domain/legacyPipeline.ts`) e responde com o erro governado
  `LEGACY_PROCESS_PIPELINE_DISABLED` — não cria processo legado.

---

## 3. Inventário mestre dos 26 P0 (Fase R0)

Estado inicial de todos: **TRIAGED** (classificação comprovada pela evidência abaixo e no baseline).

| ID | Módulo | Problema resumido | Reachable? (evidência) | Canônico/Legado | Estratégia | Dependência | Migration? | Legal review? | PR alvo | Estado |
|---|---|---|---|---|---|---|---|---|---|---|
| SEM-001 | Colaboração | `addMember`/`assignStage` (e demais mutations do router) com lookups globais (processo, e-mail/id do usuário-alvo): membro e responsável de outro tenant, enumeração de e-mail | Superfície **API-reachable** (router `collaboration` montado, `protectedProcedure`); UI (`ProcessDetails`) não roteada. **Exploitability / Preconditions:** exige processo legado **preexistente** ao qual o chamador tenha autorização (dono/approver); `processes.create` está **desativado** (`LEGACY_PROCESS_PIPELINE_DISABLED`); existência dessas linhas em produção **não verificada** | LEGACY_REACHABLE (superfície API) | **FIX** (isolamento mínimo, fail-closed; desativação da superfície avaliada em R2) | — | Não (auditoria read-only de linhas cross-org, se autorizada) | Não | PR-01 | TRIAGED |
| SEM-002 | Processo Licitatório | `createProcess` com número existente reseta etapa/status | Sim: `NovoProcessoWizard` em `/processos` | CANONICAL | **FIX** | padrão R3 | Não | Não | PR-05 | TRIAGED |
| SEM-003 | Contratação Direta | `createProcess` reseta workspace (tipo, fundamento, etapa, flags) | Sim: `NewDirectProcurementWizard` em `/contratacao-direta` | CANONICAL | **FIX** | padrão R3 | Não | Não | PR-05 | TRIAGED |
| SEM-004 | Contratação Direta | Ratificação: default "ratificado", clicante como autoridade, upsert mantém 1º responsável | Sim: `RatificationWorkspace` | CANONICAL | **FIX** | R3 (upsert) + insumo jurídico sobre competência | **Sim** (ledger de decisão) | Parcial (quem é autoridade competente) | PR-07 | TRIAGED |
| SEM-005 | Pesquisa de Preços | 2ª colagem sobrescreve cotações da 1ª | Sim: `LegacyPriceResearchPanel` quando a ingestão por arquivo está desligada ou a consulta de capabilities falha | LEGACY_REACHABLE | **CUTOVER** → `DocumentIngestionLauncher` (`allowPaste`) | Decisão humana sobre `FF_CANONICAL_INGESTION` por tenant | Não | Não | PR-04 | TRIAGED |
| SEM-006 | Parecer (canônico) | `createDraft` reseta parecer assinado | Sim: `LegalOpinionEditor` em `/parecer` | CANONICAL | **FIX** | padrão R3 | Não | Não | PR-06 | TRIAGED |
| SEM-007 | Contratos | Upsert por (origem, número) sobrescreve contrato vigente | Sim: `NewContractWizard` em `/contratos` | CANONICAL | **FIX** | padrão R3 | Não | Não | PR-06 | TRIAGED |
| SEM-008 | ETP/TR/Edital | Sem Itens da Contratação, quantidade da cotação vira quantidade da contratação | Sim: ramo legado dentro do fluxo canônico (`authoringContext`/`editalContext`) | CANONICAL (ramo legado) | **CUTOVER** → Itens da Contratação obrigatórios (fail-closed) | Inventário read-only de processos sem Itens + decisão humana | Não | Não | PR-13 | TRIAGED |
| SEM-009 | Edital | Parâmetros não hidratados; "Gerar edital" usa padrões | Sim: `EditalWorkspace` | CANONICAL | **FIX** | — | Não | Não | PR-09 | TRIAGED |
| SEM-010 | Contratação Direta (legado) | Catálogo mistura hipóteses da Lei 8.666 na numeração 14.133; mapeamento por substring | Sim, deep link `/contratacao-direta/novo` + API `directContracts` | LEGACY_REACHABLE | **LEGAL REVIEW** | Parecer jurídico; reference set governado (estado em produção não confirmado) | Dados (a definir) | **Sim** | PR-18 → PR-19 | TRIAGED |
| SEM-011 | Contratos (legado) | Limite de aditivo 50% para todo contrato; supressão compensada; prazo 120 meses | Sim, deep link `/contratos/:id` (`NewAmendmentModal`) + API `contracts` | LEGACY_REACHABLE | **LEGAL REVIEW** | Parecer jurídico (art. 125) — também informa limites dos aditivos canônicos (SEM-084, P1) | Não | **Sim** | PR-18 → PR-20 | TRIAGED |
| SEM-012 | Contratação Direta (legado) / relatórios | Centavos exibidos como reais; valor estimado rotulado "Valor Total Contratado" | Sim, deep link `/contratacao-direta/analytics`, `AuditTimeline` em `/contratacao-direta/:id`; relatório de processo só via API | LEGACY_REACHABLE | **CUTOVER** → Contratação Direta canônica / Centro de Operações (formatador monetário único vira invariante) | Verificação read-only de uso de `direct_contracts` | Não | Não | PR-14 | TRIAGED |
| SEM-013 | Document Engine | Versões emitidas reexportam cabeçalho com identidade institucional atual | Sim: `OfficialPromotionSection` + export oficial | CANONICAL | **FIX** | — | Não (decisão de backfill documentada) | Não | PR-15 | TRIAGED |
| SEM-014 | ETP/TR/Edital | Regerar sobrescreve rascunho editado por humano sem confirmação | Sim: workspaces ETP/TR/Edital | CANONICAL | **FIX** | — | Não | Não | PR-09 | TRIAGED |
| SEM-015 | Processo Licitatório | `updateStage` leva a ISSUED/"emitido" sem Edital oficial | API apenas (`orgRoleProcedure("operator")`); **nenhum caller de UI** | CANONICAL (endpoint sem uso) | **DISABLE** (endpoint genérico de salto de etapa; emissão só por `issueProcess`) | — | Não | Não | PR-02 | TRIAGED |
| SEM-016 | Parecer (legado) | Aprovador do cliente, autor aprova, aprovado editável, export acompanha, assinado excluível | Sim, deep link `/parecer/:id` (`LegalOpinionDetails`) + API `legalOpinions` | LEGACY_REACHABLE | **CUTOVER** → workspace canônico do parecer (`/parecer`) | Verificação read-only de uso de `legal_opinions` | Não | Não | PR-03 | TRIAGED |
| SEM-017 | Parecer (legado) | IA sobrescreve parecer assinado, inclusive a conclusão | Idem SEM-016 | LEGACY_REACHABLE | **CUTOVER** → workspace canônico (IA só como apoio) | Idem SEM-016 | Provável (se o legado precisar de modo somente-leitura com versão) | Não | PR-03 | TRIAGED |
| SEM-018 | Documentos (legado) | `documents.approveDocument` aprova de qualquer status, sem SoD/papel | API apenas; **nenhum caller de UI** | LEGACY_INERT (API montada) | **DISABLE** | — | Não | Não | PR-02 | TRIAGED |
| SEM-019 | Parecer (canônico) | Editor abre vazio e com "Favorável"; salvar apaga campos | Sim: `LegalOpinionEditor` | CANONICAL | **FIX** | PR-06 (mesma persistência) | Não | Não | PR-10 | TRIAGED |
| SEM-020 | Contratação Direta | "Anexar/Validar" grava referência fictícia `s3://anexo` | Sim: `RequiredDocumentsWorkspace` | CANONICAL | **FIX** | — | Não | Não | PR-16 | TRIAGED |
| SEM-021 | Contratação Direta | Justificativa por copilotos vira documento oficial sem aceite | Sim: `ContractJustificationWorkspace` | CANONICAL | **FIX** | padrão R3 (upsert) | Não | Não | PR-11 | TRIAGED |
| SEM-022 | Contratação Direta | Justificativa de preço: formulário vazio sobrescreve e emite oficial | Sim: `PriceJustificationWorkspace` | CANONICAL | **FIX** | padrão R3 (upsert) | Não | Não | PR-11 | TRIAGED |
| SEM-023 | Contratos | "Salvar contrato" altera valor/contratado/objeto de vigente sem aditivo e sem CAS | Sim: `ContractEditor` | CANONICAL | **FIX** | — | Não | Não | PR-12 | TRIAGED |
| SEM-024 | Contratos | Termo Aditivo/Apostilamento ignora os dados do instrumento | Sim: `DocumentsWorkspace`/`AddendumWorkspace` | CANONICAL | **FIX** | — | Não | Não | PR-17 | TRIAGED |
| SEM-025 | Contratos | Aditivo/apostilamento muda status contornando a máquina de estados (ressuscita rescindido) | Sim: `AddendumWorkspace`/`ApostilleWorkspace` | CANONICAL | **FIX** | — | Não | Não | PR-08 | TRIAGED |
| SEM-026 | Itens Inteligentes | `approveItem`/`decidirCATMAT` com `tenantProcedure` (viewer aprova) | `decidirCATMAT` **usado pela UI** (`ProcurementItemPanel`); `itemIntelligence.approveItem` sem caller (UI usa `procurementProcess.approveItem`, que exige operator) | CANONICAL | **FIX** (paridade RBAC em `decidirCATMAT`; rota duplicada `approveItem` retirada no mesmo PR) | — | Não | Não | PR-08 | TRIAGED |

### 3.1 Distribuições

| Estratégia | Qtd | IDs |
|---|---:|---|
| FIX | 17 | 001, 002, 003, 004, 006, 007, 009, 013, 014, 019, 020, 021, 022, 023, 024, 025, 026 |
| CUTOVER | 5 | 005, 008, 012, 016, 017 |
| DISABLE | 2 | 015, 018 |
| LEGAL REVIEW | 2 | 010, 011 |
| **Total** | **26** | |

| Alcance | Qtd | IDs |
|---|---:|---|
| CANONICAL | 18 | 002, 003, 004, 006, 007, 008, 009, 013, 014, 015, 019, 020, 021, 022, 023, 024, 025, 026 |
| LEGACY_REACHABLE | 7 | 001, 005, 010, 011, 012, 016, 017 |
| LEGACY_INERT | 1 | 018 |
| SHARED_INFRA | 0 | — |
| UNKNOWN | 0 | — |

**Correção de reachability em relação ao baseline (registrada aqui, baseline intocado):** o baseline descreve SEM-001
como "canônico/legado-UI (usado por MembersDialog, StageAssignmentPanel)". A triagem confirmou que esses componentes
só existem sob `ProcessDetails`, **não roteado**; a superfície permanece **alcançável por API** (`collaboration.*`
montado). A exploração bem-sucedida depende de um processo legado preexistente ao qual o chamador tenha acesso — não é
possível criá-lo hoje por `processes.create` (bloqueado por `LEGACY_PROCESS_PIPELINE_DISABLED`), e a existência dessas
linhas em produção não foi verificada. A severidade P0 se mantém: o isolamento de tenant incompleto é falha estrutural e
deve ser fail-closed independentemente do estado atual dos dados (ver §3.2 e o registro de correção factual em §9.1). Igualmente, SEM-026: a rota `itemIntelligence.approveItem` não tem caller de UI,
mas `decidirCATMAT` (mesma falha de papel) tem.

### 3.2 SEM-001 — confirmação e decisão

- **A. Alcance por API (confirmado):** o router `collaboration` está montado. `addMember`, `removeMember`,
  `updatePermission`, `updateFunctionalRole`, `assignStage` e `unassignStage` são `protectedProcedure` e resolvem o
  processo com `db.getProcessById` (global). O usuário-alvo é resolvido por `db.getUserByEmail` (global, em `addMember`) ou
  `db.getUserById` (global, em `removeMember`/`updatePermission`/`updateFunctionalRole`/`assignStage`). Nenhum desses pontos
  exige que o usuário-alvo pertença ao tenant do chamador. `listMembers`/`checkPermission` resolvem o processo por
  organização, mas devolvem nome/e-mail dos membros sem verificar se pertencem ao tenant.
- **B. Explorabilidade:** para as mutations passarem das checagens atuais de dono/membro/permissão, é preciso existir um
  processo legado ao qual o chamador tenha autorização suficiente. Com isso satisfeito, o código permite enumerar e-mails
  de outros tenants ("Usuário não encontrado"), incluir usuário de outro órgão como membro ou "responsável pela etapa",
  enviar notificação com o nome do processo a pessoa de outro órgão e gravar no activity log o nome de pessoa de outro órgão.
- **C. Bootstrap:** **não** é possível criar hoje esse processo por `processes.create`: a mutation está registrada, mas
  executa `throwLegacyProcessPipelineDisabled()` e responde com `LEGACY_PROCESS_PIPELINE_DISABLED`.
- **D. Produção:** **não verificado** se existem processos legados persistidos que satisfaçam a pré-condição. Nenhuma
  leitura de produção foi feita; ela exigiria autorização explícita. Não há evidência de exploração ativa.
- **Classificação final:** **FIX** — correção mínima e fail-closed do isolamento (tenant-scoped lookups; usuário-alvo
  precisa ser membro do tenant; mensagens neutras). Não é investimento no fluxo legado: é fechar a exposição. A segurança
  não pode depender de "provavelmente não há dados legados" — uma reativação futura, uma linha legada existente ou uma
  chamada legítima do fluxo reexporia o problema. **Severidade P0 mantida.** A **retirada definitiva** das superfícies
  legadas (`collaboration`, o pipeline `processes` legado e os demais endpoints antigos) é decisão de lifecycle da **R2**
  (checkpoint R2.1); a **R1** corrige a segurança. As duas fases não se misturam.
- **Teste de reprodução (R1.1, não implementado):** **não** deve depender de `processes.create`. Deve montar fixtures de
  banco controladas — tenant A, tenant B, processo legado do tenant A, usuário do tenant A (dono), usuário do tenant B — e
  demonstrar diretamente a resolução cross-tenant do usuário-alvo ou a inclusão de membro/atribuição de etapa cross-tenant,
  conforme o código real permitir.
- **Prioridade:** **primeira PR funcional (PR-01 — Tenant Isolation — Collaboration).**

---

## 4. Classes dos P0

| Classe | P0 | Observação |
|---|---|---|
| **Segurança / tenant** | 001 | isolado; primeira PR |
| **Create ≠ Reset** (ID determinístico + upsert) | 002, 003, 005, 006, 007 (+ parte de 004, 021, 022) | distinguir: (A) idempotência correta — mesmo payload converge; (B) **upsert destrutivo** — 002/003/005/006/007 e o registro de 004/021/022; (C) criação duplicada — não é o caso atual; (D) recuperação de registro — `insertItemIfAbsent` dos Itens (P1 SEM-069); (E) atualização legítima — deve ser uma operação `update` explícita, nunca um `create` |
| **Autoridade** (quem clicou = autoridade) | 004, 016, 026 (+ 001 responsável de outro tenant, 018 aprovação sem SoD) | mesma classe corrigida na #258 (`responsibleUser` ≠ responsável pela demanda) |
| **Decisão humana** (editor vazio, regenerar, default decisório, formulário que sobrescreve, IA substituindo revisado) | 009, 014, 017, 019, 021, 022, 023 | 017 e 021 envolvem IA |
| **Fallback semântico** | 008 (qtd cotada → necessidade), 012 (centavos/estimado → contratado), 009 (modalidade/plataforma padrão) | 009 também em "decisão humana" |
| **Documento oficial / evidência** | 013 (cabeçalho vivo), 016 (aprovado editável), 020 (evidência fictícia), 024 (termo ignora instrumento) | |
| **Workflow / máquina de estados** | 015, 025 (+ 004) | |
| **Jurídica (LEGAL REVIEW)** | 010, 011 (+ insumo em 004: competência da autoridade) | não decidir solução jurídica tecnicamente |

---

## 5. Dependências reais (DAG conceitual)

```
R0 baseline/triagem
 ├─► R1 SEM-001 (independente; primeira PR funcional)
 ├─► R2 reachability & cutover ──► decisões humanas: FF_CANONICAL_INGESTION (SEM-005);
 │        uso de legal_opinions/direct_contracts/contracts/processes (SEM-016/017/012) — leitura autorizada
 │        PR-02 (SEM-015, SEM-018) sem dependência
 ├─► R3 create≠reset (PR-05, PR-06) ──► R4 ratificação (PR-07; também depende de insumo jurídico)
 │                                   └─► R5 PR-10 (editor do parecer usa a persistência do PR-06)
 │                                   └─► R5 PR-11 (justificativas usam o mesmo padrão de upsert)
 ├─► R4 PR-08 (RBAC/estados; independente)
 ├─► R5 PR-09 (regerar/Edital; independente), PR-12 (contrato; independente)
 ├─► R6 PR-13 (depende de inventário read-only + decisão sobre processos legados); PR-14 (depende de R2)
 ├─► R7 PR-15, PR-16, PR-17 (independentes entre si)
 └─► R8 PR-18 (pacote jurídico) ──► parecer jurídico ──► PR-19, PR-20
R9 (P1) após R1–R8 por classe; R10 (P2/docs) após R9; R11 (guards + re-auditoria) fecha o programa.
```

O código **não** exige a ordem "tenant → cutover → authority → human-state → fallbacks → snapshots" de forma estrita:
R3 é pré-requisito real de R4 (ratificação) e de parte de R5; R7 e PR-08/09/12 são independentes e podem correr em paralelo
depois de R1, respeitando revisão humana e uma PR por vez em produção.

---

## 6. Plano consolidado de PRs para os P0

O plano inicial de 17 PRs do baseline foi **revisado** após a triagem: parecer e contratação direta legados deixaram de
receber correção profunda (CUTOVER/DISABLE), e PRs multi-módulo foram divididas para manter escopo limitado.

| PR | Objetivo | Achados | Tipo | Dependências | Migration | Risco | Gate de validação |
|---|---|---|---|---|---|---|---|
| **PR-01** | Tenant Isolation — Collaboration | SEM-001 | SECURITY | — | Não | baixo | teste que reproduz o cross-tenant falha antes/passa depois; regressão same-tenant; smoke de segurança; CI verde; validação em produção |
| PR-02 | Retirar endpoints inseguros sem uso | SEM-015, SEM-018 | CUTOVER (DISABLE) | — | Não | baixo | chamadas retornam erro governado; `issueProcess` intacto; freeze test das rotas |
| PR-03 | Cutover do parecer legado | SEM-016, SEM-017 | CUTOVER | R2.3 (uso de `legal_opinions`) | Provável | médio | deep links redirecionam ao workspace canônico; mutações legadas bloqueadas; histórico legível |
| PR-04 | Cutover da pesquisa colada | SEM-005 | CUTOVER | R2.2 (decisão sobre a flag) | Não | médio | colagem passa pela ingestão supervisionada; sem sobrescrita de cotações |
| PR-05 | Create ≠ Reset — processos | SEM-002, SEM-003 | DOMAIN | — | Não | médio | smoke MySQL: 2º create com mesmo número ⇒ CONFLICT; retry idempotente converge |
| PR-06 | Create ≠ Reset — parecer e contrato | SEM-006, SEM-007 | DOMAIN | — | Não | médio | idem; parecer assinado imutável na persistência |
| PR-07 | Ratificação governada | SEM-004 | WORKFLOW | PR-05, R8/insumo de competência | **Sim** (ledger de decisão) | médio | decisão obrigatória; `decidedBy` ≠ `recordedBy`; superação explícita; teste que protegia o default reescrito |
| PR-08 | Paridade RBAC e máquina de estados do contrato | SEM-026, SEM-025 | WORKFLOW | — | Não | baixo | viewer recusado; estado terminal não reabre |
| PR-09 | Regerar sem perder edição + parâmetros do Edital hidratados | SEM-014, SEM-009 | UX-EXPLAINABILITY | — | Não | médio | regerar sobre edição humana sem `confirmReplace` ⇒ recusa; diff visível; parâmetros persistidos |
| PR-10 | Editor do parecer hidrata e não impõe conclusão | SEM-019 | UX-EXPLAINABILITY | PR-06 | Não | baixo | teste de hidratação; vazio não apaga conteúdo |
| PR-11 | Justificativas da Contratação Direta supervisionadas | SEM-021, SEM-022 | UX-EXPLAINABILITY | PR-05 | Não | médio | IA vira sugestão; oficial só após aceite; formulário hidrata |
| PR-12 | Contrato vigente só muda por instrumento | SEM-023 | DOMAIN | — | Não | médio | CAS de revisão; campos econômicos bloqueados fora de aditivo/apostila |
| PR-13 | Quantidade cotada nunca vira necessidade | SEM-008 | CUTOVER | R6.1/R6.2 | Não | médio | TR/Edital fail-closed sem Itens; testes legados reescritos |
| PR-14 | Saídas legadas de valor da Contratação Direta | SEM-012 | CUTOVER | R2.3 | Não | baixo | saídas legadas redirecionadas/retiradas; formatador único coberto por teste |
| PR-15 | Snapshot institucional na emissão | SEM-013 | DOCUMENT | — | Não (backfill documentado à parte) | baixo | versão emitida exporta cabeçalho da época |
| PR-16 | Evidência documental real | SEM-020 | DOCUMENT | — | Não | médio | anexar exige upload S3 real; validar exige anexo |
| PR-17 | Termos a partir do instrumento | SEM-024 | DOCUMENT | — | Não | médio | termo reflete justificativa/novo valor/prazo do instrumento; IA rotulada |
| PR-18 | Pacote de consulta jurídica (documental) | SEM-010, SEM-011 | LEGAL | — | Não | nenhum (docs) | pacote enviado; parecer recebido e registrado |
| PR-19 | Catálogo legal conforme parecer | SEM-010 | LEGAL | PR-18 + parecer | Dados | alto | conferência jurídica do conteúdo |
| PR-20 | Limites de aditivo conforme parecer | SEM-011 | LEGAL | PR-18 + parecer | Não | alto | conferência jurídica; testes de limite |

**Resultado:** **19 PRs funcionais** (PR-01..PR-17, PR-19, PR-20 — as duas últimas condicionadas ao parecer jurídico)
+ **1 PR documental** (PR-18). P1/P2 ficam para R9/R10, com plano próprio a aprovar (R9.1).

**Migrations futuras previstas:** P0 — PR-07 (ledger de decisão da ratificação), PR-03 (provável), PR-19 (dados).
P1 (R9, a planejar) — método/exclusão de cotação (SEM-027), `contractedValue` (SEM-032), lineage de aditivos (SEM-040),
itens do contrato (SEM-062), índice de lotes (SEM-067), sequência de timeline (SEM-076), backfill + NOT NULL de
`organizationId` em `documents` (SEM-079), unicidade de `contracts.number` por órgão (SEM-085).

**Itens para validação jurídica:** SEM-010 (hipóteses e incisos dos arts. 74/75 e limites de valor), SEM-011 (art. 125:
limites de acréscimo/supressão, prazos), insumo em SEM-004 (autoridade competente para ratificar; obrigatoriedade de
parecer prévio), e — para R9 — SEM-084 (limites de aditivos no fluxo canônico) e SEM-091 (credenciamento como regime).

---

## 7. Invariantes mestres

| ID | Invariante | Base na auditoria |
|---|---|---|
| INV-01 | Toda fonte só pode afirmar fatos autorizados semanticamente (e toda escrita no ledger passa pela política). | #258, SEM-037 |
| INV-02 | Create nunca reseta estado institucional existente silenciosamente. | SEM-002/003/005/006/007 |
| INV-03 | Todo lookup sensível é tenant-scoped (`organizationId` do contexto, nunca do input). | SEM-001, SEM-073, SEM-079 |
| INV-04 | Nenhuma substituição ocorre sem exibir valor atual, valor proposto e origem. | #258, SEM-052/055 |
| INV-05 | Decisão humana não é apagada por reload/regenerate. | SEM-009/014/019/022/023 |
| INV-06 | IA não afirma decisão institucional (fato, conclusão, status, preço, quantidade, documento oficial) sem aprovação humana. | SEM-017/021/024/034 |
| INV-07 | Documento oficial consome snapshot/versão imutável. | SEM-013 |
| INV-08 | Status de um domínio não implica status de outro sem transição institucional explícita. | SEM-015/025/030/064/065 |
| INV-09 | `sourceQuantity` nunca afirma `plannedQuantity`. | SEM-008 |
| INV-10 | Fingerprint é matching, não identidade. | verificado OK nos Itens; manter |
| INV-11 | Mesma chave de idempotência + payload diferente = conflito. | SEM-048, SEM-075 |
| INV-12 | Documento aprovado/oficial nunca é reescrito silenciosamente. | SEM-013/016/051/078 |
| INV-13 | Autor/operador/criador não vira autoridade institucional por conveniência. | #258, SEM-004/016 |
| INV-14 | Valor derivado não ganha autoridade apenas por estar disponível. | SEM-027/028/032 |
| INV-15 | Fluxo legado sem função estratégica é retirado, não perpetuamente remendado. | triagem §3 |
| INV-16 | Valor monetário persistido em centavos é formatado por um único formatador e rotulado pelo significado (estimado, referência, adjudicado, contratado). | SEM-012 |
| INV-17 | Regra institucional crítica existe no servidor/domínio; esconder botão não é controle. | SEM-017, SEM-026 |

---

## 8. Fases e checkpoints (congelados em v1.0)

Cada fase: início = checkpoint 1 em `IN_PROGRESS`; gate = último checkpoint; 100% = todos `PASS`.
"merged" sempre implica CI verde na PR **e** na main pós-merge; "produção validada" = deploy SUCCESS + health + logs +
verificação comportamental read-only do caso.

**R0 — Baseline e triagem (10)**
R0.1 relatório baseline versionado · R0.2 26 P0 extraídos e conferidos · R0.3 26 P0 classificados
FIX/CUTOVER/DISABLE/LEGAL REVIEW · R0.4 reachability registrada para os 26 · R0.5 canônico/legado/shared infra registrado ·
R0.6 dependências mapeadas · R0.7 plano de PRs consolidado · R0.8 invariantes mestres documentadas · R0.9 PR documental
aberta · R0.10 PR documental com CI verde.

**R1 — Tenant Isolation / Security (10)**
R1.1 reproduzir SEM-001 em teste controlado · R1.2 contrato tenant-scoped definido · R1.3 correção Domain/DB ·
R1.4 correção Service/router · R1.5 frontend/member resolution (se necessário; senão registrar N/A com evidência → PASS) ·
R1.6 testes cross-tenant · R1.7 regressão same-tenant · R1.8 auditoria/observabilidade · R1.9 CI verde (PR e main) ·
R1.10 produção validada.

**R2 — Legacy Reachability & Cutover (7)**
R2.1 inventário congelado de superfícies legadas montadas (rota, menu, caller, API) com decisão FIX/CUTOVER/DISABLE por
superfície (inclui `collaboration`, o pipeline `processes` legado — cuja criação já está desativada — e os demais endpoints antigos) · R2.2 decisão humana registrada sobre `FF_CANONICAL_INGESTION` por
tenant (SEM-005) · R2.3 verificação read-only **autorizada** de uso de dados legados (`legal_opinions`, `direct_contracts`,
`contracts`, `processes`) · R2.4 PR-02 merged · R2.5 PR-03 merged · R2.6 PR-04 merged · R2.7 produção validada
(superfícies retiradas respondem erro governado; fluxo canônico intacto).

**R3 — Create ≠ Reset (6)**
R3.1 testes MySQL que reproduzem o reset de SEM-002/003/006/007 (falham antes) · R3.2 contrato "CONFLICT em chave natural
existente; convergência só com mesmo payload" documentado · R3.3 PR-05 merged · R3.4 PR-06 merged · R3.5 regressão de
retry idempotente verde · R3.6 produção validada.

**R4 — Authority & Institutional Roles (7)**
R4.1 contrato de autoridade definido (`decidedBy`/`recordedBy`, papéis mínimos) · R4.2 insumo jurídico sobre competência
da ratificação registrado · R4.3 migration aditiva do ledger de decisão revisada · R4.4 PR-07 merged · R4.5 PR-08 merged ·
R4.6 testes que protegiam o default "ratificado" reescritos · R4.7 produção validada.

**R5 — Human State Preservation (7)**
R5.1 guard de hidratação de formulário (teste) criado · R5.2 PR-09 merged · R5.3 PR-10 merged · R5.4 PR-11 merged ·
R5.5 PR-12 merged · R5.6 teste "regerar sobre edição humana sem confirmação ⇒ recusa" verde · R5.7 produção validada.

**R6 — Semantic Fallbacks: Quantity/Price/Unit (6)**
R6.1 inventário read-only autorizado de processos sem Itens da Contratação · R6.2 decisão humana sobre esses processos ·
R6.3 PR-13 merged · R6.4 testes que codificavam o legado reescritos · R6.5 PR-14 merged · R6.6 produção validada.

**R7 — Official Document Snapshot & Immutability (6)**
R7.1 PR-15 merged · R7.2 decisão documentada de backfill de snapshot das versões já emitidas · R7.3 PR-16 merged ·
R7.4 PR-17 merged · R7.5 guard de imutabilidade de documento aprovado/emitido (teste) · R7.6 produção validada.

**R8 — Legal Rules Review (6)**
R8.1 PR-18 (pacote de consulta) merged · R8.2 parecer jurídico sobre catálogo arts. 74/75 recebido e registrado ·
R8.3 parecer sobre art. 125 recebido e registrado · R8.4 PR-19 merged · R8.5 PR-20 merged · R8.6 produção validada.

**R9 — P1 Structural Remediation (10)**
R9.1 plano de PRs dos 54 P1 aprovado (com triagem FIX/CUTOVER/DISABLE/LEGAL REVIEW) · R9.2 grupo autoridade/fonte merged ·
R9.3 grupo proveniência/lineage merged · R9.4 grupo stale/reconciliação merged · R9.5 grupo ações cegas/explicabilidade
merged · R9.6 grupo ownership merged · R9.7 grupo relatórios/operações/exports merged · R9.8 grupo workflow/replay/auditoria
merged · R9.9 grupo tenant/export merged · R9.10 os 54 P1 com estado final registrado (corrigido, cutover, desativado ou
risco aceito formalmente).

**R10 — P2 / Documentation / UX Debt (4)**
R10.1 12 P2 triados · R10.2 PR de P2 técnicos merged · R10.3 documentação arquitetural alinhada ao código (PR merged) ·
R10.4 12 P2 com estado final registrado.

**R11 — Permanent Guards & Closure (8)**
R11.1 guard semantic-authority · R11.2 guard no-upsert-on-create · R11.3 guard tenant-source · R11.4 guard blind-action de
UI · R11.5 guard AI-never-decides · R11.6 guard de imutabilidade de aprovado/emitido · R11.7 re-auditoria de fechamento
(mesma metodologia) sem P0 aberto · R11.8 relatório de fechamento merged.

**Total congelado v1.0:** 10 + 10 + 7 + 6 + 7 + 7 + 6 + 6 + 6 + 10 + 4 + 8 = **87 checkpoints**.

---

## 9. Master Progress Ledger

Registro técnico versionado de governança (não é sistema de workflow). Atualizado ao fim de cada execução desta frente.

| Checkpoint | Status | Evidência | PR/commit | Data |
|---|---|---|---|---|
| R0.1 | PASS | baseline versionado byte-idêntico (sha256 `08edc734…810b3`) | esta PR (commit documental) | 2026-09-26 |
| R0.2 | PASS | 26 P0 extraídos e conferidos (26 P0 · 54 P1 · 12 P2 = 92) — §3 | esta PR | 2026-09-26 |
| R0.3 | PASS | FIX 17 · CUTOVER 5 · DISABLE 2 · LEGAL REVIEW 2 — §3.1 | esta PR | 2026-09-26 |
| R0.4 | PASS | reachability por P0 com evidência (rotas, menu, callers, routers) — §2/§3; **corrigido** para SEM-001 (alcance × explorabilidade; `processes.create` desativado; SEM-001 reconfirmado no código) — §9.1 | PR #259 (commit de correção) | 2026-09-26 |
| R0.5 | PASS | CANONICAL 18 · LEGACY_REACHABLE 7 · LEGACY_INERT 1 · SHARED_INFRA 0 · UNKNOWN 0 — §3.1 | esta PR | 2026-09-26 |
| R0.6 | PASS | DAG de dependências — §5 | esta PR | 2026-09-26 |
| R0.7 | PASS | plano de PRs consolidado (19 funcionais + 1 documental) — §6 | esta PR | 2026-09-26 |
| R0.8 | PASS | INV-01…INV-17 — §7 | esta PR | 2026-09-26 |
| R0.9 | PASS | PR documental aberta: #259 | PR #259 | 2026-09-26 |
| R0.10 | PASS | CI verde no head final `6b9c17d` da PR #259 (Typecheck+Lint, Testes, Smoke MySQL + Isolamento, Build, Auditoria de Dependências); merge em `ba810d1` | PR #259 | 2026-09-26 |
| R1.1 | PASS | reprodução controlada em MySQL real (fixtures diretas; sem `processes.create`): no código anterior, 15/18 casos do smoke falhavam — `addMember` com usuário de outro órgão era **aceito**; `assignStage` cross-tenant **gravava** a atribuição; mensagens distintas para e-mail inexistente × de outro órgão (enumeração); `listMembers`/`getStageAssignments` expunham id/nome/e-mail de associação histórica cross-tenant; associação estrangeira podia ser elevada (`updatePermission`/`updateFunctionalRole`); nome estrangeiro gravado no activity log; nenhum evento de negação | PR-01 (`collaboration-tenant-isolation-mysql-smoke.test.ts`) | 2026-09-26 |
| R1.2 | PASS | contrato tenant-scoped documentado no cabeçalho de `collaborationRouter.ts` (tenant = `ctx.organizationId`; processo por (id, org) com o mesmo NOT_FOUND; alvo com membership ATIVA em `organization_members`; escrita/notificação/log só após os gates; leituras sem identidade estrangeira; remoção de associação histórica permitida) | PR-01 | 2026-09-26 |
| R1.3 | PASS | DB: `getActiveOrganizationUserByEmail/ById` (join `organization_members`, `ativo`), `getProcessMembersForOrganization`, `getStageAssignmentsForOrganization` (omitem associação estrangeira + `hiddenCount`); leituras não escopadas removidas | PR-01 | 2026-09-26 |
| R1.4 | PASS | router: todas as procedures em `tenantProcedure`; boundary único (processo no tenant → permissão → alvo no tenant); nenhum `getProcessById`/`getUserByEmail`/`getUserById` global no router | PR-01 | 2026-09-26 |
| R1.5 | PASS (N/A) | callers de UI (`MembersDialog`, `StageAssignmentPanel` via `DocTabContent`) existem só sob `ProcessDetails`, **não roteado** (teste `pr-b-canonical-wiring.test.ts` proíbe o import); nenhuma mudança de frontend necessária | PR-01 | 2026-09-26 |
| R1.6 | PASS | smoke MySQL T1–T25 (cross-tenant: adição/atribuição recusadas sem efeito colateral, processo de outro órgão com o mesmo NOT_FOUND, leituras sem PII estrangeira, anti-enumeração) + teste de router com DB mockado (ordem dos gates, replay negado sem escrita, lookups globais proibidos) | PR-01 | 2026-09-26 |
| R1.7 | PASS | regressão same-tenant (T3, T5, T22, multi-org, approver, checkPermission) + smoke de segurança completo 126/126 + suíte completa | PR-01 | 2026-09-26 |
| R1.8 | PASS | evento `tenant_authorization_denied` (procedure, organizationId, actorUserId, processId, correlationId, reason) sem e-mail/nome do alvo (T24/T25); `collaboration_cross_tenant_rows_hidden` só com contagem; activity log de sucesso com `organizationId` + `correlationId` | PR-01 | 2026-09-26 |
| R1.9 | IN_PROGRESS | CI da PR-01 (evidenciado no relatório); CI da main pós-merge pendente | PR-01 | — |
| R1.10 | TODO | produção validada (após merge + deploy autorizados) | — | — |
| R2.1 – R2.7 | TODO | — | — | — |
| R3.1 – R3.6 | TODO | — | — | — |
| R4.1 – R4.7 | TODO | — | — | — |
| R5.1 – R5.7 | TODO | — | — | — |
| R6.1 – R6.6 | TODO | — | — | — |
| R7.1 – R7.6 | TODO | — | — | — |
| R8.1 – R8.6 | TODO | — | — | — |
| R9.1 – R9.10 | TODO | — | — | — |
| R10.1 – R10.4 | TODO | — | — | — |
| R11.1 – R11.8 | TODO | — | — | — |

Nota: o CI de um commit não pode ser gravado como PASS dentro do próprio commit; R0.10 é evidenciado no relatório da
execução (resultado do CI do head) e registrado neste ledger na execução seguinte.

### 9.1 Registro de correções factuais (sem mudança de roadmap)

Correções de evidência que **não** alteram checkpoints, fases, total (87), estratégias, severidades nem o mapeamento de
PRs. Por isso o roadmap continua **v1.0**. O baseline da auditoria permanece byte-idêntico.

| Data | Correção | Achado | O que mudou | O que **não** mudou | Checkpoints reavaliados |
|---|---|---|---|---|---|
| 2026-09-26 | SEM-001 — correção da evidência de alcance e da pré-condição de exploração | SEM-001 | A versão anterior deste plano afirmava que `processes.create` permitia a qualquer usuário criar um processo legado próprio e, a partir dele, explorar `collaboration.*`. Isso é **incorreto**: `processes.create` executa `throwLegacyProcessPipelineDisabled()` (`LEGACY_PROCESS_PIPELINE_DISABLED`). Registrado agora: superfície API-reachable; exploração exige processo legado preexistente ao qual o chamador tenha acesso; presença dessas linhas em produção não verificada. | P0 · FIX · PR-01 (primeira PR funcional) · LEGACY_REACHABLE (superfície) · 92 achados (26/54/12) · distribuições | R0.4 (reconfirmado → PASS); R0.10 (reaberto até CI verde do novo head) |

---

### 9.2 Achados novos durante a remediação (não alteram o baseline nem as contagens 92/26/54/12)

| ID | Data | Achado | Severidade proposta | Estado | Observação |
|---|---|---|---|---|---|
| NEW-001 | 2026-09-26 | Drift de schema: `drizzle/schema.ts` declara `notifications.type = 'stage_assigned'`, mas nenhuma migration adiciona o valor ao ENUM (só `0004` cria o ENUM, sem ele). No banco migrado, `collaboration.assignStage` grava a atribuição e **falha** no insert da notificação (escrita parcial). | P2 (a triar; fluxo sem UI roteada) | registrado para backlog (R9/R10) | Correção exige migration — fora do escopo da PR-01. O smoke da PR-01 documenta o comportamento; o contrato de sucesso completo é coberto com DB mockado. |

## 10. Histórico de versões do roadmap

| Versão | Data | Mudança | Checkpoints afetados | Motivo |
|---|---|---|---|---|
| v1.0 | 2026-09-26 | Criação: triagem dos 26 P0, fases R0–R11, 87 checkpoints | todos | baseline da remediação |

---

## 11. Modelo do bloco obrigatório

```
==================================================
PROGRESSO MESTRE — REMEDIAÇÃO DA AUDITORIA SEMÂNTICA
==================================================
Baseline: <versão do roadmap / commit do plano>
R0 — Baseline e triagem: X%
R1 — Tenant Isolation / Security: X%
R2 — Legacy Reachability & Cutover: X%
R3 — Create ≠ Reset: X%
R4 — Authority & Institutional Roles: X%
R5 — Human State Preservation: X%
R6 — Semantic Fallbacks: X%
R7 — Official Document Snapshot & Immutability: X%
R8 — Legal Rules Review: X%
R9 — P1 Structural Remediation: X%
R10 — P2 / Documentation / UX Debt: X%
R11 — Permanent Guards & Closure: X%
Progresso global: PASS / 87 checkpoints = X%
Fase atual: …   Gate atual: …
Concluído nesta execução: …
Próximo passo autorizado: …
Bloqueios: …   Riscos: …   Desvios de escopo: …
Achados abertos: P0: …  P1: …  P2: …
```
