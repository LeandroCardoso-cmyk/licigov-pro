# Auditoria arquitetural transversal — autoridade semântica, proveniência e ações cegas

> **Fase:** diagnóstico (somente leitura). Nenhum código funcional, migration, flag, dado de produção,
> Graphify ou documentação existente foi alterado. Este arquivo NÃO está commitado.
>
> **Main auditada:** `5903cda` (fix(dfd): clarify responsible-demand provenance and reconciliation, #258).
> **Data:** 2026-09-26.
> **Motivação:** incidente do piloto 2026/253 — `procurement_processes.responsibleUser` (operador que criou o
> processo) projetado como `demand.responsibleParty` (responsável institucional pela demanda), gerando
> divergência falsa e ação cega "Usar informação de origem". Corrigido na #258.
> **Pergunta central:** *"Esse campo realmente significa o que o consumidor acha que significa?"*

---

## 0. Como ler

- **Severidade:** P0 = risco alto imediato (sobrescrita silenciosa, fonte semanticamente errada, decisão
  jurídica/IA autônoma, cross-tenant, documento oficial mutável, quantidade/preço errado em documento
  institucional, aprovação herdada, ação irreversível sem supervisão); P1 = risco importante; P2 = melhoria.
- **Alcance:** `canônico` = fluxo navegável atual; `legado-API` = rota tRPC montada em `server/routers.ts`,
  sem entrada no menu atual, mas **chamável por qualquer cliente autenticado**; `legado-UI` = página ainda
  roteada fora do fluxo canônico. Rota legada exposta continua sendo superfície de risco.
- **Confiança:** todo P0 foi **confirmado no código** (arquivo:linha citados; os principais foram
  reverificados diretamente pelo auditor principal). Hipóteses estão marcadas como tal.

---

## 1. Metodologia (C)

1. Estado confirmado no remoto (`git fetch`; working tree limpo; checkout destacado em `origin/main 5903cda`).
2. Auditoria **code-first**, seguindo chamadas reais: router → service → domain → db (Drizzle) → frontend → testes.
   Graphify **não** foi regenerado nem usado como fonte única.
3. Seis frentes paralelas somente-leitura (ETP/TR/Edital; Pesquisa/Itens Inteligentes/Itens da Contratação/Lotes;
   Contratação Direta/Parecer/Contratos; Operações/relatórios/exports; IA/workflows/tenant/replay/transações/
   auditoria; inventário de ações de UI) + auditoria direta do Contexto Canônico/DFD.
4. Cada candidato a P0 reverificado pelo auditor principal lendo o trecho citado (ex.: upserts de
   `directProcurement`, `legalOpinionWorkspace`, `procurement`, `priceResearch`; `collaborationRouter`;
   `EditalWorkspace`; `officialDocumentExportAdapter`/`documentPromotionService`; `LegalOpinionEditor`;
   `RequiredDocumentsWorkspace`; `directContractAuditReport`; `exportRouter`).
5. Deduplicação: achados equivalentes de frentes diferentes consolidados num único `SEM-xxx`.
6. Processo 2026/253 usado só como referência conceitual. Nenhum clique, SQL ou chamada a produção.

**Não confirmado / fora do alcance desta fase:** conteúdo real de produção (existência de dados legados,
volumes >200/500, reference set ainda DRAFT), comportamento em runtime da IA (se escreve números na prosa),
internals de `server/kernel/*`, revogação de sessão ao remover membro (TEN-3), páginas não seguidas até o
serviço (RescissionModal, Addendum/ApostilleWorkspace, MembersDialog alcançabilidade). Pontos jurídicos
(DC-4, CT-5) precisam de validação por jurista antes da correção.

---

## 2. Executive summary (Entregável 1 / D–G)

| Total | P0 | P1 | P2 |
|---:|---:|---:|---:|
| **92** | **26** | **54** | **12** |

**Módulos mais expostos:** Contratação Direta, Parecer Jurídico (canônico e legado), Contratos/Aditivos,
Pesquisa de Preços/Itens Inteligentes, ETP/TR/Edital (regeneração e modo legado), Colaboração (tenant).

**Padrões recorrentes (classes arquiteturais):**

1. **ID determinístico + `onDuplicateKeyUpdate` = sobrescrita silenciosa** (a classe mais frequente e mais
   perigosa): processo licitatório, workspace de contratação direta, ratificação, parecer, contrato, cotações de
   pesquisa colada, justificativas, eventos de timeline. "Criar de novo" vira "resetar o existente".
2. **Operador/clique tratado como autoridade institucional** (mesma classe do `responsibleUser`): ratificação
   registra quem clicou como autoridade competente e mantém o primeiro nome em decisões posteriores; aprovador
   de parecer vindo do cliente; "responsável pela etapa" de outro tenant.
3. **Valor tecnicamente disponível usado como fato de outro significado:** quantidade cotada → quantidade da
   contratação (modo legado de TR/Edital/ETP); média de cotações → "valor de referência"; valor estimado →
   "valor do contrato"/"Valor Total Contratado"; centavos → reais; catálogo com hipóteses da Lei 8.666 numeradas
   como Lei 14.133.
4. **Ações cegas / formulários que não hidratam o valor salvo:** regenerar ETP/TR/Edital, "Gerar edital" com
   parâmetros padrão, editor de parecer que zera campos e força "Favorável", justificativa de preço, editor de
   contrato, "Aplicar cotações atualizadas".
5. **Estado "aprovado" inexistente ou não vinculado à versão:** `generated_documents` nunca chega a
   "aprovado" (guardas de imutabilidade do DFD e de "consumido por documento aprovado" são inalcançáveis);
   legados aprovam/editam sem trava de versão.
6. **Saída de IA virando documento oficial ou conclusão sem aceite humano** (Contratação Direta e parecer legado).
   No fluxo canônico (DFD/ETP/TR/Edital) a IA permanece rascunho — **isso está correto**.
7. **Rotas legadas montadas** que contornam os guardas do fluxo canônico (aprovação de documentos, parecer,
   CATMAT, geração, exports com `organizationId` do cliente).

**Avaliação do Contexto Canônico:** sólido após a #258. Política de autoridade explícita e aplicada na escrita
e na leitura; `ai_draft` não afirma nenhum fato; `sourceQuantity` nunca afirma `plannedQuantity`; conflito
nunca resolvido em silêncio. Riscos remanescentes: (a) `unitReferencePrice` = média aritmética sem método/decisão
(SEM-P1 PRICE); (b) preço canônico ignora `sourceState` do Item Inteligente; (c) descrição/unidade do item
sempre projetadas como `user/confirmed` (proveniência achatada); (d) `writePlannedQuantity` usa `appendContextFacts`
direto, contornando a checagem de política de `recordContextAssertions` (hoje inócuo — fonte `user` é permitida).

**Avaliação do Document Engine:** o **corpo** emitido é imutável, versionado, com SoD e hash (correto). Falhas:
cabeçalho institucional re-renderizado com a identidade **atual** em versões emitidas via promoção; regeneração
sobrescreve edição humana; documentos a jusante leem **rascunhos** a montante (e a lineage afirma `tr_aprovado`
fixo); emissão sem pré-condições semânticas (fontes alteradas, `[REVISAR]`, ordem TR→Edital).

**Avaliação dos workflows:** a camada canônica nova (C.2B review, promoção oficial, reconciliação DFD, Itens da
Contratação) é governada (CAS, idempotência com payload hash, ledger, SoD). A dívida está em: status derivados de
ponteiros de etapa (Contratação Direta), transições que contornam a máquina de estados (contrato, `updateStage`
→ ISSUED), aprovações não vinculadas a versão (legados), e o parecer não governando o domínio que o solicitou.

---

## 3. Heatmap (Entregável 2 / H)

Legenda: OK · atenção · P2 · P1 · **P0** (pior achado da célula).

| Módulo | Semântica | Authority | Provenance | Stale | Explainability | Ownership | Replay | Tenant | Risco geral |
|---|---|---|---|---|---|---|---|---|---|
| Processo Licitatório | P1 | **P0** (updateStage→ISSUED) | P2 | OK | P2 | OK | **P0** (upsert reset) | OK | **P0** |
| Contexto Canônico | OK | OK (pós-#258) | P2 | OK | OK | atenção | OK | OK | P1 |
| DFD | OK | OK | P2 | OK | OK (pós-#258) | P1 (sem "aprovado") | OK | OK | P1 |
| ETP | P1 | P1 | P2 | P2 | **P0** (regerar) | P1 | OK | OK | **P0** |
| TR | **P0** (qtd cotada legado) | P1 | P1 | P2 | **P0** | P1 | OK | OK | **P0** |
| Edital | **P0** (params padrão) | P1 | P1 | P1 | **P0** | P1 | OK | OK | **P0** |
| Pesquisa de Preços | P1 | P1 | P1 | P1 | P1 | P1 | **P0** (colagem sobrescreve) | OK | **P0** |
| Itens Inteligentes | P1 | **P0** (RBAC approve) | P1 | P1 | P1 | P1 | OK | P2 | **P0** |
| Itens da Contratação | P1 | P1 | P2 | P1 | P1 | OK | P1 | OK | P1 |
| Lotes | P2 | OK | P2 | OK | P2 | P1 | OK | OK | P1 |
| Contratação Direta | **P0** (catálogo; valor) | **P0** (ratificação) | P1 | P1 | **P0** | P1 | **P0** (upsert) | OK | **P0** |
| Parecer Jurídico | **P0** (IA conclui — legado) | **P0** (aprovador do cliente) | P1 | P1 | **P0** (editor zera) | P1 | **P0** (createDraft reset) | OK | **P0** |
| Contratos/Aditivos | **P0** (limite 50%) | P1 | P1 | P1 | **P0** (editor) | P1 | **P0** (upsert) | P1 | **P0** |
| Centro de Operações | P1 | OK | P2 | — | P1 | OK | OK | OK | P1 |
| Relatórios/Dashboards | **P0** (centavos) | P2 | P2 | — | P1 | P1 | OK | P1 | **P0** |
| Exports DOCX/PDF | P1 | OK | P1 | — | P1 | P1 | OK | P1 (orgId do cliente) | **P0** (cabeçalho) |
| Document Engine | OK | P1 | P1 | P2 | P1 | P1 | OK | OK | **P0** (ver ETP/Edital) |
| Workflows/aprovações | P1 | **P0** (legados) | P1 | — | P1 | P1 | P1 | OK | **P0** |
| IA / Cognitive | P1 | OK (canônico) / **P0** (legado) | OK | — | P1 | OK | P1 | OK | **P0** (legado) |
| Provenance/Auditoria | — | — | P1 | — | — | — | P1 (timeline upsert) | P2 | P1 |
| Colaboração/Tarefas | P1 | P1 | P2 | — | P2 | P1 | OK | **P0** | **P0** |

---

## 4. Achados P0 (Entregável 3 / E)

Formato resumido por achado: **evidência → cenário → impacto → correção conceitual**. Migração só quando indicada.

### Classe A — Segurança / tenant

**SEM-001 · P0 · Colaboração: lookups globais, membro de outro tenant, enumeração de e-mail e vazamento de PII** — `canônico/legado-UI` (usado por `MembersDialog`, `StageAssignmentPanel`)
- Evidência: `server/routers/collaborationRouter.ts:32-82` `addMember` é `protectedProcedure`; usa
  `db.getProcessById(input.processId)` e `db.getUserByEmail(input.userEmail)` **globais**; `assignStage` (:198-238)
  aceita `assignedUserId` global via `getUserById` global (`db/users.ts:124`); `listMembers` devolve nome/e-mail
  (`db/collaboration.ts:128-143`, join sem tenant).
- Cenário: dono de um processo no órgão A adiciona `alguem@orgB` → o erro "Usuário não encontrado" enumera e-mails
  de todos os tenants; se existir, o usuário de B vira membro/"responsável pela etapa" do processo de A, recebe
  notificação com o nome do processo de A, e o nome dele é gravado no activity log de A.
- Impacto: violação de isolamento multi-tenant (PII + atribuição de responsabilidade a pessoa de outro órgão) —
  mesma classe "pessoa tecnicamente disponível ≠ pessoa institucionalmente válida".
- Correção: `tenantProcedure`; resolver processo `ForOrganization`; exigir que o usuário-alvo tenha membership
  em `ctx.organizationId`; mensagem de erro neutra. Auditoria/backfill de linhas cross-org existentes em
  `process_members`/`stage_assignments`. Sem migration de schema.
- Nota de parada: não há evidência de exploração ativa; por isso a auditoria **não foi interrompida**, mas este é
  o primeiro item recomendado para correção.

### Classe B — Sobrescrita silenciosa por ID determinístico + upsert

**SEM-002 · P0 · `createProcess` (licitação) reseta processo existente com o mesmo número** — `canônico`
- Evidência: `server/db/procurement.ts:73` `onDuplicateKeyUpdate({ set: { currentStage, status, modality, updatedAt } })`;
  id = `sha256(plp:org:processNumber)`; sem chave de idempotência. Router `procurementProcessRouter.ts:99-108`
  ainda registra `demand.requestingUnit` (fonte `process`) no processo existente.
- Cenário: segundo operador cria "100/2026" (reuso/erro de digitação) → processo emitido volta à etapa inicial e
  "rascunho"; a resposta ecoa objeto/responsável que não foram persistidos; um fato de unidade é anexado ao processo alheio.
- Correção: insert puro com CONFLICT em chave natural duplicada + chave de idempotência real para retry.

**SEM-003 · P0 · Contratação Direta: `createProcess` com número existente reseta o workspace** — `canônico`
- Evidência: `domain/directProcurementWorkspace.ts:109-111` id `hash(org, processNumber)`;
  `db/directProcurement.ts:51-54` upsert de `procurementType, legalBasis, currentStage, status, flags`.
- Cenário: processo ratificado/publicado volta a NEW/"rascunho", pode trocar dispensa↔inexigibilidade e flags padrão.
- Correção: CONFLICT (padrão `ManualContractConflictError`).

**SEM-004 · P0 · Ratificação: default "ratificado", clicante como autoridade, upsert mantém 1º responsável/data** — `canônico`
- Evidência: `directProcurementRouter.ts:252-262` `ratify` (`tenantProcedure`, qualquer papel) com `decision` opcional e
  `responsible: ctx.user.id`; `directProcurementJustifications.ts:175` `decision ?? "ratificado"`; id `rat:org:ws`
  (:172); `db/directProcurement.ts:243` upsert só de `decision/justification/evidence`; Termo imprime
  `Autoridade responsável (id)` (`directProcurementService.ts:334`); UI pré-seleciona "ratificado"
  (`RatificationWorkspace.tsx:18,27-40`) sem mostrar ratificação existente.
- Cenário: autoridade A registra "não ratificar"; servidor B clica "Registrar ratificação" com o padrão → registro
  diz "ratificado" por A, na data de A; `publish` libera o Termo. Chamada vazia ratifica positivamente (art. 72, VIII).
- Impacto: **mesma classe do `responsibleUser`** (quem digitou ≠ autoridade competente) + decisão jurídico-administrativa
  por default. Teste `sprint5z-direct-procurement.test.ts:177-179` **protege o bug**.
- Correção: decisão obrigatória + justificativa; papel mínimo/competência; `decidedBy` ≠ `recordedBy`; ledger
  append-only por decisão com superação explícita; precondição de parecer quando exigido. **Migration: sim.**

**SEM-005 · P0 · Pesquisa colada: segunda colagem sobrescreve cotações da primeira** — `canônico`
- Evidência: `domain/priceResearch.ts:50-52` research id `prw:org:process:source` (uma pesquisa por fonte);
  `:80-82` quote id `pri:org:research:index:descrição`; `db/procurement.ts:172-175` upsert de valor/fornecedor;
  `priceQuoteConsolidation.ts:172-177` "a cotação entrante substitui a existente".
- Cenário: colagem 1 `Caneta;10;un;2,00;Fornecedor A`, colagem 2 `Caneta;10;un;2,50;Fornecedor B` → mesma quoteId,
  cotação A desaparece, média vira 2,50 com 1 cotação; item decidido vai a `source_changed`.
- Correção: id de pesquisa por importação (chave de idempotência); quote id por linhagem de linha da importação;
  dedup por `contentHash`.

**SEM-006 · P0 · Parecer canônico: `createDraft` reseta parecer assinado/editado** — `canônico`
- Evidência: `domain/legalOpinionDraft.ts:82-84` id `hash(org, ws, opinionType)`; `db/legalOpinionWorkspace.ts:123-129`
  upsert inclui `signed, signedBy, signedAt, version, report…`; versão v1 também sobrescrita (`:177`);
  `legalOpinionWorkspaceService.ts:224-247` grava rascunho/versão/documento **antes** de `transitionLegalStage`
  lançar SIGNED→DRAFT.
- Cenário: nova chamada `createDraft` em parecer assinado → fica não assinado, v1, texto novo; usuário vê erro mas o
  dado já foi corrompido.
- Correção: rejeitar se já existe; validar estágio antes de qualquer escrita; versões append-only.

**SEM-007 · P0 · Contrato: colisão de upsert sobrescreve contrato vigente** — `canônico`
- Evidência: `contractWorkspace.ts:81-83` id `hash(org, originType, contractNumber)`; só `createManual` checa conflito;
  `db/contractWorkspace.ts:60-63` upsert de `contractor/object/value/term/status(→minuta)/manager/inspector`
  mantendo `originProcess`; import sem número usa "IMPORTADO" (`contractService.ts:134`).
- Cenário: contrato vigente vira "minuta" com objeto de outro processo apontando para o original; 2º import sem número
  sobrescreve o 1º.
- Correção: CONFLICT em todos os caminhos de criação.

### Classe C — Fonte semanticamente errada chegando a documento institucional

**SEM-008 · P0 · Modo legado: quantidade da cotação vira quantidade da contratação em TR/Edital/ETP** — `canônico` (processos sem Itens da Contratação)
- Evidência: `authoring/authoringContext.ts:390-392` `quantity: i.quantity` (Item Inteligente); `:285` texto legado;
  `editalContext.ts:198-202`; `domain/authoritativeItems.ts:71,123` total = qtd × média;
  `procurementProcessService.ts:890` `assertCanonicalQuantitiesComplete` → `if (!canonical) return;`.
- Cenário: cotação coletada para 1 UN → TR e Edital "1 UN" e valor estimado 1 × média. É exatamente a classe
  `sourceQuantity ≠ plannedQuantity` que o modo canônico já resolve.
- Testes: `tr-canonical-quantity-mysql-smoke.test.ts:203`, `canonical-document-quantity.test.ts:167` **codificam** o legado.
- Correção: TR/Edital fail-closed sem Itens da Contratação (ou coluna "quantidade da cotação — não confirmada" com
  emissão bloqueada).

**SEM-009 · P0 · Edital: parâmetros não hidratados do rascunho — "Gerar edital" regenera com padrões** — `canônico`
- Evidência: `EditalWorkspace.tsx:73-76` `useState("pregao"/"eletronico"/"compras_gov")`; `reviewableDraft`
  (`procurementProcessRouter.ts:553-561`) não retorna modalidade/forma/plataforma; `editalSourceState` usa seleções da UI.
- Cenário: Edital gerado como concorrência/presencial → após reload, "Gerar edital" regenera silenciosamente como
  pregão/eletrônico/Compras.gov; o indicador de desatualização acende/apaga conforme o dropdown.
- Correção: hidratar do rascunho persistido; staleness contra parâmetros armazenados; troca de parâmetro como ação
  explícita (atual × proposto).

**SEM-010 · P0 · Catálogo legal legado mistura hipóteses da Lei 8.666 em numeração da Lei 14.133 + mapeamento por substring** — `canônico` enquanto o reference set governado estiver DRAFT *(requer validação jurídica)*
- Evidência: `server/scripts/seedDirectContractLegalArticles.ts` (75, I com limites trocados; 75, III/IV/VIII e 74, IV
  com hipóteses da 8.666; 75, II ausente); `directContractsRouter.ts:230-231` usa o catálogo como caminho único;
  `:275` `article.includes("75, I") ? "art75_i_a" : "art75_ii_outros"` → incisos III/IV/VIII/XII/XIII recebem teto de R$100k;
  alimenta prompts de IA (`directContractDocuments.ts:108,133`).
- Impacto: fundamento legal errado em documentos de contratação direta.
- Correção: congelar o catálogo legado para novos registros ou corrigir sob revisão jurídica; mapear por inciso exato.
  Migração de dados.

**SEM-011 · P0 · Limite de aditivo 50% para todo contrato (art. 125)** — `legado-API` (`/contracts`) *(requer validação jurídica)*
- Evidência: `services/contractValidation.ts:32` `originalValue * 0.5`; supressões compensadas com acréscimos
  (`contractsRouter.ts:221-223`); prazo teto fixo 120 meses; `newTotalValue` do cliente sobrescreve `currentValue` (:270).
- Teste `auditCorrections.test.ts:63-97` **protege** os 50%.
- Correção: 25% geral / 50% só reforma de edifício ou equipamento; acréscimos e supressões separados; total derivado no servidor.

**SEM-012 · P0 · Valores em centavos exibidos como reais (100×) em saídas institucionais** — `canônico` (analytics da Contratação Direta, relatório de auditoria) / `legado-API` (relatório de processo)
- Evidência: `schema.ts:1063` `value // em centavos`; cliente grava `parseFloat(value) * 100` (`NewDirectContract.tsx:186`);
  `directContractAuditReport.ts:62` imprime `R$ ${contract.value…}`; `MetricsGrid.tsx:37-42` "Valor Total Contratado" = `SUM(value)` sem /100
  (e o valor é **estimado**, somando rascunhos/cancelados); `processReportService.ts:45` idem para `estimatedValue`.
- Cenário: dispensa de R$ 12.345,67 aparece como "R$ 1.234.567,00".
- Correção: formatador monetário único em centavos; KPI filtrado por status e rotulado "valor estimado".

### Classe D — Documento oficial / versão / aprovação

**SEM-013 · P0 · Versões emitidas de DFD/ETP/TR/Edital reexportam com a identidade institucional ATUAL** — `canônico`
- Evidência: `documentPromotionService.ts:149-160` cria a versão `emitido` via `createDocument` sem
  `institutionalIdentitySnapshot` (nem `processNumber`/`object`); `officialDocumentExportAdapter.ts:128-131`
  `institutionalIdentityFromMetadataOrLive` cai para a identidade vigente (o comentário afirma replay-safe — não é
  para esta via); nome de arquivo/cabeçalho sem nº do processo.
- Cenário: Edital emitido como "Prefeitura Alfa, CNPJ X"; cadastro alterado → reexportar a mesma v3 mostra outro
  cabeçalho e outro fingerprint. Corpo permanece imutável.
- Correção: snapshot da identidade + nº do processo + objeto na emissão (ou emitir via `generateOfficialDocument`);
  decisão documentada de backfill para versões já emitidas. Sem migration de schema (metadata JSON).

**SEM-014 · P0 · Regenerar ETP/TR/Edital sobrescreve rascunho editado por humano, sem confirmação** — `canônico`
- Evidência: `procurementProcessService.ts:782-783` `expectedState` capturado **no servidor** (não o que o usuário viu);
  `db/procurement.ts:588-595` `ai_regenerate` troca conteúdo; `ETPWorkspace.tsx:81-88`, `TRWorkspace.tsx:77-84`,
  `EditalWorkspace.tsx:186-193` sem confirmação/diff; `DraftEditor` ressincroniza e descarta texto não salvo;
  `generated_document_edits.previous_content` é gravado mas **nenhum código o lê** (sem restauração).
- Cenário: jurista reescreve a seção 5 do TR; colega clica "Gerar TR" para pegar preço novo → edição desaparece da UI.
- Teste `c4b3a-draft-provenance-mysql-smoke.test.ts:117` codifica a sobrescrita.
- Correção: cliente envia o hash que viu; regerar sobre conteúdo humano/importado exige `confirmReplace` + diff;
  tela de histórico/restauração. (Padrão já usado na justificativa do DFD.)

**SEM-015 · P0 · `procurementProcess.updateStage` leva o processo a ISSUED/"emitido" sem Edital oficial** — `canônico` (API)
- Evidência: `procurementProcessRouter.ts:151-164` (`operator`) → `advanceStage` (`domain/procurementProcess.ts:131-136`)
  retorna `emitido` a partir de REVIEW; `stage: "ISSUED"` explícito também aceito. `issueProcess` (manager + Edital oficial) é contornado.
- Correção: `updateStage/setStage` rejeitam ISSUED/ARCHIVED; só `issueProcess` emite.

**SEM-016 · P0 · Parecer legado: aprovador vindo do cliente, autor aprova, aprovado continua editável e o export acompanha, assinado pode ser excluído** — `legado-UI` (`/parecer/:id` roteado)
- Evidência: `legalOpinionsRouter.ts:145-187` `update` (`tenantProcedure`) aceita `status: "approved"` e
  `reviewedBy` do input; UI envia `reviewedBy: user?.id` (`LegalOpinionDetails.tsx:130`); só bloqueia se houver
  assinatura; `delete` (:192-198) sem checagem; export (`legalOpinionExportService.ts:59-72`) reconstrói da linha
  mutável com `version: 1` fixo e identidade viva; hash de assinatura não cobre `conclusion` (:365,383);
  `verifySignature` lê `signatureId` inexistente (sempre `signed:false`).
- Correção: `reviewedBy = ctx.user.id`; SoD e papel mínimo; congelar em `approved`; versões; bloquear delete de
  aprovado/assinado; incluir conclusão no hash. Preferível: migrar para o workspace canônico.

**SEM-017 · P0 · Parecer legado: IA sobrescreve parecer assinado, inclusive a conclusão favorável/desfavorável** — `legado-UI/API`
- Evidência: `legalOpinionsRouter.ts:266-314` `generateOpinion` grava `opinion/conclusion/citedArticles` do LLM sem
  checar assinatura/status/idempotência; `legalOpinionService.ts:163` `JSON.parse` sem Zod (viola CLAUDE.md);
  UI só esconde o botão. Export mantém o bloco de assinatura original sobre o conteúdo novo.
- Impacto: **conclusão jurídica definida por IA** sobre documento assinado.
- Correção: IA só em campo/versão de rascunho; conclusão exclusivamente humana; bloquear após assinatura; Zod.
  Migration provável (coluna/versão de rascunho).

**SEM-018 · P0 · `documents.approveDocument` legado aprova de qualquer status, sem SoD/papel/`approvedBy`** — `legado-API`
- Evidência: `documentsRouter.ts:737-752` só checa `process.ownerId === ctx.user.id`, que costuma ser o autor
  (`generateNext` grava `createdBy: ctx.user.id` em conteúdo gerado por IA). Contorna `documentReviewService` (C.2B).
- Correção: remover ou delegar a `decideDocumentReview`; teste de congelamento.

### Classe E — Ações cegas / formulários que apagam o valor salvo

**SEM-019 · P0 · Editor do parecer canônico abre vazio e com "Favorável"; "Salvar nova versão" apaga campos** — `canônico`
- Evidência: `LegalOpinionEditor.tsx:29-34` `useState("")` e `conclusionType = "favoravel"` mesmo com `hasDraft`;
  envia strings vazias; servidor só filtra `undefined` (`legalOpinionWorkspaceRouter.ts:139`).
- Cenário: parecer **desfavorável** com uma ressalva corrigida → nova versão com relatório e fundamentação vazios e
  conclusão "Favorável", pronta para assinar no painel abaixo.
- Correção: hidratar do rascunho; nunca default de conclusão; servidor rejeita vazio que apaga conteúdo existente.

**SEM-020 · P0 · Contratação Direta: "Anexar"/"Validar" documento obrigatório com referência falsa** — `canônico`
- Evidência: `RequiredDocumentsWorkspace.tsx:24` `documentReference: status === "anexado" ? "s3://anexo" : ""`;
  servidor (`updateRequiredDocumentStatus`) grava sem validar.
- Cenário: checklist inteiro "Validado" sem nenhum arquivo; processo segue para ratificação.
- Correção: anexar = upload real (S3, chave por módulo/processo) com hash; validar exige anexo existente.

**SEM-021 · P0 · Justificativa por "copilotos" vira documento oficial sem aceite humano (e regerar sobrescreve)** — `canônico`
- Evidência: `directProcurementService.ts:77-125` `generateContractJustification` com textos fixos (`publicInterest`,
  `alternatives`), upsert por id determinístico e `generateOfficialDocument(author: "multi_copilot")`; sem endpoint
  de edição/aceite; texto usado no Termo de Ratificação (`buildRatificationContent`).
- Correção: saída como sugestão rascunho; campos factuais vazios em vez de afirmados; oficial só após aceite humano.

**SEM-022 · P0 · Justificativa de preço: formulário vazio sobrescreve a salva e emite documento oficial** — `canônico`
- Evidência: `PriceJustificationWorkspace.tsx:59-62` não hidrata; upsert `onDuplicateKeyUpdate({ set: { source, justification, referenceValue… } })`;
  emite "Valor de referência: R$ …"; `researchId/referenceValue` vêm do cliente sem validação contra a pesquisa (DC-9).
- Correção: hidratar; derivar valor da pesquisa armazenada; confirmação com atual × novo.

**SEM-023 · P0 · "Salvar contrato" altera valor/contratado/objeto de contrato vigente sem aditivo e sem controle de concorrência** — `canônico`
- Evidência: `ContractEditor.tsx:20-32` inicializa uma vez; `updateContractFields` faz `{ ...ws, ...patch }` sem guarda
  de status/revisão; `updateContract` não registra evento (`contractWorkspaceRouter.ts:142-161`).
- Correção: campos econômicos só por aditivo/apostilamento; CAS de revisão; evento com antes/depois.

**SEM-024 · P0 · Termo Aditivo/Apostilamento gerado ignora os dados do próprio instrumento** — `canônico`
- Evidência: `contractService.ts:164-175` monta `CLÁUSULA n. ${sugestão do copiloto}` + cabeçalho; recebe `refId`
  mas não lê `justification/newValue/newTerm` do aditivo nem `newValue/newManager/newInspector` do apostilamento; autor `multi_copilot`.
- Correção: termo a partir do instrumento persistido; IA como sugestão rotulada.

**SEM-025 · P0 · Aditivo/apostilamento "ressuscita" contrato rescindido e marca "aditado" antes do parecer** — `canônico`
- Evidência: `contractService.ts:255,275` chama `updateContractWorkspaceStatus(…,"aditado"/"apostilado")` direto,
  contornando `STATUS_TRANSITIONS`.
- Correção: `transitionContractStatus`; recusar estados terminais; status só após conclusão do instrumento.

### Classe F — RBAC / autorização que eleva preço a canônico

**SEM-026 · P0 · Itens Inteligentes: viewer aprova item e confirma CATMAT** — `canônico` (API)
- Evidência: `itemIntelligenceRouter.ts:131` `approveItem: tenantProcedure` e `:152` `decidirCATMAT: tenantProcedure`
  (equivalente canônico `procurementProcess.approveItem` é `orgRoleProcedure("operator")`); sem checagem de
  `processId`/`sourceState`.
- Impacto: aprovação torna `averagePriceCents` o `unitReferencePriceCents`/estimativa canônica e o item entra em
  "Itens aprovados" do ETP/TR.
- Correção: `orgRoleProcedure("operator")` + `processId` obrigatório e conferido, ou remover a rota duplicada; teste RBAC.

---

## 5. Achados P1 e P2 por classe (Entregável 4 / F–G)

### 5.1 Autoridade / fonte (K)
- **SEM-027 P1** Média aritmética de cotações apresentada como "valor de referência", sem método/decisão humana (média/mediana/menor) nem exclusão de outliers — `canonicalProcurementContext.ts:262-266,355-357`; `authoritativeItems.ts:119-127`; `consolidateQuotes/avgOf`; `detectPriceOutlier` só registra risco. (Migration provável para método/exclusão.)
- **SEM-028 P1** Preço canônico ignora `sourceState` do Item Inteligente (`source_changed`/`review_required`) — `canonicalContextService.ts:50-53`; tabela autoritativa sem flag (`AuthoritativeItemInput` sem `sourceState`).
- **SEM-029 P1** Objeto digitado no navegador sobrepõe `process.object` em ETP/TR/Edital (política diz só `process`) — `authoringContext.ts:154`, `editalContext.ts:148`, routers :351-356/476/481-490.
- **SEM-030 P1** Aprovação da **sessão de importação** (extração correta) autoriza candidatura do item à contratação independente do status do Item Inteligente — `procurementItems.ts:234-237`; painel de candidatos não mostra status/preço.
- **SEM-031 P1** Vínculo de preço aceito para qualquer item ativo sem compatibilidade de unidade; troca de unidade após vínculo não revalida (preço por CX × quantidade em UN) — `planCandidateDecisions:403-407`, `updateProcurementItem:541-567`, `resolveCanonicalContext:372`.
- **SEM-032 P1** Valor **estimado** usado como valor do contrato na minuta; cotação selecionada (`isSelected`) nunca lida; "PARECER… Recomenda-se a contratação" fabricado no Mapa Comparativo — `directContractDocuments.ts:356,547-548`; `schema.ts:1063,1153`. (Migration: `contractedValue`.)
- **SEM-033 P1** Valor/status alteráveis após validação (inclusive autoaprovação) em `directContracts.update` sem revalidar limite — `directContractsRouter.ts:346-399`.
- **SEM-034 P1** CATMAT legado aprova código de IA sobre o item (e pode aplicar sugestão de outro item), trocando a descrição humana — `processesRouter.ts:262-296`.
- **SEM-035 P1** Endpoints legados de CATMAT (`acceptCATMAT` confia no código do cliente; `manualCATMAT` fora do ledger) — `itemIntelligenceRouter.ts:74-112`.
- **SEM-036 P1** Legado `documents.generateNext`/`generateDocument` gera ETP/TR/Edital com `estimatedValue || 0`, sem tabela autoritativa, idempotência ou digest; move `em_parecer → concluido` sem aprovação — `documentsRouter.ts:166-323,360+`.
- **SEM-037 P2** `writePlannedQuantity` grava no ledger via `appendContextFacts` direto, contornando a checagem de política de `recordContextAssertions` — `procurementItemsService.ts:135`. Hoje inócuo.
- **SEM-038 P2** Política permite `intelligent_item` como fonte de descrição/unidade, mas não há escritor — autoridade morta/ambígua.

### 5.2 Proveniência / lineage (L)
- **SEM-039 P1** Documentos a jusante leem **rascunhos** a montante; lineage do Edital grava `"tr_aprovado"` fixo — `authoringContext.ts:384-385`, `editalContext.ts:322-324`, `procurementProcessService.ts:998`.
- **SEM-040 P1** Aditivos/apostilamentos compartilham uma lineage por contrato (Aditivo nº2 = "v2" do nº1); sem `addendumId` no oficial — `contractService.ts:197-202`, `officialDocument.ts:74`. (Migration/backfill.)
- **SEM-041 P1** "Fixação" do documento analisado pelo parecer é fictícia (versão default 1; snapshot = hash sem conteúdo) — `documentReference.ts:37-43`; snapshots do rascunho sem `foundation/conclusionType`.
- **SEM-042 P1** Justificativa de preço sem linhagem (valor do cliente, "Baseado na Pesquisa… confiança 0,85" fixo); `characterizeNeed`/`importDFD` retornados mas não persistidos (tela mostra sucesso falso) — `directProcurementService.ts:173-175`, router :108-137.
- **SEM-043 P1** Export oficial não registra `replayHash`/`contentHash`/SHA do artefato; DOCX e PDF da mesma versão sobrescrevem `storageKey/hash` — `officialDocumentExportAdapter.ts:172-186`, `officialDocumentLifecycleService`.
- **SEM-044 P2** Edição humana não deixa marcador; ETP reescrito por humano aparece como "gerado" — `db/procurement.ts:587-590`, `authoringContext.ts:353-357`.
- **SEM-045 P2** Descrição/unidade do item canônico sempre projetadas como `user/confirmed` (proveniência achatada) — `canonicalProcurementContext.ts:343-344`.
- **SEM-046 P2** Activity report lê campos inexistentes (`userName`, `description`) → tudo "Sistema"; `download.*` grava logs sem `organizationId` — `ActivityReport.tsx:61-63`.

### 5.3 Stale / reconciliação (M)
- **SEM-047 P1** Digest global único de ETP/TR/Edital: falso positivo (`pendingItemCount`, status/origin do DFD, parâmetros da UI) e falso negativo (mudança fora do orçamento de excerto 6000/4000 chars); UI só diz "fontes mudaram" sem listar o quê — `authoringContext.ts:136-137,181`; `AuthoringSourcesSummary.tsx:67-72`.
- **SEM-048 P1** Correção de extração aceita após aprovação/promoção sem re-revisão (contorna operador revisa/gestor promove); update+histórico fora de transação; idempotência só por chave — `importStagingService.ts:240-342`, `ingestionRouter.ts:678-728`.
- **SEM-049 P1** `item_source_links.sourceQuantity` congelado no vínculo; "Usar N" pode adotar valor antigo do DFD — `procurementItemsService.ts:511-515`.
- **SEM-050 P1** Governança de Itens falha **aberta** (`.catch(() => null)`) → mudança em item consumido por documento aprovado classificada como "define" — `procurementItemsService.ts:60,64,149-151`.
- **SEM-051 P1** Estado "aprovado" de `generated_documents` nunca é escrito: `assertDFDMutable` e `itemsConsumedByApproved` são inalcançáveis; DFD não tem emissão — `generatedDocument.ts:157` (só testes), `procurementItemsService.ts:64-69`.

### 5.4 Ações cegas / explicabilidade (N)
- **SEM-052 P1** "Aplicar cotações atualizadas (N)" troca cotações/média e revoga a aprovação em 1 clique; antigo × novo só em tooltip — `ItemIntelligenceWorkspace.tsx:175-184`; `itemMaterializationService.ts:344-349`.
- **SEM-053 P1** "Promover conteúdo revisado" não diz que Itens Inteligentes existentes serão mesclados/recalculados/marcados — `PromoteToDomainPanel.tsx:96-100`.
- **SEM-054 P1** "Aprovar" Item Inteligente habilitado com "Fonte alterada"/"Identidade a revisar"; sem mostrar outliers/impacto no preço canônico — `ItemIntelligenceWorkspace.tsx:186-201`, `ProcurementItemPanel.tsx:508-516`.
- **SEM-055 P1** "Usar N" substitui quantidade humana sem confirmação; rótulo "Quantidade no documento" para quantidade **cotada**; painel em massa pré-marcado e escolhe a 1ª fonte (pode ser cotação) — `ProcurementItemsWorkspace.tsx:251-254`, `procurementItemsView.ts:67-70`, `adoptableQuantities:93-100`.
- **SEM-056 P1** Campo "Quantidade prevista" não ressincroniza após write (`useState` fixo) → "Salvar" reverte o valor — `ProcurementItemsWorkspace.tsx:175,231-237`.
- **SEM-057 P1** "Emitir documento oficial" sem pré-condições semânticas (source_changed, `[REVISAR]`, ordem TR→Edital) e com edição não salva no editor acima; sem diff contra a última emitida — `documentPromotionService.ts:80-137`, `OfficialPromotionSection.tsx:199-227`.
- **SEM-058 P1** Justificativa do DFD por IA substitui texto importado/pré-preenchido sem aviso (confirmação só em `user_modified`) — `DFDWorkspace.tsx:270-278`.
- **SEM-059 P1** "Sugerir artigo" (IA) troca dispensa↔inexigibilidade e limpa o artigo escolhido sem aceite — `NewDirectContract.tsx:80-102`.
- **SEM-060 P1** Rótulos que não correspondem ao efeito: "Gerar publicações" também avança etapa; "Importar DFD" legado só registra evento; LegacyImportWizard diz "você confirma" e grava direto; CopilotPanel "Aceitar/Rejeitar" sem handler; "Assinar parecer" irreversível sem confirmação.
- **SEM-061 P2** "Substituir rascunho" (import) confirma sem mostrar o conteúdo atual; CATMAT "Confirmar" sem decisão vigente; limiar CATMAT sem confirmação de impacto org-wide.

### 5.5 Ownership (O)
- **SEM-062 P1** Contratos não herdam nada de adjudicação/ratificação (valor 0, contratado ""), sem itens (planejado × contratado impossível de rastrear); apostilamento de gestor/fiscal não atualiza o contrato — `contractService.ts:83-87`, `NewContractWizard.tsx:82-84`. (Migration: itens do contrato.)
- **SEM-063 P1** Parecer devolvido não governa o domínio solicitante (ratificação/publicação não leem; aditivo `aguardando_parecer` nunca avança) — `legalOpinionWorkspaceService.ts:432-437`, `contractService`.
- **SEM-064 P1** Status da Contratação Direta derivado do ponteiro de etapa (ratificado/publicado sem ato registrado); `configureFlags(requiresLegalOpinion:false)` sem evento; `publish` gera extrato de contrato inexistente — `directProcurementWorkspace.ts:156-177`, router :276-285.
- **SEM-065 P1** Geração de minuta de rescisão já marca contrato `terminated` (legado) — `contractsRouter.ts:723-725`.
- **SEM-066 P1** Termos legados usam dados atuais (apostila "de X para X"); contratos ativos editáveis; audit só com nomes de campo — `contractsRouter.ts:129-168,328-331`, `contractDocuments.ts:451`.
- **SEM-067 P1** Lote arquivado mantém código reservado e gera membership pendente — `db/procurementItems.ts:111-121`, `planCandidateDecisions:430-433`. (Migration se mudar o índice.)
- **SEM-068 P1** Linhas idênticas do DFD colapsam (`sourceItemKey` sem nº da linha) → `DUPLICATE_DECISION` bloqueia confirmação — `procurementItems.ts:295,395`.
- **SEM-069 P1** Re-adicionar item retirado não faz nada e reporta sucesso — `procurementItemsService.ts:391-397`.

### 5.6 Relatórios / operações / exports
- **SEM-070 P1** Centro de Operações: "Contratos vencendo" conta eventos (6 por contrato, sem janela); "Tarefas pendentes" sempre 0; "Atrasado" nunca aparece; "Concluídos" inclui arquivados/entrada em PUBLICATION; contagens truncadas (200/500, filtro em memória após `limit`) — `departmentOperationService.ts:49-184`, `db/departmentOperation.ts:66-69`.
- **SEM-071 P1** Gestão: três definições de "Atrasada" (KPI calculado × status manual × Excel); cores de prazo divergentes da regra documentada; botões Excel/PDF chamam procedures inexistentes via `as any`; responsável de tarefa não validado (ID cru) — `TaskDashboard.tsx:16`, `taskReports.ts:123,204`, `DepartmentManagement.tsx:17,44`, `departmentTasksRouter.ts:22-58`.
- **SEM-072 P1** Pacotes (publicação legado, contratação direta) empacotam todas as versões/status com nomes colidentes e Markdown como `.pdf` — `zipService.ts:59`, `directContractPackage.ts:45-50`.
- **SEM-073 P1** Routers de export aceitam `organizationId` do cliente (`protectedProcedure`): `exports.generate/getHistory/getPreview`, `structuredExport.*`, `itemAnalytics.getDashboard`, `reviewWorkspace.getSummary` — `exportRouter.ts:23-100`. Impacto hoje limitado (stores em memória, páginas não roteadas), mas rotas montadas.
- **SEM-074 P1** Analytics/Auditoria leem tabelas legadas sem escrita (`processes`, `documents`) — `db/admin.ts:124-153`.

### 5.7 Workflow / replay / auditoria / IA (R, S, U)
- **SEM-075 P1** `idempotencyService`: linha "failed" não é re-reservada (retries concorrentes rodam — IA duplicada); payload hash não atualizado após falha (payload diferente cacheado sob hash original); chave expirada nunca reativada; `operation` fora da unicidade — `idempotencyService.ts:47-70,151-160`.
- **SEM-076 P1** Timeline de eventos com id `sha256(org:process:count:eventType)` + upsert do `summary`: eventos concorrentes do mesmo tipo se sobrescrevem; `actor: "multi_copilot"` em vez do humano solicitante — `db/procurement.ts:407-419`, `procurementProcessService.ts:867`.
- **SEM-077 P1** Workflow de aprovação em memória (aprovador do input, sem tenant na escrita, mesmo aprovador contado N vezes); agentes marcam etapas "completed" com saída simulada — `approvalWorkflowRouter.ts:23-33`, `humanApprovalService.ts:80-89`, `agentExecutionEngine.ts:79-83`. Sem efeito colateral real encontrado.
- **SEM-078 P1** Conteúdo legado de `documents` muda in-place mantendo "approved" (`updateDocumento`, `publishDraft`, `restoreToVersion`) — latente, sem caller de router encontrado.
- **SEM-079 P1** `documents.restoreVersion` insere linha **sem `organizationId`** e pode copiar conteúdo entre processos do mesmo órgão (UI usa `VersionHistoryDialog`) — `documentsRouter.ts:605-611`. (Backfill + NOT NULL.)
- **SEM-080 P1** IA nos textos de ETP/TR: seção obrigatória "estimativa do valor" escrita pela IA; números na prosa nunca verificados; ETP sem bloco autoritativo — `authoringSchema.ts:64,88`, `structuredAuthoringService.ts:249-251`.
- **SEM-081 P1** "Valor estimado global" parcial apresentado como global (itens sem preço omitidos) — `authoringContext.ts:235-238`, `editalContext.ts:221`, `AuthoringSourcesSummary.tsx:57-63`.
- **SEM-082 P1** Justificativa de "presencial" é boilerplate aceito pela validação e nunca renderizado no Edital — `generatedDocument.ts:170-182`.
- **SEM-083 P1** SoD do parecer canônico: quem "recebe" vira advogado responsável; assinante não precisa ser o designado; chave HMAC = `JWT_SECRET` lida de `process.env` (viola regra de config; rotação invalida assinaturas) — `digitalSignatureService.ts:21`.
- **SEM-084 P1** Aditivos canônicos sem limite de valor/prazo e com sequência `count+1` → criação concorrente sobrescreve — `contractService createAddendum`.
- **SEM-085 P1** `contracts.number` único **global** (entre tenants) — `schema.ts:1227`. (Migration.)
- **SEM-087 P2** SoD da emissão exclui só autor e **último** editor; `issueProcess` não exige ETP/TR emitidos.
- **SEM-088 P2** `tenantIsolationAuditService` avalia registros fornecidos pelo chamador (não varre o banco) — falsa sensação de cobertura.
- **SEM-089 P2** `dfdj:${key}`.slice(0,64) pode colidir chaves longas.
- **SEM-090 P2** Quantidade nula gravada como 0 na promoção (0 entra na chave lógica).
- **SEM-091 P2** Credenciamento inexistente como regime; prompt de parecer legado lê `legalArticle` inexistente.
- **SEM-092 P2** Componente `WorkspaceDecisionPanel` com decisões fictícias ("Ana Souza", "Carlos Lima") como default — sem consumidor hoje (risco se reutilizado).

- **SEM-086 P1 (HIPÓTESE)** Rotas autorizadas por `ownerId` (`downloadRouter`, `platformsRouter`) sem checar membership vigente no tenant — usuário removido do órgão pode continuar exportando pacotes; não confirmado se a revogação de sessão cobre a remoção.

---

## 6. Matriz de contrato semântico (Entregável 5 / I)

| Fato/Campo | Owner canônico | Significado | Fontes permitidas | Fontes proibidas | Consumidores | Auto-prefill? | Exige revisão? | Pode ficar stale? | Impacto |
|---|---|---|---|---|---|---|---|---|---|
| `process.number` / `process.object` | Processo | Identificação e objeto formal | process | objeto digitado no navegador (SEM-029) | DFD, ETP, TR, Edital, títulos, digest | sim (DFD) | sim | não | alto |
| `demand.requestingUnit` | Contexto (necessidade) | Setor demandante | process (se informado na abertura), user, dfd, etp, tr, approved_document | organização, departamento do operador | DFD, justificativa IA | sim | sim | sim | médio |
| `demand.responsibleParty` | Contexto (necessidade) | Pessoa responsável pela demanda na unidade | user, dfd, etp, tr, approved_document | **process.responsibleUser (operador)** | DFD | não (sem fonte válida) | sim | sim | alto (#258) |
| `planning.*` (PCA, prioridade, prazo) | Contexto | Planejamento declarado | user, dfd, etp, approved_document | IA | DFD, justificativa IA | sim | sim | sim | médio |
| `items.*.description/unit` | Item da Contratação | Especificação da necessidade | user (Área de Itens), dfd, etp, tr, approved_document, (intelligent_item — sem escritor) | descrição do fornecedor sem confirmação | DFD, ETP, TR, Edital | sim | sim | sim | alto |
| `items.*.plannedQuantity` | Item da Contratação / Contexto | Quantidade a contratar | user, dfd, etp, tr, approved_document | **price_research, intelligent_item, ai_draft** | DFD, ETP, TR, Edital, estimativa | não (adoção explícita "Usar N") | sim | sim | **crítico** |
| `sourceQuantity` | Evidência (pesquisa/DFD) | Quantidade vista no documento-fonte | pesquisa, DFD | — | painel de itens ("Usar N") | não | — | sim (link congelado) | alto (SEM-008/055) |
| `intelligent_items.quantity` | Evidência | 1ª quantidade cotada (parte da identidade) | promoção | usar como necessidade | **modo legado TR/Edital/ETP (SEM-008)** | — | — | não | **crítico** |
| Cotação (valor unitário) | Evidência (pesquisa) | Preço observado | importação revisada | edição pós-aprovação sem re-revisão | média | — | sim | sim | alto |
| `averagePriceCents` | Item Inteligente (derivado) | Média aritmética das cotações | cálculo | — | preço canônico | automático | não (hoje) | sim | alto (SEM-027) |
| `unitReferencePriceCents` | Contexto (derivado) | Preço de referência institucional | média de item **aprovado** vinculado | item não aprovado; item `source_changed` (hoje aceito — SEM-028) | DFD orçamento, ETP/TR/Edital | automático | **deveria** (método) | sim | **crítico** |
| `estimatedTotalCents` | Contexto (derivado) | plannedQuantity × referência | cálculo quando ambos definidos | total parcial rotulado "global" (P1) | DFD, TR, Edital | automático | — | sim | alto |
| Valor estimado (Contratação Direta) | Contratação Direta | Estimativa | pesquisa/justificativa de preço | — | minuta, analytics, relatório | — | sim | sim | **alto (SEM-012/032)** |
| Valor contratado | Contrato | Valor pactuado | cotação selecionada / adjudicação | **valor estimado** (hoje usado) | contrato, aditivos | — | sim | não (snapshot) | **crítico** |
| Autoridade da ratificação | Contratação Direta | Autoridade competente que decide | ato da autoridade com competência | **usuário que clicou (hoje)**, default "ratificado" | Termo, publicação | não | sim | não | **crítico (SEM-004)** |
| Conclusão do parecer | Parecer | Juízo jurídico humano | advogado responsável | **IA (legado)**, default "Favorável" (canônico editor) | ratificação, aditivo, export | não | sim | não | **crítico** |
| Revisor/aprovador | Workflow | Quem aprovou aquela versão | `ctx.user` com papel e SoD | **input do cliente (legado)** | status, export | — | — | por versão | alto |
| Status "aprovado" de documento | Workflow/Document Engine | Aprovação de uma versão específica | ledger de review/promoção por hash | coluna mutável sem vínculo de versão | guardas de imutabilidade | — | — | deve invalidar em nova versão | alto (SEM-051) |
| Identidade institucional no cabeçalho | Documento oficial (snapshot) | Órgão na data da emissão | snapshot na emissão | identidade vigente em versão emitida | exports oficiais | — | — | não deveria | alto (SEM-013) |
| Parâmetros do Edital | Edital | Modalidade/forma/plataforma/critério | decisão humana persistida | padrão da UI | Edital, digest | não | sim | sim | alto (SEM-009) |
| CATMAT/CATSER | Item (decisão) | Código confirmado | decisão humana no ledger | sugestão de IA como confirmada (legado) | TR | não | sim | — | médio |
| Responsável pela etapa/tarefa | Colaboração/Gestão | Membro do órgão designado | membro do tenant | **usuário de outro tenant (SEM-001)**; ID não validado | Centro de Operações | — | — | — | alto |
| Documento obrigatório anexado | Contratação Direta | Evidência documental | arquivo real (S3) | **referência fictícia `s3://anexo`** | checklist, ratificação | — | sim | — | **crítico (SEM-020)** |

---

## 7. Matriz de transferências entre módulos (J)

| Origem | Campo origem | Destino | Campo destino | Transformação | Autoridade válida? | Supervisão? | Risco |
|---|---|---|---|---|---|---|---|
| Processo | `responsibleUser` | Contexto | `demand.responsibleParty` | projeção (removida na #258) | **não** | — | corrigido |
| Processo (abertura) | `requestingUnit` digitado | Contexto | `demand.requestingUnit` | fato `process/confirmed` | sim | explícita | OK |
| Pesquisa | quantidade da cotação | Item Inteligente | `quantity` (identidade) | cópia | como evidência | — | OK como evidência |
| Item Inteligente | `quantity` | TR/Edital/ETP (legado) | "Qtd." / total | cópia | **não** | nenhuma | **P0 (SEM-008)** |
| Item Inteligente | `averagePriceCents` | Contexto | `unitReferencePriceCents` | cópia se aprovado | parcial (sem método; ignora sourceState) | aprovação do item | P1 |
| Pesquisa/DFD | `sourceQuantity` | Item da Contratação | `plannedQuantity` | adoção "Usar N" | sim se explícita | 1 clique, sem confirmação | P1 |
| DFD salvo | campos afirmáveis | Contexto | `demand.*`, `planning.*`, `plannedQuantity` | fato `dfd/confirmed` com base consciente | sim | salvar | OK |
| Rascunho ETP | conteúdo | TR (prompt) | "ETP (estado: rascunho)" | excerto | parcial (rascunho, não oficial) | — | P1 (SEM-039) |
| TR (rascunho) | — | Edital | lineage `tr_aprovado` | literal fixo | **não** | — | P1 |
| Navegador | `object` | ETP/TR/Edital | objeto do documento | override | **não** (política: só process) | — | P1 |
| UI Edital | modalidade/forma/plataforma (default) | Edital | parâmetros | default de `useState` | **não** | — | **P0 (SEM-009)** |
| Organização (vigente) | identidade | versão emitida | cabeçalho | leitura ao exportar | **não** para emitidos | — | **P0 (SEM-013)** |
| Usuário (clique) | `ctx.user.id` | Ratificação | autoridade responsável | cópia | **não** | nenhuma | **P0 (SEM-004)** |
| Cliente | `reviewedBy` | Parecer legado | revisor | cópia | **não** | nenhuma | **P0 (SEM-016)** |
| IA | parecer/conclusão | Parecer legado | `opinion/conclusion` | gravação direta | **não** | nenhuma | **P0 (SEM-017)** |
| IA (copilotos) | justificativa | Contratação Direta | justificativa oficial + documento | upsert + documento oficial | **não** | nenhuma | **P0 (SEM-021)** |
| Contratação Direta | `value` (estimado) | Minuta/analytics | "valor do contrato" / "Valor Total Contratado" | cópia (e sem /100) | **não** | — | **P0/P1** |
| Catálogo legado | artigo (texto) | limite de valor | `art75_i_a` | `includes("75, I")` | **não** | — | **P0 (SEM-010)** |
| Aditivo (instrumento) | justificativa/novo valor | Termo Aditivo | corpo | ignorado; IA monta cláusula | **não** | — | **P0 (SEM-024)** |
| Contratação/Processo | adjudicação/ratificação | Contrato | valor/contratado/itens | nada propagado | — | — | P1 (SEM-062) |
| Colaboração | e-mail global | Processo | membro/responsável | lookup global | **não** | — | **P0 (SEM-001)** |
| Eventos de vencimento | 6 eventos/contrato | Centro de Operações | "Contratos vencendo" | contagem de eventos | **não** | — | P1 |

---

## 8. Mapa de lineage dos fatos principais (Entregável 6)

```
Processo ──(número, objeto: fonte process)──────────────► Contexto ──► DFD (prefill) ──► ETP/TR/Edital (título/prompt)
   │                                                         ▲            │                 ▲ (objeto do navegador pode sobrepor — SEM-029)
   └─ responsibleUser ✗ (não é mais fato — #258)             │            │
Abertura ──(requestingUnit digitado)──► fato process/confirmed            │
                                                              │            └─ save ──► fatos dfd/confirmed (unidade, responsável, PCA, prioridade, prazo, plannedQuantity)
Pesquisa ──► staging (revisão) ──► promoção ──► Itens Inteligentes (quantity = cotação, média)
                                                  │  aprovado ──► unitReferencePrice (média, sem método) ──► Contexto.priceContext
                                                  │                                                           │
                                                  └─ candidatos ──► Itens da Contratação (id estável) ──► plannedQuantity (user/dfd) ─┤
                                                                                                                              ▼
                                         DFD (tabela + orçamento derivado)   ETP/TR/Edital CANÔNICO: plannedQuantity × referência (fail-closed)
                                                                            ETP/TR/Edital LEGADO (sem Itens): quantity da COTAÇÃO × média  ✗ SEM-008
Rascunho ETP ─► TR (lê rascunho) ─► Edital (lê rascunho; lineage "tr_aprovado" fixo) ─► promoção oficial (corpo imutável; cabeçalho vivo ✗ SEM-013)
Edital/adjudicação ─ ✗ nada propagado ─► Contrato (valor/contratado manuais; sem itens) ─► Aditivos (termo ignora instrumento ✗ SEM-024)
Contratação Direta: pesquisa (valor do cliente) ─► justificativa de preço ─► ratificação (clicante = autoridade ✗) ─► publicação ─► contrato (valor estimado ✗)
Parecer: documento analisado (snapshot fictício) ─► rascunho ─► assinatura ─► (resultado não governa o solicitante ✗ SEM-063)
```

---

## 9. Blind actions (Entregável 7 / N)

| Módulo | Ação | Atual? | Proposto? | Origem? | Impacto? | Confirmação c/ valores? | Sobrescreve humano/aprovado? | Classe |
|---|---|---|---|---|---|---|---|---|
| DFD | "Usar informação de origem" / "Atualizar no rascunho" | S | S | S | campo | S | só c/ confirmação | **OK (#258)** |
| DFD | "Gerar rascunho da justificativa (IA)" | S | N | IA | N | só se `user_modified` | S (importado/pré-preenchido) | P1 |
| ETP/TR/Edital | "Gerar …" (regenerar) | S | N | P | N | **N** | **S** | **P0 SEM-014** |
| Edital | "Gerar edital" (params padrão) | N | N | — | N | N | **S** | **P0 SEM-009** |
| ETP/TR/Edital | "Emitir documento oficial" | P | S | — | S | hash; texto genérico | N | P1 SEM-057 |
| Import | "Substituir rascunho…" | N | S | P | P | motivo, sem valores | S (vai p/ histórico) | P1 |
| Pesquisa | "Importar e gerar Itens Inteligentes" | N | N | P | depois | N | S (itens) | P1 |
| Pesquisa | "Promover conteúdo revisado" | N | N | S | N | genérico | S | P1 SEM-053 |
| Itens Inteligentes | "Aplicar cotações atualizadas (N)" | N | contagem | tooltip | tooltip | **N** | **S (revoga aprovação, muda preço)** | P1 SEM-052 |
| Itens Inteligentes | "Aprovar" | S | — | — | N | N | eleva preço a canônico | P1 SEM-054 |
| Itens da Contratação | "Usar N" | P | S | S | N | **N** | **S (qtd humana)** | P1 SEM-055 |
| Itens da Contratação | "Usar quantidades do documento" (massa) | S | S | S | S | preview | N | OK (pré-marcado — P1) |
| Itens da Contratação | "Confirmar N item(ns)" (candidatos) | S | S | S | S | preview | N | OK |
| Contratação Direta | "Registrar ratificação" | **N** | S | — | N | **N** | **S** | **P0 SEM-004** |
| Contratação Direta | "Anexar"/"Validar" documento | S | — | — | — | N | **referência falsa** | **P0 SEM-020** |
| Contratação Direta | "Gerar com copilotos" | N | depois | "copilotos" | N | N | **S + oficial** | **P0 SEM-021** |
| Contratação Direta | "Salvar justificativa do preço" | **N** | S | — | N | N | **S + oficial** | **P0 SEM-022** |
| Contratação Direta | "Salvar caracterização" | N | S | — | — | N | sucesso falso | P1 |
| Contratação Direta | "Sugerir artigo" (IA) | N | auto | toast | N | N | troca tipo/artigo | P1 |
| Contratação Direta | "Gerar publicações" | — | N | — | avança etapa (oculto) | N | — | P1 |
| Parecer (canônico) | "Salvar nova versão" | **N** | S | — | N | N | **S (zera, força Favorável)** | **P0 SEM-019** |
| Parecer (canônico) | "Assinar parecer" | S | — | — | N | **N** | irreversível | P1 |
| Parecer (legado) | "Aprovar" | S | — | IA sem rótulo | N | N | aprova texto de IA | **P0 SEM-016** |
| Contratos | "Salvar contrato" | P | S | — | N | N | **S (vigente)** | **P0 SEM-023** |
| Contratos | "Gerar Aditivo…" → "Aceitar/Rejeitar" | — | — | copilotos | N | N | botões sem handler | P1 |
| Contratos | Criar a partir de processo/contratação/import | — | **N** | P | N | N | — | P1 |
| Gestão | "Importar (assistido)" | — | N | — | — | N ("você confirma") | — | P1 |
| Admin | Remover/desativar membro, flags | — | — | — | — | AlertDialog | — | OK |

---

## 10. Respostas às questões obrigatórias

1. **Outros casos equivalentes ao `responsibleUser`?** **Sim.** Ratificação: usuário que clicou vira "autoridade
   responsável" e permanece após mudança de decisão (SEM-004). Parecer legado: `reviewedBy` do cliente (SEM-016).
   Colaboração: pessoa de outro tenant como responsável pela etapa (SEM-001). Em ETP/TR/Edital o padrão **não**
   reincide (fatos `demand.*`/`responsibleUser` não entram nos prompts).
2. **Campos tecnicamente disponíveis tratados como equivalentes?** Sim: quantidade cotada → quantidade da
   contratação (SEM-008); média → preço de referência (SEM-027); valor estimado → valor contratado (SEM-032/012);
   objeto digitado → objeto do processo (SEM-029); importação aprovada → item elegível (SEM-030).
3. **Prefills com authority implícita?** No DFD: não (explícita pós-#258). Em ETP/TR/Edital: objeto do navegador;
   parâmetros do Edital pelo default da UI; valores do formulário da Contratação Direta/Parecer (formulários vazios
   funcionam como "prefill" de vazio).
4. **Fallbacks silenciosos?** Sim: modo legado sem Itens (quantidade da cotação); governança de Itens `.catch(() => null)`
   falha aberta (SEM-050); identidade viva como fallback de snapshot (SEM-013); `decision ?? "ratificado"`; null→0 em quantidade promovida.
5. **Quantidades com risco?** Sim — SEM-008 (P0), SEM-055/049 (P1), null→0 (P2). O modo canônico está correto.
6. **Preços com risco?** Sim — centavos como reais (SEM-012), média como referência sem método (SEM-027), preço de
   item `source_changed` (SEM-028), estimado como contratado (SEM-032), total parcial como global, limite de aditivo (SEM-011).
7. **Status de um módulo autorizando outro?** Sim — importação aprovada → candidatura (SEM-030); ponteiro de etapa
   → "ratificado/publicado" (SEM-064); geração de minuta → contrato `terminated` (SEM-065); instrumento → status do
   contrato (SEM-025); `updateStage` → "emitido" (SEM-015).
8. **Documentos como owner indevido?** Sim — lineage do Edital afirma `tr_aprovado` sem TR aprovado; documentos a
   jusante leem rascunhos; termos de aditivo ignoram o instrumento (owner real); parecer não fixa o documento analisado.
9. **Ações cegas na UI?** Sim — ver seção 9 (8 P0 + ~16 P1).
10. **Alterações silenciosas após reload/regenerate?** Sim — regenerar ETP/TR/Edital (SEM-014), Edital com
    parâmetros padrão (SEM-009), editor de parecer e justificativa de preço que não hidratam (SEM-019/022),
    campo de quantidade que não ressincroniza (SEM-056).
11. **Digests globais causando stale falso?** Sim — digest de ETP/TR inclui `pendingItemCount` e status/origem do
    DFD; Edital inclui parâmetros da UI (SEM-047). O digest do Contexto Canônico **não** dispara stale de documento
    (é só lineage) — verificado.
12. **Mudanças reais sem stale?** Sim — alterações fora do orçamento de excerto; preço canônico de item com fonte
    alterada (SEM-028); `sourceQuantity` congelado em vínculos (SEM-049).
13. **Saídas de IA entrando como fato canônico?** No Contexto Canônico: **não** (política bloqueia `ai_draft`; só
    dois escritores humanos). Fora dele: **sim** em legados/Contratação Direta — conclusão do parecer legado
    (SEM-017), justificativa por copilotos como documento oficial (SEM-021), CATMAT legado (SEM-034), texto de aditivo (SEM-024).
14. **Aprovações herdadas indevidamente?** Sim/latente — legado `documents` mantém "approved" após edição; parecer
    legado aprovado editável; `generated_documents` sem estado aprovado real (SEM-051); ratificação mantém autor original.
15. **Fontes cross-tenant possíveis?** Sim — SEM-001 (colaboração), `restoreVersion` sem `organizationId`,
    routers de export com `organizationId` do cliente (SEM-073), `contracts.number` único global, rotas por
    `ownerId` sem membership (hipótese TEN-3). O fluxo canônico está corretamente escopado.
16. **Operações não replay-safe?** Sim — upserts determinísticos (Classe B), idempotency service com lacunas em
    falha/expiração, gerações legadas sem chave, correção de extração só por chave, timeline com upsert.
17. **Remote calls dentro de transações?** **Não encontradas** nos fluxos auditados (IA, S3, OCR, e-mail fora de
    `db.transaction`). Verificado.
18. **Documento oficial vulnerável a contexto posterior?** Corpo: não. **Cabeçalho**: sim (SEM-013). Parecer legado
    aprovado: sim (SEM-016). Termos de contrato legados: sim (SEM-066).
19. **Export com contexto atual em vez do snapshot?** Sim — cabeçalho de versões emitidas (SEM-013), parecer legado,
    termos legados de contrato, pacotes com todas as versões (SEM-072).
20. **Informação sem provenance suficiente?** Sim — ver 5.2 (lineage de aditivos, justificativa de preço, snapshot
    do parecer, export sem hash, edição humana sem marcador, descrição/unidade achatadas).

---

## 11. Gaps de testes (Entregável 8 / W)

Testes que **protegem o comportamento errado** (precisam ser reescritos junto com a correção):
`sprint5z-direct-procurement.test.ts:177-179` (default "ratificado"); `auditCorrections.test.ts:63-97` (50%);
`c4b3a-draft-provenance-mysql-smoke.test.ts:117` (regeneração sobrescreve); `tr-canonical-quantity-mysql-smoke.test.ts:203`
e `canonical-document-quantity.test.ts:167` (legado com quantidade da cotação).

Guards permanentes recomendados:

| Guard | Cobre | Existe hoje? |
|---|---|---|
| semantic-authority (toda projeção só de fontes da política; operador nunca é pessoa institucional) | SEM-004/016/001, #258 | parcial (Contexto Canônico sim; fora dele não) |
| no-upsert-on-create (criar com chave natural existente ⇒ CONFLICT) | Classe B | não |
| blind-reconciliation UI guard (ação que substitui valor mostra atual × proposto × origem) | seção 9 | só DFD (#258) |
| form-hydration guard (formulário de edição abre com o valor persistido) | SEM-019/022/023/009 | não |
| planned-vs-source quantity guard (documento nunca usa quantidade de cotação) | SEM-008 | só modo canônico |
| money-unit guard (centavos formatados uma única vez) | SEM-012 | não |
| approved-document immutability guard (versão aprovada/emitida não muda nem no export) | SEM-013/016/051 | parcial (corpo) |
| document-version authority guard (jusante lê versão oficial ou declara rascunho) | SEM-039 | não |
| AI-never-decides guard (IA não grava conclusão/decisão/status/preço/quantidade/documento oficial) | SEM-017/021/024/034 | só Contexto Canônico |
| tenant-source resolution guard (lookups de usuário/processo/documento sempre com `organizationId`) | SEM-001/073 | smoke parcial |
| RBAC-parity guard (rotas duplicadas exigem o mesmo papel) | SEM-026/018 | não |
| state-machine guard (status só por transição permitida; ISSUED só via `issueProcess`) | SEM-015/025/064 | parcial |
| legal-content guard (catálogo/limites conferidos contra a Lei 14.133 — validado por jurista) | SEM-010/011 | não |
| idempotency-contract guard (falha/expiração/payload diferente) | 5.7 | não |

---

## 12. Plano de remediação por PR (Entregável 9 / X) — NÃO implementado

Ordem sugerida: segurança → sobrescrita silenciosa → fonte errada em documento → oficial/versão → IA → explicabilidade → testes/docs.
Todas pequenas e isoladas, cada uma com testes que falham antes e passam depois.

| PR | Escopo | Achados | Arquivos/classes | Migration | Risco | Dependência | Validação |
|---|---|---|---|---|---|---|---|
| **PR-A** | Tenant: colaboração e exports | SEM-001, SEM-073, `restoreVersion` sem org, TEN-3 (verificar) | `collaborationRouter`, `db/collaboration`, `exportRouter`, `structuredExportRouter`, `documentsRouter.restoreVersion` | não (auditoria/backfill de linhas cross-org e NULL) | baixo | — | smoke de segurança + testes de membership |
| **PR-B** | Criar ≠ resetar (Classe B) | SEM-002, 003, 005, 006, 007, aditivo `count+1`, timeline | `db/procurement`, `db/directProcurement`, `db/legalOpinionWorkspace`, `db/contractWorkspace`, `priceResearch`, `recordProcessEvent` | não (timeline: sequência — sim) | médio | — | smokes MySQL de conflito/replay |
| **PR-C** | Ratificação governada | SEM-004 | router/domínio/db da ratificação, `RatificationWorkspace` | **sim** (ledger de decisão, `decidedBy/recordedBy`) | médio | PR-B | testes de autoridade/SoD; reescrever teste que protege default |
| **PR-D** | Parecer: IA nunca conclui; editor hidrata; legado congelado | SEM-006(part), 016, 017, 019 | `legalOpinionsRouter`, `legalOpinionService` (Zod), `LegalOpinionEditor`, `legalOpinionWorkspaceRouter` | provável (versão/rascunho) | médio | PR-B | testes de assinatura/imutabilidade |
| **PR-E** | Regerar sem perder edição humana | SEM-014, 009 | `procurementProcessService.generateDocument/Notice`, workspaces ETP/TR/Edital, `DraftEditor`, `reviewableDraft` | não | médio | — | teste: regerar sobre `human_edit` sem `confirmReplace` ⇒ recusa |
| **PR-F** | Quantidade da cotação nunca vira necessidade | SEM-008 | `authoringContext`, `editalContext`, `assertCanonicalQuantitiesComplete` | não | médio (processos legados passam a exigir Itens) | — | reescrever testes legados; smoke TR/Edital |
| **PR-G** | Snapshot institucional na emissão | SEM-013, SEM-043 | `documentPromotionService`, `officialDocumentExportAdapter` | não (backfill documentado) | baixo | — | smoke c4b1 assertando snapshot |
| **PR-H** | Contratação Direta: evidência e IA supervisionada | SEM-020, 021, 022, 042, 059 | `RequiredDocumentsWorkspace` (upload real), `directProcurementService`, workspaces | não | médio | PR-B | testes de anexo/aceite humano |
| **PR-I** | Contratos: instrumentos e transições | SEM-023, 024, 025, 065, 066, 062 (parcial) | `contractService`, `ContractEditor`, `contractWorkspaceRouter` | não (itens de contrato: sim, PR separada) | médio | PR-B | testes de estado terminal/CAS |
| **PR-J** | Legal: catálogo e limites *(com jurista)* | SEM-010, 011 | `seedDirectContractLegalArticles`, `directContractsRouter:275`, `contractValidation` | migração de **dados** | alto (jurídico) | validação jurídica | testes de conteúdo legal |
| **PR-K** | RBAC e rotas legadas | SEM-026, 018, 015, 034, 035, 036 | `itemIntelligenceRouter`, `documentsRouter`, `processesRouter`, `procurementProcessRouter.updateStage` | não | baixo | — | testes RBAC-parity; freeze de rotas |
| **PR-L** | Dinheiro e indicadores | SEM-012, 070, 071, 074 | formatador único, `directContractAuditReport`, `MetricsGrid`, `processReportService`, `departmentOperationService` | não | baixo | — | testes de formatação/contagem |
| **PR-M** | Preço de referência explícito | SEM-027, 028, 031, 052, 054 | Contexto Canônico, Itens Inteligentes, workspaces | **sim** (método/exclusão de cotação) | médio | — | testes semânticos de preço |
| **PR-N** | Explicabilidade restante | SEM-053, 055, 056, 057, 058, 060, 061 | componentes de UI | não | baixo | PR-E | testes de UI (padrão #258) |
| **PR-O** | Proveniência/stale | SEM-039, 040, 041, 044, 045, 047, 049, 050, 051 | authoring, lineage, governança de itens | parcial (lineage de aditivos) | médio | PR-G | testes de lineage/stale |
| **PR-P** | Idempotency service | 5.7 (idempotência) | `idempotencyService` | não | médio (transversal) | — | testes de falha/expiração/payload |
| **PR-Q** | Documentação | docs × código | `docs/architecture/*` | não | nenhum | após PRs | revisão |

---

## 13. Invariantes arquiteturais permanentes (Entregável 10 / Y)

1. Nenhuma fonte afirma fato fora da `AUTHORITY_POLICY` — e **toda** escrita no ledger passa por `recordContextAssertions`.
2. Quem executa a ação (operador/criador/clicante) nunca é, por padrão, a pessoa institucional (responsável, autoridade, revisor, fiscal, gestor); o papel institucional é informado e validado explicitamente.
3. Criar com chave natural existente é CONFLICT — nunca reset. `onDuplicateKeyUpdate` só em idempotência comprovada (mesmo payload).
4. Nenhuma reconciliação/substituição sem `sourceValue` válido; nenhuma ação de substituição esconde valor atual, valor proposto e origem.
5. Todo formulário de edição abre com o valor persistido; vazio enviado não apaga conteúdo existente sem confirmação.
6. `sourceQuantity`/quantidade cotada nunca afirma `plannedQuantity` nem aparece como quantidade da contratação.
7. Preço de referência é decisão com método e proveniência; média é evidência derivada.
8. IA nunca afirma fato canônico, conclusão jurídica, decisão administrativa, status, preço, quantidade ou documento oficial sem aceite humano explícito.
9. Documento aprovado/emitido nunca muda — nem corpo, nem cabeçalho, nem export; aprovação vale para um hash/versão e é invalidada por nova versão.
10. Contexto atual não substitui snapshot oficial; export de versão emitida usa só o snapshot.
11. Fingerprint é matching, nunca identidade persistente (hoje respeitado nos Itens da Contratação — manter).
12. Status de um domínio não implica status de outro sem transição institucional explícita (máquina de estados no domínio).
13. Todo lookup sensível é tenant-scoped (`organizationId` do contexto, nunca do input); usuário-alvo precisa ter membership no tenant.
14. Nenhuma chamada remota (IA, HTTP, S3, e-mail) dentro de transação de banco (hoje respeitado — manter).
15. Mudança institucional relevante gera evento com ator, tenant, alvo, antes/depois (hash), fonte, correlationId e motivo — sem conteúdo integral sensível.
16. Valor monetário persistido em centavos é formatado por um único formatador; rótulo diz se é estimado, referência, adjudicado ou contratado.
17. Regra institucional crítica existe no domínio/servidor — nunca só na UI (esconder botão não é controle).

---

## 14. Confirmações (Z)

- Nenhum código funcional alterado.
- Nenhuma migration criada.
- Nenhuma feature flag alterada.
- Nenhuma mutação de produção (nenhum SQL, nenhum clique, nenhuma chamada a produção).
- Nenhum merge, nenhum deploy.
- Graphify não regenerado; documentação existente não alterada.
- Único artefato: este arquivo, **não commitado**.

---

## Apêndice A — Índice consolidado dos achados

**P0 (26):** SEM-001 colaboração cross-tenant · SEM-002 createProcess upsert · SEM-003 contratação direta upsert ·
SEM-004 ratificação · SEM-005 colagem sobrescreve cotações · SEM-006 createDraft reseta parecer · SEM-007 contrato
upsert · SEM-008 quantidade cotada em TR/Edital legado · SEM-009 Edital params padrão · SEM-010 catálogo legal ·
SEM-011 limite de aditivo · SEM-012 centavos como reais · SEM-013 cabeçalho vivo em emitidos · SEM-014 regerar
sobrescreve edição · SEM-015 updateStage→emitido · SEM-016 parecer legado aprovação · SEM-017 IA conclui parecer
legado · SEM-018 approveDocument legado · SEM-019 editor do parecer zera · SEM-020 anexo fictício · SEM-021
justificativa por copilotos oficial · SEM-022 justificativa de preço sobrescreve · SEM-023 editor de contrato ·
SEM-024 termo aditivo ignora instrumento · SEM-025 aditivo ressuscita contrato · SEM-026 RBAC approve Item Inteligente.

**P1 (54):** SEM-027…SEM-036, SEM-039…SEM-043, SEM-047…SEM-060, SEM-062…SEM-074, e em 5.7:
SEM-075 idempotency service · SEM-076 timeline upsert/ator · SEM-077 approval workflow em memória · SEM-078
`documents` legado aprovado mutável · SEM-079 `restoreVersion` sem organizationId · SEM-080 IA escreve estimativa na
prosa · SEM-081 total parcial como global · SEM-082 justificativa presencial boilerplate · SEM-083 SoD/HMAC do parecer
canônico · SEM-084 aditivos canônicos sem limite/concorrência · SEM-085 `contracts.number` único global ·
SEM-086 rotas por `ownerId` sem membership (hipótese).

**P2 (12):** SEM-037, 038, 044, 045, 046, 061, e em 5.7: SEM-087 SoD da emissão só último editor · SEM-088
`tenantIsolationAuditService` não varre o banco · SEM-089 colisão `dfdj:` · SEM-090 null→0 na promoção ·
SEM-091 credenciamento inexistente / `legalArticle` inexistente no prompt · SEM-092 `WorkspaceDecisionPanel` com dados fictícios.

> **Contagem definitiva: 92 achados — P0 26 · P1 54 · P2 12.**
