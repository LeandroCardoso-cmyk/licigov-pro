# Decisões humanas pós-NIGHT SHIFT (2026-09-28)

> Registro documental das decisões do owner sobre o NIGHT SHIFT REPORT de 27→28/09/2026.
> O documento **não altera o baseline**:
> - 92 achados, sendo 26 P0 / 54 P1 / 12 P2;
> - `SEMANTIC_AUTHORITY_CROSS_MODULE_AUDIT.md`, sha256 `08edc734…0810b3`.
>
> Os achados NEW-00x ficam **fora** do baseline. Nenhuma PR foi aberta, nenhum merge foi feito e a produção não foi alterada.
> Atualizado em 2026-09-29 com o hardening final pré-PR (NEW-016 · NEW-003 · NEW-022) — ver §13.

## 0. Autorização de referência

> "Aprovo o pacote de decisões proposto para R2.2, PR-06, PR-08, PR-09 e PR-12, e autorizo priorizar a triagem/correção
> de NEW-005, NEW-006 e NEW-007 antes da abertura das PRs relacionadas."

A execução estava autorizada a:
- registrar as decisões;
- corrigir branches e criar os branches NEW-005/006/007;
- aprofundar NEW-003/004/015;
- criar migrations **somente em branch e localmente**;
- fazer commit e push de branches não-main.

Nada além disso: nenhuma PR, merge, deploy ou flag.

## 1. Correção factual pós-turno

| Item | Registro no NIGHT SHIFT REPORT | Correção |
|---|---|---|
| Progresso de R2 | linha gráfica: "R2 2/7 oficial (R2.1 PASS, …)" | **R2 oficial = 1/7** (somente R2.1 PASS/MERGED). R2.4 é apenas candidato enquanto a PR-02 não for aberta, revisada, com CI verde, mergeada e validada. |

O NIGHT SHIFT continua válido. O relatório enviado ao humano não é reescrito; esta linha registra a correção.

**Estado oficial:**
- R0 10/10 · R1 9/10 · R2 1/7 · R3 0/6 · R4 0/7 · R5 0/7 · R6 0/6 · R7 0/6 · R8 0/6 · R9 0/10 · R10 0/4 · R11 0/8;
- **20/87 = 23,0%**;
- R1.10 = IN_PROGRESS (não será criado segundo tenant).

## 2. R2.2 — Opção B

Registrada em [`R2_CANONICAL_INGESTION_TENANT_DECISION.md`](R2_CANONICAL_INGESTION_TENANT_DECISION.md) §10, com parâmetros, sequência e gatilhos de rollback.

**Status:** PASS_CANDIDATE · DECISION_RECORDED · RUNTIME_STATE_READONLY_PENDING. A flag **não foi alterada**.

## 3. R2.3

**Status:** BLOCKED_FOR_HUMAN_REVIEW / ENVIRONMENT. Ver [`R2_LEGACY_DATA_USAGE_READONLY.md`](R2_LEGACY_DATA_USAGE_READONLY.md). A PR-03 não foi iniciada.

## 4. PR-06: parecer e contrato (create ≠ reset)

| Tema | Decisão |
|---|---|
| Parecer | Existe **um parecer corrente por workspace/solicitação**. A evolução acontece por rascunho, versões e histórico. Um novo parecer institucional exige uma nova solicitação ou workspace. |
| Número do contrato | **Único por órgão**, qualquer que seja a origem. A origem não pode integrar a chave que permitiria dois contratos oficiais com o mesmo número no mesmo tenant. |
| Normalização do número | Determinística e mínima: trim externo mais regras já existentes e comprovadas. Não remover zeros, não reinterpretar o exercício, não mudar a semântica. Auditar números e formatos existentes antes. |
| Migration de unicidade | Permitida só se for aditiva, na branch, e com preflight de duplicatas. Se houver duplicatas que exijam decisão humana: **BLOCKED_FOR_DATA_REMEDIATION** e nenhuma unique constraint destrutiva. |
| Retry depois de `minuta` | **CONFLICT**. A idempotência não pode mascarar a evolução institucional posterior. |
| RBAC do parecer | **Fora** da PR-06. Vai no branch próprio `fix/new-007-legal-opinion-rbac`, com teste local de compatibilidade e sem misturar commits. |

## 5. PR-08: RBAC e máquina de estados do contrato

| Tema | Decisão |
|---|---|
| `minuta → aditado` | **Proibido**. A exceção do turno noturno é removida. |
| `minuta → apostilado` | **Proibido**. |
| Ativação | Deve existir uma transição **explícita** `minuta → vigente` após a formalização, que seja: auditada, server-side, restrita ao tenant, com papel exigido, com correlação, sem fallback e replay-safe. Antes de implementar, auditar se existe evidência formal canônica de "formalizado". Se não existir, abrir a micro-frente `design/contract-activation-transition` com um contrato técnico proposto, **sem inventar requisito jurídico**. A lacuna de UI não justifica a exceção semântica. |
| Múltiplos instrumentos | Um contrato pode ter múltiplos aditivos e apostilamentos sucessivos. "Aditado" não pode ser um estado que impeça novo aditivo. Preferência: o estado principal reflete o ciclo (minuta, vigente, encerrado, rescindido, arquivado…) e os instrumentos são filhos/históricos. Aplicar a menor correção segura, sem mega-refactor; se o modelo impedir, documentar a dívida. |
| Parecer em aditivo | **Não** fixar em código "todo aditivo de valor exige parecer" nem "nenhum exige". Preservar `requiresLegalOpinion`, governado e fail-closed quando o fluxo exigir. O insumo jurídico fica com a PR-18/PR-20. |

## 6. PR-09: regerar e parâmetros do Edital

| Tema | Decisão |
|---|---|
| Regerar um rascunho | **Sem** justificativa textual obrigatória. Obrigatório: confirmação explícita, mostrar que há edição humana e o que será substituído, preservar o histórico, nenhuma IA antes da confirmação, e cancelar sem nenhum efeito. |
| Documento aprovado/oficial | **Não** regerar diretamente. Exige um novo ciclo de versionamento governado. |
| Critério de julgamento e regime de execução | **Devem ser persistidos**: são fatos institucionais, não estado de UI, default ou inferência. Se faltarem no schema, criar migration **aditiva** na branch. Registros antigos ficam NULL / "requer revisão", sem valor fabricado. Testar: DB limpo, DB migrado, reexecução da migration, hidratação, reload, regeneração e imutabilidade do oficial. |

## 7. PR-12: contrato vigente só muda por instrumento

| Tema | Decisão |
|---|---|
| Vigência | Travada fora de `minuta`. Mudança posterior só por instrumento ou workflow governado. |
| Gestor e fiscal | O editor genérico `updateContract` **não** pode alterá-los depois de `minuta` (fail-closed). A troca futura exige uma ação específica, auditada e com nome semântico; fica registrada como dívida/capability futura. |
| CAS | Mantém `expectedUpdatedAt` e `CONTRACT_REVISION_CONFLICT`. Um update com revisão desatualizada não grava nada. |

## 8. Prioridade absoluta: NEW-005 / NEW-006 / NEW-007 (fora do baseline)

| Achado | Branch | Severidade candidata | Regra aprovada |
|---|---|---|---|
| NEW-005A `directProcurement.ratify` aberto a viewer | `fix/new-005-direct-procurement-rbac` | **P0 AUTHORITY** | Piso técnico manager+ |
| NEW-005B `directProcurement.publish` aberto a viewer | idem | **P0 AUTHORITY** | Piso técnico manager+ |
| NEW-005C demais mutações da Contratação Direta abertas a viewer | idem | P1 RBAC/GOVERNANCE | leitura: tenant · rascunho e evidência: operator+ · configuração de workflow (`configureFlags`): manager+ |
| NEW-006 mutações do `contractWorkspace` abertas a viewer | `fix/new-006-contract-workspace-rbac` | P1; um subcaso pode ser P0 se executar decisão oficial sem segundo gate | leitura: tenant · rascunho, ocorrência e solicitação: operator+ · mudança de estado e decisão: manager+ · criação de instrumento: operator+ se só produz rascunho, manager+ se também muda o estado |
| NEW-007 `legalOpinionWorkspace.*` aberto a viewer | `fix/new-007-legal-opinion-rbac` | **P0 AUTHORITY** para `signOpinion`; P1/P0 para as demais conforme o efeito | operator+ **e** atribuição válida ao workspace; owner, admin e platform admin não viram procurador sem atribuição; `receiveRequest` sem autoatribuição por viewer e sem sobrescrita silenciosa |

**Nota obrigatória:** manager+ é **apenas um piso técnico de RBAC**. Não declara que o manager seja juridicamente a autoridade competente. Autoridade competente, `decidedBy` × `recordedBy` e segregação de funções continuam na **PR-07**.

**Ordem:** a PR-02, que desativa `directProcurement.updateStage` (LEG-011), entra antes da NEW-005.

## 9. Aprofundamentos sem correção nesta execução

- NEW-003: exportação LGPD com colunas secretas.
- NEW-004: ids de evento derivados de contagem.
- NEW-015: flag percentual aleatória.

Os resultados estão em §11.

## 10. Exceção registrada: hook Graphify

- **Instrução do owner:** usar o hook normal. Se ele gerar artefato fora de escopo, não desabilitar silenciosamente: diagnosticar e registrar a exceção antes.
- **Diagnóstico (2026-09-28):** numa cópia **não modificada** de `origin/main` (`5cd9d50`), `tools/graphify/run.sh update .` (graphifyy 0.9.32, a toolchain fixada) reescreve os 4 artefatos versionados de `graphify-out/` com **+39.458 / −11.255 linhas**.
- **Causa:** o grafo commitado está defasado em relação à main desde as PRs #256–#262, que entraram sem regenerá-lo.
- **Efeito se o hook rodasse:** cada commit de código injetaria esse drift alheio ao escopo, e todos os pares de branches conflitariam em `graph.json`.
- **Exceção:**
  - commits de código desta execução usam `git -c core.hooksPath=/dev/null`, com a linha `Graphify pre-commit skipped (registered exception …)` no corpo;
  - commits só de docs usam o hook normal (que não faz nada, porque não tocam `server/` nem `client/`).
- **Tratamento proposto:** uma única regeneração do grafo, numa PR própria, depois da integração das branches.

## 11. Resultado da execução (2026-09-28/29)

- **Main:** `5cd9d50` no início; `5924b4a` ao final (MAIN_MOVED_AFTER_NIGHT_SHIFT).
- **O que entrou na main:** um commit do owner, "fix(operations): persist records and show existing registrations", que toca 3 arquivos de Operações e nenhuma migration.
- **Impacto nas branches:** nenhuma sobreposição de arquivos com qualquer branch. Não houve rebase.
- **PRs abertas:** zero no início e zero no fim.

| Frente | Branch | Head anterior → novo | Migration | Status |
|---|---|---|---|---|
| PR-06 | `fix/r3-pr06-create-not-reset-legal-contract` | `5e68dc6` → `b655087` | **0308** (`normalized_number` gerado + UNIQUE(org, número), com preflight fail-closed) | READY_FOR_HUMAN_REVIEW |
| PR-08 | `fix/r4-pr08-rbac-state-machine` | `95b455d` → `dd03480` | não | READY_FOR_HUMAN_REVIEW (ativação sem evidência canônica: proposta em `docs/design/CONTRACT_ACTIVATION_TRANSITION.md`) |
| PR-09 | `fix/r5-pr09-regeneration-human-state` | `c5b116f` → `ddb148c` | **0308** local, renumerar para **0309** na integração | READY_FOR_HUMAN_REVIEW |
| PR-12 | `fix/r5-pr12-contract-governed-change` | `2ef5a4c` → `6fab8c7` | não | READY_FOR_HUMAN_REVIEW |
| NEW-005 | `fix/new-005-direct-procurement-rbac` (nova) | — → `fbe9328` | não | READY_FOR_HUMAN_REVIEW |
| NEW-006 | `fix/new-006-contract-workspace-rbac` (nova) | — → `db7fefc` | não | READY_FOR_HUMAN_REVIEW |
| NEW-007 | `fix/new-007-legal-opinion-rbac` (nova) | — → `ed8ac75` | não | READY_FOR_HUMAN_REVIEW |

A integração simulada das 17 branches passou em todos os gates; ver [`PRE_PR_BRANCH_INTEGRATION_MATRIX.md`](PRE_PR_BRANCH_INTEGRATION_MATRIX.md).

## 12. Ledger de achados fora do baseline (NEW-00x): severidade candidata e tratamento

| ID | Severidade candidata | Superfície | Situação |
|---|---|---|---|
| NEW-001 | P0 (histórico) | `assignStage` | DEPLOYED_AWAITING_FINAL_VALIDATION (PR #261) |
| NEW-002 | P0 operacional / governança | `lgpd.deleteMyAccount` | branch pronta (`81622d8`) |
| NEW-003 | **P1 SECURITY**: segredo exposto ao titular, mais quebra de fronteira de tenant para servidor desligado (legado) | `lgpd.exportMyData` | **DISABLE em branch** (`fix/new-003-disable-lgpd-export` `f99fcf8`): recusa FORBIDDEN `LGPD_EXPORT_DISABLED` antes de qualquer leitura, zero payload. Exportação governada (allowlist + `.output()` estrito + auditoria + controlador) = capability futura. Ver §13. [Triagem](POST_NS_TRIAGE_NEW_003_004_015.md) |
| NEW-004 | **P1** integridade de auditoria | ids e ordem de evento por contagem + upsert (9 pontos) | confirmado e reproduzido. Não corrigido. Aditivo e apostilamento agora falham fechado na PR-08 (CONFLICT, nada gravado) |
| NEW-005A/B | **P0 AUTHORITY** | `directProcurement.ratify` / `publish` | corrigido em branch (piso manager) |
| NEW-005C | P1 RBAC | demais mutações da Contratação Direta | corrigido em branch |
| NEW-006 | P1; **P0** nos subcasos `updateContract` com `status`, `createAddendum` e `createApostille` | `contractWorkspace.*` | corrigido em branch |
| NEW-007 | **P0 AUTHORITY** (`signOpinion`); P1 nos demais | `legalOpinionWorkspace.*` | corrigido em branch (operator+ **e** atribuição) |
| NEW-008 | P2 | numeração de aditivo e apostilamento | parcial: PR-08 falha fechado; numeração atômica pendente (DATA-039 follow-up) |
| NEW-009 | P2 | ativação e write-back de instrumentos | decisão do owner registrada (§5); proposta de ativação na PR-08 |
| NEW-010 | P2 | número de processo sem normalização | aberto (a PR-06 cobre só contratos) |
| NEW-011 | P3 | `server/routers.ts.backup` | aberto |
| NEW-012 | P3 | `productionReadiness.getSystemHealth` / `webhookRouter` | mitigado pela LEG-028 (gated) |
| NEW-013 | P3 | tamanho dos campos de cotação / deduplicação parcial | aberto |
| NEW-014 | P3 | limpeza de smokes (rerun) | aberto |
| NEW-015 | P2 latente | flag percentual aleatória | mitigado pela decisão R2.2 (100%, sem expiração). Regra: sem rollout percentual institucional até existir bucket determinístico |
| NEW-016 | **P0 de integridade documental** (decisão de continuidade 29/09; antes "P1, candidato a P0") | `officialDocumentLifecycleService.createDocument`: GET_LOCK liberado antes do commit externo | **remediado em branch** (`fix/new-016-official-document-immutability` `674662f`): INSERT puro, GET_LOCK verificado, versão por `FOR UPDATE`, colisão ⇒ CONFLICT. Reproduzido antes (9/14 falham na main), 14/14 depois. Ver §13 |
| NEW-017 | P2 | kill-switches de Ops sem consumidor e com semântica invertida | aberto |
| NEW-018 | P2 | recusas de RBAC não eram logadas | **tratado** na branch NEW-006 (log `rbac/org_role_denied`) |
| NEW-019 | P2 | `legalOpinionWorkspace.loadReasoning` dispara IA a pedido de qualquer membro | aberto |
| NEW-020 | P3 | `receiveRequest`: crash entre o claim e o recebimento deixa o workspace atribuído em INBOX | aberto |
| NEW-021 | P2 | `insertContractOccurrence` grava datetime ISO (falha no MariaDB; não verificado no MySQL 8) | aberto |
| NEW-022 | **P1** authority/lifecycle | `updateContract` ainda permite `minuta → vigente` sem evidência nem evento dedicado (manager+ após NEW-006) | **bloqueado em branch** (`fix/new-022-block-generic-contract-activation` `9905413`): FORBIDDEN `CONTRACT_ACTIVATION_REQUIRES_GOVERNED_ACTION`, zero escrita. A ativação governada continua proposta (PR-08, `docs/design/CONTRACT_ACTIVATION_TRANSITION.md`, NÃO DEFINIDA JURIDICAMENTE). Ver §13 |
| NEW-023 | P2 | `createAddendum` marca aditivos prazo/qualitativo como `finalizado` sem decisão humana (possível sobreposição com SEM-025/084) | aberto |
| NEW-024 | P2 | aditivo `aguardando_parecer` sem comando de finalização; `legalOpinionRequestId` nunca é gravado | aberto |
| NEW-025 | P2 | apostilamento gestor/fiscal não aplica a troca | aberto; depende da ação governada de designação (§7) |
| NEW-026 | P2 | "substituir" via importação de documento ignora a emissão oficial (mesma lacuna que a PR-09 B fechou para regeneração) | aberto |
| NEW-027 | P3 | contrato renomeado bloqueia o número original para sua origem; regras de comparação (case) divergentes | aberto; decisão sobre case-folding |

**Registrados como pertencentes ao baseline, não como novos:**
- `ratify` com default "ratificado" e re-ratificação sobrescrevendo: SEM-004 / PR-07.
- Reset de contrato por operador antes da PR-06: SEM-006/007.

## 13. Hardening final pré-PR (2026-09-29) — NEW-016 · NEW-003 · NEW-022

> Autorização de referência: "HANDOFF MESTRE — CONTINUIDADE EM NOVO AMBIENTE — FASE: PRE-PR HARDENING FINAL"
> (prioridades aprovadas: 1. NEW-016, 2. NEW-003, 3. NEW-022; nenhuma PR, nenhum merge remoto, produção intocada).
> Os achados continuam **fora** do baseline 92 (26 P0 / 54 P1 / 12 P2; sha256 `08edc734…0810b3`, conferido).

### 13.1 Estado inicial reconstruído pelo remoto

- `origin/main` = `5924b4a` no início e no fim (sem MAIN_MOVED_AFTER_HANDOFF). PRs abertas: **zero** no início e no fim.
- Heads das 17 branches do programa conferidos com o handoff (NEW-005 `fbe9328`, NEW-006 `db7fefc`, NEW-007 `ed8ac75`,
  PR-06 `b655087`, PR-08 `dd03480`, PR-09 `ddb148c`, PR-12 `6fab8c7`, docs `7cf887e`); nenhuma foi alterada.
- Ambiente novo: MariaDB 10.11 local (REPEATABLE-READ, STRICT_TRANS_TABLES), um banco próprio por frente; nada herdado.

### 13.2 Resultado por frente

| Frente | Branch (nova) | Head | Severidade | Tratamento | Migration |
|---|---|---|---|---|---|
| NEW-016 | `fix/new-016-official-document-immutability` | `674662f` (3 commits) | **P0 integridade documental** | remediado: imutabilidade da versão oficial | não |
| NEW-003 | `fix/new-003-disable-lgpd-export` | `f99fcf8` (1 commit) | **P1 SECURITY** | DISABLE (`LGPD_EXPORT_DISABLED`) | não |
| NEW-022 | `fix/new-022-block-generic-contract-activation` | `9905413` (4 commits) | **P1 authority/lifecycle** | ativação genérica bloqueada (`CONTRACT_ACTIVATION_REQUIRES_GOVERNED_ACTION`) | não |

**NEW-016 — causa raiz (reproduzida na main `5924b4a`).** `createDocument` fazia `GET_LOCK` → contagem de versões por
leitura de *snapshot* → `insertOfficialDocument` → `RELEASE_LOCK` no `finally`, **antes** do commit da transação externa
(`promoteOfficialDocument` e a persistência/regeneração do `procurementProcessService` passam executor). O 2º escritor
obtinha o lock, não via a linha não commitada, calculava a mesma versão (mesmo id `odoc:tenant:lineage:version`) e o
`onDuplicateKeyUpdate` reescrevia `content`/`status`/`metadata`. Reprodução: v1 `emitido` (emissor1) virou `gerado` com o
conteúdo da regeneração — linha **híbrida** (autor do emissor, conteúdo do outro) — e a timeline ficou com dois
`event_order = 0`. O retorno do `GET_LOCK` era ignorado.

**NEW-016 — solução (fechamento P0, sem migration).**
- `insertOfficialDocument` = **INSERT puro**; colisão ⇒ `OfficialDocumentVersionConflictError` (CONFLICT
  `OFFICIAL_DOCUMENT_VERSION_CONFLICT`); a linha existente não é tocada.
- `GET_LOCK` verificado: ≠ 1 (0/NULL) ⇒ CONFLICT `OFFICIAL_DOCUMENT_LOCK_UNAVAILABLE`, sem leitura/escrita.
- Versão = `MAX(version)+1` por **leitura corrente com lock** (`SELECT … FOR UPDATE` sobre `idx_odoc_lineage`): um escritor
  cuja versão ainda não commitou bloqueia essa leitura **até o commit** — a serialização passa a valer até o COMMIT,
  inclusive com transação externa e snapshot antigo (T4/T4b). Os row/gap locks do InnoDB são a "linha de serialização" sem
  tabela nova.
- Evento de criação na timeline: ordem por leitura com lock e INSERT puro (colisão ⇒ CONFLICT; nunca reescreve evento).
- `emitido` nunca é rebaixado/reescrito: não resta nenhum caminho de UPDATE/upsert de `content`/`status`/`metadata` em
  `official_documents` (guarda estrutural no teste unitário). `updateOfficialDocumentStorageRefs` só toca referências de storage.
- **Follow-ups registrados (não feitos):** (a) evento `documento_exportado` fora da transação de versão mantém o upsert de
  `summary` (NEW-004 #8); (b) `promoteOfficialDocument` lê o rascunho fora da transação — o conteúdo emitido é exatamente o
  revisado (hash confirmado), sem corrupção, mas uma revalidação sob `FOR UPDATE` dentro da transação é otimização futura;
  (c) contador de linhagem dedicado (tabela/migration) só se o throughput exigir.

**NEW-016 — concorrência (MariaDB real).** Smoke `new016-official-document-immutability-mysql-smoke` T1–T13 + T4b:
normal, 2ª versão, 8 escritores, transação externa aberta após o `RELEASE_LOCK`, snapshot antigo, emissão × regeneração
pelos fluxos reais (4 rodadas), colisão direta, `emitido` preservado sob rajada, `contentHash`, ledger
`official_document_promotions`, timeline, `GET_LOCK` indisponível, tenant e retry. **Main original: 9/14 falham** (inclusive
T5 e T9 pelos fluxos reais — ledger inconsistente); **corrigido: 14/14** (repetido). Unitário: 9/9.

**NEW-003 — contrato de disable.** `lgpd.exportMyData` segue registrado (mutation sem input); a primeira instrução é
`throwLgpdExportDisabled(ctx)`: FORBIDDEN com mensagem pt-BR estável contendo `LGPD_EXPORT_DISABLED`, idêntica para
qualquer ator; evento `lgpd_export_refused` (actorUserId + correlationId, sem PII). `db.exportUserData` não é alcançável
(freeze estático). `LGPD_EXPORT_FORBIDDEN_KEYS` = passwordHash, signaturePassword, tokenVersion, openId, s3Key, fileUrl.
**Zero-leak:** 9 atores (sem órgão, viewer, operator, manager, owner, admin de plataforma, membership ativa, **inativa**,
outro órgão) ⇒ mesma recusa; `Com_select` global **inalterado** durante as chamadas (zero leitura); corpo HTTP (fetch
adapter + superjson) 403 sem chave proibida, hash bcrypt, conteúdo ou storage ref. Main original: 24/27 falham; depois 27/27.
A exportação governada fica registrada como **capability futura** (allowlist, `.output()` estrito, auditoria, revisão
jurídica/controlador) — **não** implementada.

**NEW-003 × NEW-002.** Merge nas duas ordens: só a união do `package.json`; `lgpdRouter.ts` auto-merge (os dois guards
convivem; imports e handlers em linhas disjuntas). **Conflito semântico:** o smoke da NEW-002 afirmava que
`exportMyData` "continua funcionando" ⇒ **fix-up 0008** (o teste passa a exigir `LGPD_EXPORT_DISABLED` e mantém "nenhuma
linha alterada"). Ordem escolhida: **NEW-003 em W0, NEW-002 em W1** (qualquer ordem funciona; 0008 aplica após a NEW-002).
Os achados continuam separados (nenhum squash).

**NEW-022 — contrato de recusa.** `assertNoGenericContractActivation` é a primeira ação do handler `updateContract` (antes de
`requireContract`, edição, transição e escrita). Só lê quando o pedido traz `status: "vigente"`; `minuta → vigente` ⇒
FORBIDDEN `CONTRACT_ACTIVATION_REQUIRES_GOVERNED_ACTION` (mensagem idêntica), zero escrita, zero timeline, zero mudança de
status; transição + edição no mesmo pedido é atômica; contrato de outro órgão ⇒ NOT_FOUND neutro. Seguro contra corrida
(nenhuma transição volta a `minuta`). A UI (`ContractEditor`) nunca envia `status`. **Não** implementa a ativação oficial
nem define "formalização". Main original: 7/12 do smoke falham (inclusive viewer ativando); depois 12/12.

**NEW-022 × NEW-006 / PR-06 / PR-08 / PR-12.**
- Textual: após mover o import do guard para uma linha que nenhuma branch toca (commit `961c711`) ⇒ só `package.json` com
  as quatro. A linha do destructuring recebe a MESMA correção de lint (`_contractId`) que NEW-006/PR-08/PR-12, byte a byte.
- Semântico: (a) com a NEW-006 o viewer é recusado pelo piso RBAC antes do handler (smoke da NEW-022 aceita os dois
  motivos só para viewer); (b) a PR-12 exige `expectedUpdatedAt` e trava `object` fora da minuta (smoke da NEW-022 envia a
  revisão; caso no-op sem edição); (c) **fix-up 0009** — C12 do smoke da PR-06 ativava pelo editor genérico ⇒ prova a
  recusa e usa fixture de banco para `vigente`; (d) **fix-up 0010** — teste da PR-12 "minuta → vigente permitido via CAS"
  ⇒ recusa NEW-022 sem escrita + transição válida vigente → encerrado via CAS.
- Ordem: NEW-022 **pode** ficar em W0 (não depende de tipo/router da NEW-006); o bloqueio chega antes de PR-08/PR-12.

### 13.3 Novo achado de integração (corrigido na própria branch)

- **INTEG-016-05 (typecheck):** a PR-05 exporta `isDuplicateKeyError` de `db/procurement.ts`; a NEW-016 exportava homônimo
  em `db/officialDocuments.ts`; `db/index.ts` re-exporta `*` dos dois ⇒ TS2308 no tree integrado. Corrigido na NEW-016
  (helper privado do módulo, commit `674662f`).

### 13.4 Ordem futura (candidata, validada na integração descartável)

W0 NEW-016 · NEW-003 · NEW-022 → W1 PR-02 · LEG-005 · LEG-009 · LEG-028 · LEG-032 · NEW-002 → W2 NEW-005 · NEW-006 ·
NEW-007 → W3 PR-04A · PR-05 · PR-06 → W4 PR-08 · PR-12 · PR-09 → W5 PR-04. Restrições mantidas: PR-09 depois de PR-06 **e
de NEW-016**; PR-12 depois de PR-06 e NEW-006; PR-04 só após os gates de R2.2; PR-03 bloqueada por R2.3. Nenhuma branch que
toque documento oficial (em especial PR-09) é considerada pronta sem a NEW-016.

### 13.5 Estado oficial (inalterado)

R0 10/10 · R1 9/10 (R1.10 IN_PROGRESS) · R2 1/7 · R3 0/6 · R4 0/7 · R5 0/7 · R6–R11 0 ⇒ **20/87 = 23,0%**. R2.2 =
PASS_CANDIDATE · DECISION_RECORDED · RUNTIME_STATE_READONLY_PENDING (flag não alterada). R2.3 = BLOCKED. Nenhuma branch
conta como PASS oficial. Produção: zero mutações.
