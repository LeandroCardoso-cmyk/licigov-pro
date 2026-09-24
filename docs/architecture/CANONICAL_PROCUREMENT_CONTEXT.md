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
`planning.desiredDate`. Itens: `items.<key>.description|unit|plannedQuantity`.

### 3.5 Projeções (sem duplicar dados)
Processo (número, objeto, responsável → nome do usuário) e Organização (nome, município/UF) entram como
afirmações `confirmed` **derivadas na leitura** (id 0). Itens Inteligentes não rejeitados entram como
**observação** de descrição/unidade e como **evidência de preço**. Só o que não tem casa no schema
(unidade demandante, planejamento, itens/quantidade prevista informados) vai para o ledger.

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
- **Identidade do item da contratação** = `sha256("need-item:v1:" + descrição normalizada + "|" + unidade
  canônica)` — **sem quantidade** (reusa as normalizações da chave do Item Inteligente). Cotações do mesmo
  produto com quantidades de documento diferentes convergem para UM item.
- `unitReferencePriceCents` = média ponderada por nº de cotações dos Itens **aprovados**.
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

1. **Ler** o contexto com `resolveProcurementContext` (nunca recalcular fatos por conta própria).
2. **Projetar** para o vocabulário do documento com uma função pura (`buildXPrefill(ctx)`), sem IA para fatos.
3. **Gravar linhagem** nos `sources` do documento: `ctx:canonical-context/1`, `ctxdigest:`, `ctxv:`,
   `pf:<campo>=<hash>@<origem>`, `ai:<campo>=<hash>@<executionId>@<ctxdigest>` (helpers `readMarkers`/
   `writeMarkers`/`computeDFDFieldStates` são o modelo).
4. **Afirmar** o que o humano informou/alterou no documento salvo com a fonte do documento (`etp`/`tr`),
   `status: confirmed`, `basisValueHash` = valor visto, NA MESMA transação do save.
5. **Nunca** sobrescrever edição humana: desatualização é indicada e reconciliada por ação explícita.
6. IA só via `AIExecutionEngine`, com fatos canônicos governados, saída = rascunho marcado.
