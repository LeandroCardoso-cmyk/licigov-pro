# R9 — Plano de remediação dos P1 (54/54)

> Estado: **PLAN_PREPARED_AWAITING_HUMAN_APPROVAL** · gerado programaticamente a partir do baseline
> `docs/audits/SEMANTIC_AUTHORITY_CROSS_MODULE_AUDIT.md` (sha256 `08edc7344c9038889978e1b2f9204f4fd523e3fef36e6b29b47ff324ae0810b3`, **não modificado**) por `gen_r9_r10.py` (scratchpad da sessão).
> Contagem verificada no gerador: 54 P1 (+ 12 P2 em R10 + 26 P0 nas fases R1–R8 = 92). Nenhum P1 foi omitido ou
> duplicado. "Estado local" descreve o que ESTA branch já fez (não mergeado, não implantado); `PLAN` = nada feito.

## Grupos

| Grupo | Tema | P1 |
|---|---|---:|
| A | Autoridade / fonte do preço e do objeto | 10 |
| B | Proveniência / lineage | 5 |
| C | Stale / reconciliação / governança de itens | 5 |
| D | Ações cegas / explicabilidade (UI) | 9 |
| E | Ownership entre módulos | 8 |
| F | Relatórios / operações / exports | 5 |
| G | Workflow / replay / auditoria | 7 |
| H | IA, valores e contratos | 5 |
| **Total** | | **54** |

## Grupo A — Autoridade / fonte do preço e do objeto

| SEM | Achado (baseline) | Evidência (baseline) | Ação proposta | Migration | Dependência | Estado local |
|---|---|---|---|---|---|---|
| SEM-027 | Média aritmética de cotações apresentada como "valor de referência", sem método/decisão humana (média/mediana/menor) nem exclusão de outliers | canonicalProcurementContext.ts:262-266,355-357, authoritativeItems.ts:119-127, consolidateQuotes/avgOf | Método de referência explícito (média/mediana/menor) escolhido por pessoa, outliers sinalizados e decisão registrada | Sim (decisão de método) | BLOCKED_HUMAN_DECISION (método institucional) | PLAN |
| SEM-028 | Preço canônico ignora `sourceState` do Item Inteligente (`source_changed`/`review_required`) | sourceState, source_changed, review_required | Preço canônico só de Item Inteligente `current`; `source_changed`/`review_required` ⇒ sem preço + [REVISAR] | Não | — | PLAN |
| SEM-029 | Objeto digitado no navegador sobrepõe `process.object` em ETP/TR/Edital (política diz só `process`) | process.object, process, authoringContext.ts:154 | `object` sempre de `process.object`; input do cliente vira só proposta (diff explícito) | Não | — | PLAN |
| SEM-030 | Aprovação da **sessão de importação** (extração correta) autoriza candidatura do item à contratação independente do status do Item Inteligente | procurementItems.ts:234-237 | Candidatura a item da contratação exige Item Inteligente aprovado; painel mostra status/preço | Não | — | PLAN |
| SEM-031 | Vínculo de preço aceito para qualquer item ativo sem compatibilidade de unidade; troca de unidade após vínculo não revalida (preço por CX × quantidade em UN) | planCandidateDecisions:403-407, updateProcurementItem:541-567, resolveCanonicalContext:372 | Vínculo de preço exige unidade compatível (canonicalUnits); troca de unidade invalida vínculo | Não | — | PLAN |
| SEM-032 | Valor **estimado** usado como valor do contrato na minuta; cotação selecionada (`isSelected`) nunca lida; "PARECER… Recomenda-se a contratação" fabricado no Mapa Comparativo | isSelected, directContractDocuments.ts:356,547-548, schema.ts:1063,1153 | Campo `contractedValue` distinto do estimado; minuta lê a cotação selecionada; remover "PARECER… Recomenda-se" fabricado | Sim | R2.3 (uso real do legado) | PLAN (PR-14 já rotula "valor estimado" nas saídas legadas) |
| SEM-033 | Valor/status alteráveis após validação (inclusive autoaprovação) em `directContracts.update` sem revalidar limite | directContracts.update, directContractsRouter.ts:346-399 | `directContracts.update` revalida limite e congela valor/status após validação | Não | BLOCKED_LEGAL_REVIEW (limites — J-2) | PLAN |
| SEM-034 | CATMAT legado aprova código de IA sobre o item (e pode aplicar sugestão de outro item), trocando a descrição humana | processesRouter.ts:262-296 | CATMAT legado do `processesRouter` não aplica código de IA nem troca descrição humana | Não | — | MITIGATED_LOCAL (processesRouter com guards LEG; verificar cobertura dos endpoints CATMAT) |
| SEM-035 | Endpoints legados de CATMAT (`acceptCATMAT` confia no código do cliente; `manualCATMAT` fora do ledger) | acceptCATMAT, manualCATMAT, itemIntelligenceRouter.ts:74-112 | `acceptCATMAT` só a partir de sugestão registrada; `manualCATMAT` pelo ledger `catmat_decisions` | Não | — | PLAN |
| SEM-036 | Legado `documents.generateNext`/`generateDocument` gera ETP/TR/Edital com `estimatedValue \|\| 0`, sem tabela autoritativa, idempotência ou digest; move `em_parecer → concluido` se… | documents.generateNext, generateDocument, estimatedValue \|\| 0 | Geração legada de ETP/TR/Edital desligada; caminho canônico é o único | Não | — | ADDRESSED_LOCAL (LEG-009: documents.generateNext/generateDocument desligados) |

## Grupo B — Proveniência / lineage

| SEM | Achado (baseline) | Evidência (baseline) | Ação proposta | Migration | Dependência | Estado local |
|---|---|---|---|---|---|---|
| SEM-039 | Documentos a jusante leem **rascunhos** a montante; lineage do Edital grava `"tr_aprovado"` fixo | "tr_aprovado", authoringContext.ts:384-385, editalContext.ts:322-324 | Documento a jusante consome a versão EMITIDA/aprovada do montante (ou marca rascunho); lineage real em vez de "tr_aprovado" | Não | — | PLAN |
| SEM-040 | Aditivos/apostilamentos compartilham uma lineage por contrato (Aditivo nº2 = "v2" do nº1); sem `addendumId` no oficial | addendumId, contractService.ts:197-202, officialDocument.ts:74 | Lineage por instrumento (aditivo/apostilamento) com `instrumentId` no oficial; backfill das versões existentes | Sim (backfill) | BLOCKED_HUMAN_DECISION (backfill) | PARTIAL_LOCAL (PR-17 grava instrumentId no metadata; lineage ainda por contrato) |
| SEM-041 | "Fixação" do documento analisado pelo parecer é fictícia (versão default 1; snapshot = hash sem conteúdo) | documentReference.ts:37-43, foundation/conclusionType | Fixação real do documento analisado (versão + hash de conteúdo) no pedido de parecer | Não | — | PLAN |
| SEM-042 | Justificativa de preço sem linhagem (valor do cliente, "Baseado na Pesquisa… confiança 0,85" fixo); `characterizeNeed`/`importDFD` retornados mas não persistidos (tela mostra suces… | characterizeNeed, importDFD, directProcurementService.ts:173-175 | Justificativa de preço com linhagem (pesquisa/versão); persistir characterizeNeed/importDFD ou retirar o sucesso falso | Não | — | PARTIAL_LOCAL (PR-11: registro só com aceite humano e autor humano) |
| SEM-043 | Export oficial não registra `replayHash`/`contentHash`/SHA do artefato; DOCX e PDF da mesma versão sobrescrevem `storageKey/hash` | replayHash, contentHash, storageKey/hash | Export oficial registra hash do artefato por formato (DOCX ≠ PDF), sem sobrescrever | Talvez (artefatos por formato) | — | PLAN |

## Grupo C — Stale / reconciliação / governança de itens

| SEM | Achado (baseline) | Evidência (baseline) | Ação proposta | Migration | Dependência | Estado local |
|---|---|---|---|---|---|---|
| SEM-047 | Digest global único de ETP/TR/Edital: falso positivo (`pendingItemCount`, status/origin do DFD, parâmetros da UI) e falso negativo (mudança fora do orçamento de excerto 6000/4000 c… | pendingItemCount, authoringContext.ts:136-137,181, AuthoringSourcesSummary.tsx:67-72 | Digest por fonte com motivo listado na UI; excerto fora do orçamento entra por hash | Não | — | PLAN |
| SEM-048 | Correção de extração aceita após aprovação/promoção sem re-revisão (contorna operador revisa/gestor promove); update+histórico fora de transação; idempotência só por chave | importStagingService.ts:240-342, ingestionRouter.ts:678-728 | Correção pós-aprovação reabre revisão; update+histórico na mesma transação; idempotência por chave+payload | Não | — | PLAN |
| SEM-049 | `item_source_links.sourceQuantity` congelado no vínculo; "Usar N" pode adotar valor antigo do DFD | item_source_links.sourceQuantity, procurementItemsService.ts:511-515 | "Usar N" lê a quantidade VIGENTE da fonte (não a congelada no vínculo) e mostra a divergência | Não | — | PLAN |
| SEM-050 | Governança de Itens falha **aberta** (`.catch(() => null)`) → mudança em item consumido por documento aprovado classificada como "define" | .catch(() => null), procurementItemsService.ts:60,64,149-151 | Governança de itens fail-closed (erro de leitura ⇒ recusa, nunca "define") | Não | — | IMPLEMENTED_PENDING_REVIEW (c56b0ae: escritas fail-closed; leitura do workspace degrada) |
| SEM-051 | Estado "aprovado" de `generated_documents` nunca é escrito: `assertDFDMutable` e `itemsConsumedByApproved` são inalcançáveis; DFD não tem emissão | generated_documents, assertDFDMutable, itemsConsumedByApproved | Estado "aprovado" escrito pelo fluxo de revisão (ou remover guardas mortas) + emissão do DFD | Não | BLOCKED_HUMAN_DECISION (DFD tem emissão?) | PLAN |

## Grupo D — Ações cegas / explicabilidade (UI)

| SEM | Achado (baseline) | Evidência (baseline) | Ação proposta | Migration | Dependência | Estado local |
|---|---|---|---|---|---|---|
| SEM-052 | "Aplicar cotações atualizadas (N)" troca cotações/média e revoga a aprovação em 1 clique; antigo × novo só em tooltip | ItemIntelligenceWorkspace.tsx:175-184, itemMaterializationService.ts:344-349 | "Aplicar cotações atualizadas" com diff antigo × novo e confirmação explícita | Não | — | PLAN |
| SEM-053 | "Promover conteúdo revisado" não diz que Itens Inteligentes existentes serão mesclados/recalculados/marcados | PromoteToDomainPanel.tsx:96-100 | Promoção mostra o efeito sobre Itens Inteligentes (mesclar/recalcular/marcar) antes de confirmar | Não | — | PLAN |
| SEM-054 | "Aprovar" Item Inteligente habilitado com "Fonte alterada"/"Identidade a revisar"; sem mostrar outliers/impacto no preço canônico | ItemIntelligenceWorkspace.tsx:186-201, ProcurementItemPanel.tsx:508-516 | "Aprovar" desabilitado com fonte alterada/identidade a revisar; mostra outliers e impacto | Não | — | PLAN |
| SEM-055 | "Usar N" substitui quantidade humana sem confirmação; rótulo "Quantidade no documento" para quantidade **cotada**; painel em massa pré-marcado e escolhe a 1ª fonte (pode ser cotaçã… | ProcurementItemsWorkspace.tsx:251-254, procurementItemsView.ts:67-70, adoptableQuantities:93-100 | "Usar N" com confirmação e rótulo "quantidade cotada"; nada pré-marcado no painel em massa | Não | — | PLAN (PR-13 já impede que a quantidade cotada chegue a TR/Edital) |
| SEM-056 | Campo "Quantidade prevista" não ressincroniza após write (`useState` fixo) → "Salvar" reverte o valor | useState, ProcurementItemsWorkspace.tsx:175,231-237 | Campo "Quantidade prevista" hidratado por `useHydratedForm` (R5.1) após cada write | Não | — | PLAN (guard R5.1 disponível) |
| SEM-057 | "Emitir documento oficial" sem pré-condições semânticas (source_changed, `[REVISAR]`, ordem TR→Edital) e com edição não salva no editor acima; sem diff contra a última emitida | [REVISAR], documentPromotionService.ts:80-137, OfficialPromotionSection.tsx:199-227 | Emissão com pré-condições semânticas (source_changed, [REVISAR], ordem TR→Edital) e diff contra a última emitida | Não | — | PLAN |
| SEM-058 | Justificativa do DFD por IA substitui texto importado/pré-preenchido sem aviso (confirmação só em `user_modified`) | user_modified, DFDWorkspace.tsx:270-278 | Justificativa do DFD por IA como sugestão comparada ao texto atual; substituir só com aceite | Não | — | PLAN |
| SEM-059 | "Sugerir artigo" (IA) troca dispensa↔inexigibilidade e limpa o artigo escolhido sem aceite | NewDirectContract.tsx:80-102 | "Sugerir artigo" não troca tipo nem limpa o artigo sem aceite | Não | BLOCKED_LEGAL_REVIEW (catálogo — J-2) | PLAN |
| SEM-060 | Rótulos que não correspondem ao efeito: "Gerar publicações" também avança etapa; "Importar DFD" legado só registra evento; LegacyImportWizard diz "você confirma" e grava direto; Co… |  | Rótulos = efeito ("Gerar publicações" não avança etapa; CopilotPanel com handlers reais ou sem botões; "Assinar parecer" com confirmação) | Não | — | PLAN |

## Grupo E — Ownership entre módulos

| SEM | Achado (baseline) | Evidência (baseline) | Ação proposta | Migration | Dependência | Estado local |
|---|---|---|---|---|---|---|
| SEM-062 | Contratos não herdam nada de adjudicação/ratificação (valor 0, contratado ""), sem itens (planejado × contratado impossível de rastrear); apostilamento de gestor/fiscal não atualiz… | contractService.ts:83-87, NewContractWizard.tsx:82-84 | Contrato herda valor/contratado da adjudicação/ratificação; itens do contrato; apostila de gestor/fiscal atualiza o contrato por instrumento | Sim (itens do contrato) | — | PARTIAL_LOCAL (PR-12: mudança de termos só por instrumento com CAS — verificar gestor/fiscal) |
| SEM-063 | Parecer devolvido não governa o domínio solicitante (ratificação/publicação não leem; aditivo `aguardando_parecer` nunca avança) | aguardando_parecer, legalOpinionWorkspaceService.ts:432-437, contractService | Parecer devolvido governa o domínio (ratificação/publicação leem; aditivo `aguardando_parecer` avança) | Não | BLOCKED_LEGAL_REVIEW (efeito do parecer desfavorável) | PLAN |
| SEM-064 | Status da Contratação Direta derivado do ponteiro de etapa (ratificado/publicado sem ato registrado); `configureFlags(requiresLegalOpinion:false)` sem evento; `publish` gera extrat… | configureFlags(requiresLegalOpinion:false), publish, directProcurementWorkspace.ts:156-177 | Status da Contratação Direta derivado dos atos registrados (ledger), não do ponteiro de etapa; configureFlags com evento; publish sem extrato inexistente | Não | — | PARTIAL_LOCAL (PR-07: publicação exige decisão do ledger) |
| SEM-065 | Geração de minuta de rescisão já marca contrato `terminated` (legado) | terminated, contractsRouter.ts:723-725 | Minuta de rescisão não marca `terminated`; rescisão é ato próprio | Não | — | PLAN (legado `contractsRouter` sem guard LEG — R2.3) |
| SEM-066 | Termos legados usam dados atuais (apostila "de X para X"); contratos ativos editáveis; audit só com nomes de campo | contractsRouter.ts:129-168,328-331, contractDocuments.ts:451 | Termos legados a partir do instrumento; contrato ativo só muda por instrumento; audit com valores | Não | R2.3 | PLAN |
| SEM-067 | Lote arquivado mantém código reservado e gera membership pendente | db/procurementItems.ts:111-121, planCandidateDecisions:430-433 | Arquivar lote libera o código (índice parcial) e não gera membership pendente | Sim (índice) | — | PLAN |
| SEM-068 | Linhas idênticas do DFD colapsam (`sourceItemKey` sem nº da linha) → `DUPLICATE_DECISION` bloqueia confirmação | sourceItemKey, DUPLICATE_DECISION, procurementItems.ts:295,395 | `sourceItemKey` inclui o nº da linha do DFD | Não | — | PLAN |
| SEM-069 | Re-adicionar item retirado não faz nada e reporta sucesso | procurementItemsService.ts:391-397 | Re-adicionar item retirado reativa (ou recusa com mensagem), nunca sucesso falso | Não | — | PLAN |

## Grupo F — Relatórios / operações / exports

| SEM | Achado (baseline) | Evidência (baseline) | Ação proposta | Migration | Dependência | Estado local |
|---|---|---|---|---|---|---|
| SEM-070 | Centro de Operações: "Contratos vencendo" conta eventos (6 por contrato, sem janela); "Tarefas pendentes" sempre 0; "Atrasado" nunca aparece; "Concluídos" inclui arquivados/entrada… | limit, departmentOperationService.ts:49-184, db/departmentOperation.ts:66-69 | Centro de Operações: contagens por janela, por contrato, sem truncamento em memória; "Atrasado" real | Não | — | PLAN |
| SEM-071 | Gestão: três definições de "Atrasada" (KPI calculado × status manual × Excel); cores de prazo divergentes da regra documentada; botões Excel/PDF chamam procedures inexistentes via … | as any, TaskDashboard.tsx:16, taskReports.ts:123,204 | Uma definição de "Atrasada"; cores conforme regra; botões Excel/PDF para procedures reais; responsável validado no tenant | Não | — | PLAN |
| SEM-072 | Pacotes (publicação legado, contratação direta) empacotam todas as versões/status com nomes colidentes e Markdown como `.pdf` | .pdf, zipService.ts:59, directContractPackage.ts:45-50 | Pacotes só com versões oficiais, nomes únicos e formato real | Não | — | PLAN |
| SEM-073 | Routers de export aceitam `organizationId` do cliente (`protectedProcedure`): `exports.generate/getHistory/getPreview`, `structuredExport.*`, `itemAnalytics.getDashboard`, `reviewW… | organizationId, protectedProcedure, exports.generate/getHistory/getPreview | Exports com `organizationId` do contexto (tenantProcedure) | Não | — | MITIGATED_LOCAL (LEG-028: routers experimentais fail-closed) |
| SEM-074 | Analytics/Auditoria leem tabelas legadas sem escrita (`processes`, `documents`) | processes, documents, db/admin.ts:124-153 | Analytics/Auditoria lêem as tabelas canônicas | Não | — | PLAN |

## Grupo G — Workflow / replay / auditoria

| SEM | Achado (baseline) | Evidência (baseline) | Ação proposta | Migration | Dependência | Estado local |
|---|---|---|---|---|---|---|
| SEM-075 | `idempotencyService`: linha "failed" não é re-reservada (retries concorrentes rodam — IA duplicada); payload hash não atualizado após falha (payload diferente cacheado sob hash ori… | idempotencyService, operation, idempotencyService.ts:47-70,151-160 | Idempotência: re-reserva de "failed" com lock, hash atualizado, reativação de expirada, `operation` na unicidade | Talvez (índice) | — | PLAN |
| SEM-076 | Timeline de eventos com id `sha256(org:process:count:eventType)` + upsert do `summary`: eventos concorrentes do mesmo tipo se sobrescrevem; `actor: "multi_copilot"` em vez do human… | sha256(org:process:count:eventType), summary, actor: "multi_copilot" | Timeline com id único por evento (sem upsert de summary); ator humano solicitante | Não | — | PLAN |
| SEM-077 | Workflow de aprovação em memória (aprovador do input, sem tenant na escrita, mesmo aprovador contado N vezes); agentes marcam etapas "completed" com saída simulada | approvalWorkflowRouter.ts:23-33, humanApprovalService.ts:80-89, agentExecutionEngine.ts:79-83 | Workflow de aprovação persistido e tenant-scoped (ou desligado) | Não | — | MITIGATED_LOCAL (LEG-028: approvalWorkflow experimental fail-closed) |
| SEM-078 | Conteúdo legado de `documents` muda in-place mantendo "approved" (`updateDocumento`, `publishDraft`, `restoreToVersion`) — latente, sem caller de router encontrado. | documents, updateDocumento, publishDraft | Conteúdo de `documents` aprovado imutável (nova versão) | Não | — | MITIGATED_LOCAL (LEG-009: mutações de documents desligadas) |
| SEM-079 | `documents.restoreVersion` insere linha **sem `organizationId`** e pode copiar conteúdo entre processos do mesmo órgão (UI usa `VersionHistoryDialog`) | documents.restoreVersion, organizationId, VersionHistoryDialog | `restoreVersion` com organizationId e mesmo processo; backfill + NOT NULL | Sim (backfill + NOT NULL) | BLOCKED_HUMAN_DECISION (backfill) | MITIGATED_LOCAL (LEG-009: restoreVersion desligado) |
| SEM-083 | SoD do parecer canônico: quem "recebe" vira advogado responsável; assinante não precisa ser o designado; chave HMAC = `JWT_SECRET` lida de `process.env` (viola regra de config; rot… | JWT_SECRET, process.env, digitalSignatureService.ts:21 | SoD do parecer: designado ≠ quem recebe; assinante = designado; chave HMAC própria via server/config | Não | BLOCKED_HUMAN_DECISION (rotação de chave) | PARTIAL_LOCAL (NEW-007: autoridade por atribuição) |
| SEM-086 *(HIPÓTESE)* | Rotas autorizadas por `ownerId` (`downloadRouter`, `platformsRouter`) sem checar membership vigente no tenant — usuário removido do órgão pode continuar exportando pacotes; não con… | ownerId, downloadRouter, platformsRouter | Rotas por `ownerId` checam membership vigente no tenant (HIPÓTESE — confirmar) | Não | — | PLAN (hipótese a confirmar) |

## Grupo H — IA, valores e contratos

| SEM | Achado (baseline) | Evidência (baseline) | Ação proposta | Migration | Dependência | Estado local |
|---|---|---|---|---|---|---|
| SEM-080 | IA nos textos de ETP/TR: seção obrigatória "estimativa do valor" escrita pela IA; números na prosa nunca verificados; ETP sem bloco autoritativo | authoringSchema.ts:64,88, structuredAuthoringService.ts:249-251 | ETP/TR: estimativa só do bloco autoritativo; números na prosa verificados ou proibidos; ETP com bloco autoritativo | Não | — | PLAN |
| SEM-081 | "Valor estimado global" parcial apresentado como global (itens sem preço omitidos) | authoringContext.ts:235-238, editalContext.ts:221, AuthoringSourcesSummary.tsx:57-63 | Total parcial rotulado "parcial (N itens sem preço)" | Não | — | PLAN (PR-13 rotula o total legado como indicativo) |
| SEM-082 | Justificativa de "presencial" é boilerplate aceito pela validação e nunca renderizado no Edital | generatedDocument.ts:170-182 | Justificativa de "presencial" exigida de verdade e renderizada no Edital | Não | BLOCKED_LEGAL_REVIEW (conteúdo mínimo) | PLAN |
| SEM-084 | Aditivos canônicos sem limite de valor/prazo e com sequência `count+1` → criação concorrente sobrescreve | count+1, contractService createAddendum | Sequência de aditivo atômica (UNIQUE + retry) e limites do art. 125 conforme parecer | Sim (UNIQUE sequência) | BLOCKED_LEGAL_REVIEW (J-4) | PARTIAL_LOCAL (R8: limites marcados como não verificados) |
| SEM-085 | `contracts.number` único **global** (entre tenants) | contracts.number, schema.ts:1227 | `contracts.number` único por órgão (legado) | Sim | R2.3 | PLAN (FCC-06: a 0310 cobre `contract_workspaces`, não `contracts`) |

## Ordem sugerida (após aprovação humana)

1. **G (replay/auditoria)** e **C (fail-closed de governança)** — base para os demais; SEM-075, SEM-076, SEM-050 primeiro.
2. **A (autoridade do preço/objeto)** — SEM-028, SEM-029, SEM-031 sem dependência humana; SEM-027 após decisão de método.
3. **B (lineage)** e **H (IA/valores)** — SEM-039, SEM-043, SEM-080, SEM-081.
4. **D (UI)** usando o guard R5.1 (`useHydratedForm`) e o padrão "sugestão ≠ decisão" da PR-11.
5. **E/F** — dependem de R2.3 (uso real do legado) para decidir corrigir × retirar.

## Não fazer sem decisão

Itens com `BLOCKED_HUMAN_DECISION` / `BLOCKED_LEGAL_REVIEW` acima: SEM-027, 033, 040, 051, 059, 063, 079, 082, 083, 084 — ver
`HUMAN_DECISION_PACKET.md` e `LEGAL_REVIEW_DECISION_PACKET.md`.
