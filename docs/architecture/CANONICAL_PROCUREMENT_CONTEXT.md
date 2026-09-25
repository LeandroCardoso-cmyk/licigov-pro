# Contexto Canônico da Contratação (`canonical-context/1`)

> Fundação reutilizável de **fatos + decisões + estado institucional + proveniência** de um processo,
> consumida pelos documentos (DFD → ETP → Pesquisa/Itens → TR → Edital). **Não é um documento**, não é
> um wizard e não substitui nenhuma página: os documentos continuam existindo e passam a **consumir** o
> contexto (prefill determinístico + rascunho supervisionado). 1º consumidor: **DFD**
> (ver [`DFD_CANONICAL_PREFILL.md`](DFD_CANONICAL_PREFILL.md)).

Coerente com a [Constituição do Produto](PRODUCT_NORTH_STAR.md): IA supervisionada, humano decide,
rastreabilidade obrigatória, sistema satélite (não-ERP).

## 1. Problema

O servidor informava a mesma coisa várias vezes (unidade, responsável, itens, quantidades, planejamento)
em DFD, ETP, TR e Edital. Cada documento reconstruía seu contexto por conta própria (`authoringContext`,
`editalContext`), sem proveniência por campo, sem detecção de conflito e sem versão consumida.

## 2. Onde está

| Camada | Arquivo | Papel |
|---|---|---|
| Domínio (puro) | `server/domain/canonicalProcurementContext.ts` | tipos, **política de autoridade**, resolução, conflito, identidade de item, evidência de preço, versão/digest |
| Persistência | `server/db/procurementContext.ts` + tabela `procurement_context_facts` (migration **0305**) | ledger **append-only** de afirmações, tenant-scoped, idempotente |
| Serviço | `server/services/canonicalContextService.ts` | `resolveProcurementContext` (leitura) e `recordContextAssertions` (escrita com política) |
| API | `procurementProcess.canonicalContext` (tenantProcedure, read-only) | contexto resolvido para o processo do tenant |

## 3. Modelo

### 3.1 Fontes (`ContextSourceType`)
`process`, `organization`, `user`, `dfd`, `etp`, `tr`, `price_research`, `intelligent_item`,
`approved_document`, `ai_draft`. **`ai_draft` nunca afirma fato** (existe só para rastrear texto sugerido).

### 3.2 Afirmação (`FactAssertion`) — o que é gravado
`path`, `value` (texto/número/nulo), `valueHash`, `sourceType`, `sourceId`, `sourceVersion`, `status`
(`observed` < `draft` < `confirmed` < `approved`), `actorUserId`, **`basisValueHash`** (o valor que o autor
VIU ao afirmar), `createdAt`, `correlationId`. Deduplicação estrutural por `(organization_id, dedup_key)`,
onde `dedup_key = sha256(org, processo, path, fonte, id, versão, valueHash)` — retry nunca duplica.

### 3.3 Campo resolvido (`CanonicalField`)
`value`, `status` (`unknown` | estado | `conflict`), `source {type,id,version}`, `actorUserId`,
`updatedAt`, `valueHash`, `corroboratedBy[]`, `conflict[]` (divergências expostas, nenhuma escolhida).

### 3.4 Caminhos
Escalares: `process.number`, `process.object`, `organization.name`, `organization.location`,
`demand.requestingUnit`, `demand.responsibleParty`, `planning.pcaAlignment`, `planning.priority`,
`planning.desiredDate`. Itens: `items.<canonicalItemId>.description|unit|plannedQuantity` — o segmento é o
**id estável do Item Canônico** (§11), nunca descrição/unidade.

### 3.5 Projeções (sem duplicar dados)
Processo (número, objeto, responsável → nome do usuário) e Organização (nome, município/UF) entram como
afirmações `confirmed` **derivadas na leitura** (id 0). Os **itens** do contexto são os Itens Canônicos
ATIVOS (`procurement_items`, §11): descrição/unidade projetadas da entidade (confirmadas por humano). Itens
Inteligentes NÃO criam itens do contexto: são **evidência** de preço/quantidade da fonte, ligadas a um item
por vínculo humano (`procurement_item_source_links`). Só o que não tem casa no schema (unidade demandante,
planejamento, quantidade prevista) vai para o ledger de fatos.

## 4. Política de autoridade (explícita, central, testada)

`AUTHORITY_POLICY` em `canonicalProcurementContext.ts` — a ÚNICA definição de quem pode afirmar o quê:

| Caminho | Fontes autorizadas |
|---|---|
| `process.*` | `process` |
| `organization.*` | `organization` |
| `demand.requestingUnit`, `demand.responsibleParty` | `process`, `user`, `dfd`, `etp`, `tr`, `approved_document` |
| `planning.*` | `user`, `dfd`, `etp`, `approved_document` |
| `items.*.description`, `items.*.unit` | `user`, `dfd`, `etp`, `tr`, `approved_document`, `intelligent_item` |
| `items.*.plannedQuantity` | `user`, `dfd`, `etp`, `tr`, `approved_document` — **NUNCA** `price_research`/`intelligent_item`/`ai_draft` |

Aplicada **na escrita** (`recordContextAssertions` recusa com `CONTEXT_SOURCE_NOT_ALLOWED`) e **na leitura**
(o resolvedor ignora — defesa em profundidade).

## 5. Resolução determinística (`resolveField`)

1. filtra pela política;
2. vigente por fonte (`sourceType:sourceId`) = maior id do ledger;
3. **superação consciente**: uma afirmação posterior, de autoridade ≥, cujo `basisValueHash` = o valor de
   outra, supera-a (ex.: o humano alterou no DFD o valor pré-preenchido do Processo);
4. entre as vigentes de maior autoridade: um valor → resolvido (demais = `corroboratedBy`);
   valores distintos → **`conflict`**, `value = null`. Conflito **nunca** é resolvido automaticamente.

Sem fuzzy matching, sem LLM: igualdade de valor por texto normalizado (espaços) / número canônico.

## 6. Fonte ≠ necessidade (quantidades)

- `PriceEvidence.sourceQuantity` = quantidade **vista no documento** da Pesquisa (1, real, parcial ou
  ausente → `null`). É evidência, formato-agnóstica (PDF, XLSX, CSV, DOCX, colagem, manual convergem nos
  Itens Inteligentes).
- `plannedQuantity` = quantidade **a contratar**, só por humano/documentos da necessidade.
- **Identidade** do item = `procurement_items.id` (estável, gerado uma vez pela ORIGEM). O antigo
  `canonicalItemKey` (descrição normalizada + unidade canônica, sem quantidade) passou a ser apenas
  **fingerprint** de matching (§11.3) — nunca identidade.
- **Preço de referência (auditoria da #256 corrigida)**: `unitReferencePriceCents` é **consumido** do domínio
  da Pesquisa de Preços — o `averagePriceCents` do Item Inteligente **aprovado** vinculado AO item (média das
  cotações DAQUELE item, calculada em `priceQuoteConsolidation`). O contexto **não cria regra de preço**:
  nunca faz média entre itens diferentes nem entre Itens Inteligentes distintos. Vários vinculados com preços
  diferentes ⇒ `null` + `priceAmbiguous` (decisão humana). (A versão inicial da #256 fazia média ponderada
  entre Itens Inteligentes do mesmo fingerprint — por item, nunca entre itens, mas ainda assim uma regra nova;
  foi removida. Regressão: `canonical-procurement-context.test.ts` 15/15b.)
- `estimatedTotalCents` = `plannedQuantity × unitReferencePrice` **somente** quando ambos definidos;
  `priceContext.complete` só com todos os itens completos. Nunca se assume "Pesquisa = quantidade 1" nem
  "Pesquisa = quantidade real".

## 7. Versão e digest

- `version` = maior id do ledger consumido (0 = só projeções), monotônico por processo.
- `digest` = `canonicalDigest` dos FATOS resolvidos (valor + origem + estado + conflitos + referência de
  preço + quantidades de evidência). Timestamps e atores **não** entram. Mesmas entradas ⇒ mesmo digest,
  independentemente da ordem de leitura.
- O documento registra o que consumiu (`ctxv:` / `ctxdigest:` nos marcadores) → base de detecção de
  desatualização e de replay (o digest entra no `payloadHash` da geração).

## 8. Multi-tenant, RBAC, auditoria e observabilidade

- `organizationId` **sempre** do contexto autenticado; processo carregado por `(processId, organizationId)`;
  ledger lido/gravado por `(organization_id, process_id)`; dedup por `(organization_id, dedup_key)`.
- Leitura: `tenantProcedure`. Escrita: só via writes governados (`operator`+).
- Eventos (estruturados, **sem conteúdo sensível** — só contagens, hashes e ids):
  `canonical_context_initialized`, `canonical_context_resolved` (organizationId, processId, contextVersion,
  contextDigest(16), knownFields, unknownFields, conflictCount, items, durationMs, correlationId),
  `canonical_context_field_changed`, `canonical_context_unavailable`, `dfd_prefill_generated`,
  `dfd_field_overridden`, `dfd_ai_draft_generated`, `document_context_stale`, `document_context_reconciled`.
- Métricas de produto derivam desses eventos (contagens): campos pré-preenchidos, informados, alterados,
  desatualizados, em conflito.

## 9. Migration 0305 — justificativa

Única tabela nova, **aditiva** (nenhum ALTER/UPDATE/DELETE/backfill), tenant-scoped, idempotente,
compatível com deploy rolling (código antigo ignora a tabela), **replay-safe** (`CREATE TABLE IF NOT
EXISTS` + índice guardado por `information_schema`), MySQL 8.4 e MariaDB. Necessária porque unidade
demandante, planejamento e quantidade prevista não têm casa: `procurement_processes` só guarda
número/objeto/responsável; `intelligent_items.quantity` é a quantidade da **cotação** (e compõe a
identidade do item); `generated_documents` guarda texto; `process_timeline` guarda narrativa.

## 10. Contrato para os próximos consumidores (ETP / TR / Edital — não implementados nesta entrega)

> Itens e lotes: consumir `ctx.items` (id estável, lotId, ordinal, descrição, unidade, `plannedQuantity`,
> `priceContext`) e `ctx.lots` — nunca `intelligent_items.quantity` como quantidade a contratar.

1. **Ler** o contexto com `resolveProcurementContext` (nunca recalcular fatos por conta própria).
2. **Projetar** para o vocabulário do documento com uma função pura (`buildXPrefill(ctx)`), sem IA para fatos.
3. **Gravar linhagem** nos `sources` do documento: `ctx:canonical-context/1`, `ctxdigest:`, `ctxv:`,
   `pf:<campo>=<hash>@<origem>`, `ai:<campo>=<hash>@<executionId>@<ctxdigest>` (helpers `readMarkers`/
   `writeMarkers`/`computeDFDFieldStates` são o modelo).
4. **Afirmar** o que o humano informou/alterou no documento salvo com a fonte do documento (`etp`/`tr`),
   `status: confirmed`, `basisValueHash` = valor visto, NA MESMA transação do save.
5. **Nunca** sobrescrever edição humana: desatualização é indicada e reconciliada por ação explícita.
6. IA só via `AIExecutionEngine`, com fatos canônicos governados, saída = rascunho marcado.

## 11. Itens da Contratação & Lotes (Canonical Procurement Items & Lots — migration 0306)

Área **transversal** do processo ("Itens da contratação", aba do workspace existente): funciona qualquer que
seja a etapa em que o processo começou (DFD, ETP, Pesquisa, TR, importação). Pesquisa/DFD/ETP/TR/Edital
**não são donos** dos itens: produzem evidências (candidatos) ou consomem o item.

| Camada | Arquivo |
|---|---|
| Domínio (puro) | `server/domain/procurementItems.ts` — ids, fingerprint, candidatos, matching, decisões, lotes, governança |
| Persistência | `server/db/procurementItems.ts` + tabelas `procurement_items`, `procurement_lots`, `procurement_item_source_links`, `procurement_item_events` |
| Serviço | `server/services/procurementItemsService.ts` |
| API | `procurementItems.*` (`server/routers/procurementItemsRouter.ts`) |
| UI | `client/src/components/procurement/ProcurementItemsWorkspace.tsx` (aba "Itens da contratação") |

### 11.1 Item Canônico
`id` (24 hex, **estável**), organizationId, processId, descrição, unidade, `lotId | null`, `ordinal` (ordem
oficial — nunca `createdAt`), `status` (active | withdrawn — nunca hard-delete), `fingerprint`, `origin`
(price_research | dfd | manual), `provenance` por campo, `revision` (concorrência otimista), autoria/tempo.
**Não há coluna de quantidade**: `plannedQuantity` vive SÓ no ledger de fatos (`items.<id>.plannedQuantity`,
fonte `user`, `sourceVersion = r<rev>:<informed|adopted_source:…>`). Item pode existir sem quantidade.

### 11.2 Identidade estável
Gerada uma vez a partir da ORIGEM: `sha256(pitem:v1:org:process:<sourceType>:<sourceId>:<sourceItemKey>)`
para itens preparados de uma fonte; `…:manual:<ator>:<idempotencyKey>` para itens manuais. Nunca é
recalculada de descrição/unidade: editar descrição ou mover de lote **não** muda o id.

### 11.3 Fingerprint e matching (sem fuzzy, sem embeddings, sem LLM)
Ordem: (1) vínculo persistido desta evidência ⇒ `linked`; (2) identidade estrutural já vinculada (mesma
fonte + chave estrutural) ⇒ `linked`; (3) fingerprint EXATO ⇒ apenas PROPOSTA: 1 item ⇒ `possible_match`
("Possível item já cadastrado" — [Associar ao existente] / [Criar como novo]); vários ⇒ `ambiguous`
(humano escolhe); (4) `new`. Nada é fundido automaticamente; itens iguais em lotes diferentes coexistem.

### 11.4 Candidatos e gate da Pesquisa de Preços
`ItemCandidate { candidateKey, sourceType, sourceId, sourceItemKey, sourceDigest, description, unit,
sourceQuantity, sourceLotCode, fingerprint, match, duplicateOfCandidateKey }` — projeção **read-only e
determinística** (mesma fonte ⇒ mesmos candidatos e mesmo `sourceDigest`).
- **Pesquisa**: a fonte são os **Itens Inteligentes materializados** — só existem após promoção de sessão
  **aprovada** (revisão humana concluída, sem linhas pendentes) ou importação manual pelo operador. É o menor
  gate seguro: staging/OCR não revisado NUNCA é fonte. Rejeitados não entram; identidade em revisão
  (`review_required`) ⇒ `blocked`. 5 itens lógicos / 30 cotações ⇒ **5** candidatos.
- **DFD**: linhas da tabela de itens do DFD (inclusive coluna "Lote"), para quem começou pelo DFD.
- Confirmar: o servidor RECALCULA a projeção e exige o mesmo `sourceDigest` (senão `STALE_CANDIDATES`);
  valida cada decisão (create / link / skip) — o browser nunca escolhe ids arbitrários.

### 11.5 sourceQuantity × plannedQuantity
`sourceQuantity` (1, 35, nula, outra) é preservada no vínculo e exibida como "Quantidade no documento: N".
Nunca é sobrescrita e nunca vira prevista sozinha. "Usar N" (por item, ou em lote com preview + seleção
individual + confirmação, numa transação) grava `plannedQuantity = N` por decisão humana, com ator, origem,
valor observado × adotado, correlação e tempo (`procurement_source_quantity_adopted`). 1 ≠ 50 coexistem.

### 11.6 Item manual
"+ Adicionar item": descrição*, unidade*, quantidade prevista (opcional), lote (opcional), motivo/contexto
(opcional; referência opcional ao documento em que se trabalhava). Origem `manual`. **Não** cria staging,
cotação, vínculo com a Pesquisa nem altera `sourceQuantity`: a Pesquisa continua com os itens que de fato
identificou.

### 11.7 Descrição/unidade
Pré-preenchidas da fonte; podem ser editadas antes de confirmar ou depois. A proveniência guarda o valor da
fonte (`sourceValue`) e quem alterou (`overriddenBy`). O texto da Pesquisa nunca é alterado.

### 11.8 Lotes
`procurement_lots`: id estável, código (único por processo via `code_key` normalizado: "Lote 01" ≡ "01" ≡
"1"), nome, descrição, ordinal, status (active | archived — nunca hard-delete; arquivar exige lote vazio e
motivo), revision. Opcionais: sem lotes a área é uma lista simples; nenhum lote "Único" artificial.
Pertencimento (`lotId | null`) é **estado estrutural**, não identidade: atribuir/mover/retirar gera eventos
(`procurement_item_assigned_to_lot` / `_moved_between_lots` / `_unassigned_from_lot`) e mantém o id.
Lote da fonte: só com evidência **estrutural explícita** (ex.: coluna "Lote" na tabela do DFD) ⇒ proposta
"[Usar estrutura identificada] [Escolher outro lote] [Sem lote]"; sem evidência ⇒ "Lote não identificado".
Nenhum parser atual da Pesquisa extrai lote (a coluna LOTE é descartada e identificadores empilhados ficam
opacos) — por isso candidatos da Pesquisa chegam sem lote e o servidor escolhe.

### 11.9 Duplicidade, replay e concorrência
- Estrutural: `UNIQUE(org, process, source_type, source_id, source_item_key)` nos vínculos + id determinístico
  pela origem ⇒ reprocessar a Pesquisa ou clicar duas vezes NUNCA duplica.
- Idempotência: toda escrita usa `idempotencyKey` (mesma chave+payload ⇒ replay; payload diferente ⇒ CONFLICT).
- Transação única por operação (confirmar 5 itens = tudo-ou-nada).
- Concorrência: CAS por `revision` ⇒ `STALE_REVISION` (CONFLICT); nunca last-write-wins silencioso.

### 11.10 Contexto, DFD e desatualização
Quantidade definida na Área alimenta o MESMO ledger ⇒ nova versão/digest do contexto; drafts que consumiram
o valor (ex.: DFD, via marcadores `pf:item:<id>`) ficam **desatualizados** e são reconciliados por ação
explícita. O DFD pré-preenche descrição/unidade/quantidade prevista dos Itens Canônicos (coluna "Lote"
quando há lotes; "[a definir]" sem quantidade). Linhas do DFD são ligadas ao item pela **linhagem persistida
por `canonicalItemId`** (§12.2) — fingerprint só como recuperação; linha sem item correspondente não cria
item — fica como candidata ("Preparar a partir do DFD").

### 11.11 Guarda de governança (antecipa a Alteração Governada da Necessidade)
Regra temporária de domínio (`governedChangeReason`), com erro estável `GOVERNED_CHANGE_REQUIRED`:
- elaboração (sem documento aprovado/oficial dependente): edição livre, auditada, nova versão do contexto;
- TR ou Edital com versão **oficial emitida** ⇒ qualquer mudança em itens/lotes exige alteração governada;
- documento **aprovado** consumiu o item ⇒ alterar quantidade já definida, descrição, unidade ou retirar exige
  alteração governada (definir pela 1ª vez uma quantidade "a definir" é permitido).
Documentos aprovados nunca são atualizados automaticamente. O workflow completo é a próxima entrega.

### 11.12 Auditoria e observabilidade
Ledger `procurement_item_events` (append-only; hashes antes/depois, fonte, motivo, correlação; sem conteúdo
integral): `procurement_item_created`, `_added_manually`, `_updated`, `_withdrawn`, `_reordered`,
`procurement_source_item_linked`, `procurement_source_quantity_adopted`, `procurement_planned_quantity_changed`,
`procurement_lot_created`, `_updated`, `_archived`, `_reordered`, `procurement_item_assigned_to_lot`,
`_moved_between_lots`, `_unassigned_from_lot`. Logs: `procurement_items_workspace_resolved` (itemCount,
lotCount, unassignedItemCount, unknownQuantityCount, candidateCount, conflictCount, durationMs, correlationId)
e `procurement_items_candidates_prepared` (source, sourceDigest, sourceItemCount, matchedCount,
newCandidateCount, ambiguousCount, blockedCount).

### 11.13 RBAC e tenant
Leitura (`workspace`, `candidates`): qualquer membro (viewer = somente leitura). Escrita: `operator`+
(mesmo papel dos demais writes do Processo Licitatório; promoção/emissão continuam com manager+).
`organizationId` sempre do ctx; processo validado por (processId, org); todo id revalidado no serviço.

### 11.14 Migration 0306 — justificativa
Itens/lotes são entidades operacionais (identidade, ordem, pertencimento, status, revisão) — serializá-los
como fatos tornaria ordem, movimentação e deduplicação frágeis. `intelligent_items` não é reutilizado como
item da contratação: sua `quantity` é da cotação e compõe sua identidade. Puramente aditiva, tenant-scoped,
sem FK física (convenção do repositório), replay-safe (`CREATE TABLE IF NOT EXISTS` + índices guardados por
`information_schema`), MySQL 8.4/MariaDB, compatível com rolling deploy. A 0305 não foi alterada.

### 11.15 Futuro
ETP/TR/Edital consomem `ctx.items`/`ctx.lots` (§10). A Alteração Governada da Necessidade substituirá a
guarda do §11.11 por um workflow de solicitação/aprovação. O TR já consome `plannedQuantity` (§12.1);
ETP e Edital ainda não (achado registrado no §12.4).

## 12. Fechamento P0 — TR, linhagem do DFD e lotes na importação

### 12.1 Contrato do TR (quantidade PREVISTA)
Gate **determinístico** (sem feature flag): processo com ao menos um Item da contratação `active` ⇒ o TR entra
no modo canônico (`quantitySource = "canonical_planned"`); sem Itens Canônicos ⇒ caminho legado inalterado
(mesmo quadro, mesmo snapshot, mesmo digest — nenhum TR histórico muda).

No modo canônico o quadro autoritativo do TR (`authoritativeItems`) consome, **por Item Canônico**:
- `canonicalItemId` — identidade da linha (ordem = ordinal da Área de Itens);
- `plannedQuantity` — quantidade a contratar (fato do ledger, proveniência própria);
- `unitReferencePrice` — preço de referência **já vinculado** ao item (evidência aprovada da Pesquisa; nenhuma
  regra nova de preço);
- `estimatedTotal = plannedQuantity × unitReferencePrice`, por item; total global = soma dos itens.

O TR **não usa** `sourceQuantity` / quantidade da cotação (`intelligent_items.quantity`) — ela continua só como
evidência na proveniência. Cotações, CATMAT/CATSER e estado das fontes vêm apenas das evidências vinculadas ao item.

Fail-closed em `generateDocument`, **antes** de reservar idempotência ou chamar IA:
- item ativo sem quantidade prevista (ausente, em conflito ou ≤ 0) ⇒ `PLANNED_QUANTITY_REQUIRED` —
  "Defina a quantidade prevista do item antes de gerar o Termo de Referência." (nunca assume 1, nunca usa a fonte);
- Item Inteligente aprovado **sem vínculo** com um Item Canônico ⇒ `PRICE_RESEARCH_ITEM_UNLINKED` (não é
  presumido como necessidade; nenhum vínculo é criado silenciosamente).
Logs: `tr_generation_blocked_missing_planned_quantity` (missingItemCount) e
`tr_generation_blocked_unlinked_price_research_items` (unlinkedItemCount).

Replay: `plannedQuantity` entra no snapshot/`sourcesDigest` ⇒ no `payloadHash`. Mesma chave + mesma
quantidade ⇒ replay; mesma chave + quantidade diferente ⇒ `CONFLICT`; TR gerado antes de a quantidade mudar ⇒
`source_changed` (`getAuthoringSourceState`). Linhagem no TR: `qtd:prevista` e `ctxdigest:<16>` em `sources`.
TR aprovado/oficial **nunca** é mutado; com TR oficial, mudar itens exige alteração governada (§11.11).

### 12.2 Linhagem do DFD (identidade das linhas)
- **Identidade = `canonicalItemId`**, persistida em `generated_documents.sources` como
  `pr:<canonicalItemId>=<nº do item>:<rowKey>` (gravada ao gerar o DFD e regravada a cada save/reconciliação a
  partir do vínculo atual — sem schema novo, sem migration).
- **Fingerprint = matching** (descrição+unidade normalizadas); **lotId = pertencimento** — nenhum dos dois é identidade.
- Ordem de ligação de cada linha: (1) linhagem persistida — nº+rowKey, depois só rowKey, depois só nº, sempre
  única e apenas para itens ativos; (2) vínculo de fonte persistido (linha do DFD já confirmada na Área de Itens);
  (3) **recuperação** por fingerprint (+ lote) só quando não há id persistido: 1 ⇒ liga; 0 ⇒ não liga; >1 ⇒
  **ambíguo** (nunca escolhe).
- Linha ligada a X continua em X quando descrição, unidade, lote, ordem ou fingerprint mudam (no item ou no texto).
- Mudança de lote do item ⇒ campo `itemlot:<id>` desatualizado; "Atualizar no rascunho" altera só a célula
  "Lote" (id inalterado, nenhuma linha nova).
- Candidatos "Preparar a partir do DFD" decidem "já ligado" por `canonicalItemId`/vínculo persistido antes do fingerprint.

### 12.3 Lotes na importação (limitação documentada)
- Lotes são entidades canônicas (`procurement_lots`) e podem ser geridos manualmente na Área de Itens.
- Estrutura **explícita** vinda da fonte/adaptador é usada quando existe — o DFD tabular (coluna "Lote") já suporta.
- A Pesquisa de Preços **não** tem parser genérico de lotes: seus candidatos chegam sem lote.
- Sem informação de lote ⇒ atribuição **humana** ("Lote não identificado"); nada é inferido.
- Adaptadores futuros podem fornecer estrutura de lote (`sourceLotCode`) sem mudança de domínio.

### 12.4 Achados fora do escopo (não alterados)
ETP (prompt) e Edital (`editalContext`) ainda usam a quantidade da cotação dos Itens Inteligentes aprovados;
deverão consumir `plannedQuantity` pelo mesmo contrato do §12.1 em entrega própria.
