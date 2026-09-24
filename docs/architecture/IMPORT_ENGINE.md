# LiciGov Pro — Arquitetura do Motor de Importação (Ingestão Canônica)

> Documento de arquitetura real do motor de importação. Complementa o guia funcional em
> [`docs/imports/README.md`](../imports/README.md). Atualizado na PR B.2.1.

## Princípio inegociável

> **Raw extraction NUNCA persiste diretamente no domínio.**

```
Upload → Ingestão → Parsing (texto nativo | OCR governado) → Staging → Validação → Revisão Humana → Aprovação → Promoção governada
```

Cada dado importado carrega proveniência completa e passa por revisão humana antes de qualquer
efeito no domínio. A promoção ao domínio (B.2.4) é transacional, idempotente e exige papel **manager+**.

> **U2A / U2A-OCR (Pesquisa de Preços):** desfechos explícitos da extração (`OCR_REQUIRED`, `OCR_PROCESSING`,
> `OCR_FAILED`, `PARSER_FAILED`, `NO_VALID_ITEMS`, `REVIEW_REQUIRED`, `READY_FOR_REVIEW` — em `stage` +
> `errors[0].code`, sem migration) e invariantes `validItemCount === 0 ⇒ aprovar/promover PROIBIDO`
> (`server/domain/importOutcome.ts`). PDF digitalizado: porta `OcrPort` (`server/domain/ocr.ts`) com adapter
> de infraestrutura Tesseract local (`server/providers/ocr/`); layout por geometria (`parsers/ocrLayout.ts`)
> alimenta o **mesmo** parser tabular (`matrixToRawItems`/`linesToRawItems`). Linhagem + fingerprint de
> replay em `extractionSummary.extraction` (`server/domain/extractionLineage.ts`). Decisão e dependências:
> [OCR_LOCAL.md](OCR_LOCAL.md); operação: [INGESTION_RUNBOOK.md](../ops/INGESTION_RUNBOOK.md).

> **Layout v2/v3 — PDF DIGITAL layout-aware (parser PDF 2.3.0, `PDF_LAYOUT_VERSION = 3`):** o texto nativo **não é
> linearizado** antes da reconstrução da tabela. Ver a seção [Reconstrução tabular geométrica](#reconstrução-tabular-geométrica-layout-v2)
> e [Reprocessamento seguro](#reprocessamento-seguro-da-extração-layout-v2).

## Camadas

```
Cliente (workspaces canônicos — futura B.2.2)
   │  createSession (metadados) + presigned-less upload + polling de status
API tRPC  ─ server/routers/ingestionRouter.ts ......... superfície canônica (tenantProcedure, flag-gated)
Rota Express ─ server/routes/ingestionUploadRoute.ts .. byte-upload cru (application/octet-stream)
Serviços ─ server/services/
   ├─ fileIngestionService ...... sessões, validação, transições de status, dedup por checksum
   ├─ ingestionUploadService .... sniff de conteúdo (magic bytes), chave S3 anti path-traversal, flag
   ├─ importQueueService ........ fila in-memory (retry backoff + DLQ) → parse → staging
   └─ importStagingService ...... persistência de staging + revisão humana (approve/reject/skip)
Domínio ─ server/domain/import*.ts, canonicalUnits, extractionEvidence, importReviewState
Storage ─ server/storage.ts (Amazon S3, ponto único de acesso)
Persistência ─ import_sessions / import_staging_items / import_review_transitions
```

## Estado do schema (PR B.2.1)

`import_sessions` ganhou 3 colunas **aditivas/nullable**, criadas pela migration **formal e
versionada** [`drizzle/0288_import_session_canonical_fields.sql`](../../drizzle/0288_import_session_canonical_fields.sql):

| Coluna | Tipo | Uso |
|---|---|---|
| `checksum` | `varchar(64)` | Dedup sha256 (índice de busca `import_sessions_org_checksum_idx`, NÃO único — sem unicidade global) |
| `processId` | `int` | Vínculo/lineage com o processo licitatório (ownership validado no serviço: processId + organizationId) |
| `importPurpose` | `varchar(50)` | Finalidade da importação (orienta a promoção futura) |

A migration é puramente aditiva (sem backfill, sem NOT NULL, sem UNIQUE). O `checksum` é calculado
pelo **servidor** (SHA-256); um valor informado pelo cliente é apenas expectativa a validar.

O `ensureSchema` (`server/bootstrap.ts`) **não** cria mais essas colunas — apenas **verifica** a
presença e, se ausentes, emite falha acionável em produção/staging (aviso em dev), sem mutar o
schema silenciosamente. `runMigrations()` roda antes do `ensureSchema()`, então em boot normal as
colunas já existem. `schema-audit` compara `drizzle/schema.ts` com o banco real.

## Feature flag

`FF_CANONICAL_INGESTION` — tenant-aware via `featureFlagService.isFeatureEnabled`, **fail-closed**
(desabilitada por padrão, inclusive em produção). Toda a superfície tRPC e a rota de upload são
bloqueadas (`FORBIDDEN`) quando a flag está desligada para o tenant.

## Upload de bytes (multipart streaming, fora do tRPC)

- base64 no tRPC é proibido (custo + memória) e o Storage Service **não** expõe presigned PUT.
- A rota `POST /api/ingestion/upload/:sessionId` recebe **multipart/form-data em streaming** (busboy):
  1. autentica igual ao tRPC (JWT cookie → user → tenant) e checa a flag **ANTES** de consumir o corpo;
  2. impõe o teto de tamanho **durante** o streaming e aborta imediatamente ao exceder;
  3. calcula o SHA-256 incrementalmente (autoridade do servidor);
  4. valida magic bytes × MIME declarado assim que os primeiros bytes chegam;
  5. usa a **chave de objeto gerada no servidor** no createSession
     (`imports/{orgId}/{yyyymmdd}/{uuid}-{nome-sanitizado}` — nome nunca vem do cliente);
  6. faz **streaming direto para o S3** via `@aws-sdk/lib-storage` (multipart) — nenhum Buffer com o
     arquivo completo, backpressure preservado (`stream.pipeline`);
  7. em qualquer falha, faz **cleanup do objeto parcial** em `finally`.

## Fila e replay-safety

`importQueueService` é uma fila **in-memory** (retry com backoff exponencial + DLQ). O **job carrega
apenas identificadores/metadados seguros** — `sessionId`, `organizationId`, `storageKey`,
`correlationId`, `attempt` — **nunca o Buffer**. O binário é recuperado do storage durável
(`storageGetBytes`) **no worker**, no momento do parse, com limite rígido de tamanho (limitação
documentada: os parsers atuais exigem Buffer completo; parsing em streaming remove isso).

`enqueueProcessing` é replay-safe por status (não re-enfileira em voo; conflito em estado terminal)
e dedup in-flight por sessão. Após restart, `recoverStuckImportSessions` reidrata sessões presas
(`queued`/`parsing`): **claim atômico no banco** (`claimSessionForRecovery`, impede execução
concorrente duplicada via row-lock), respeita o limite de tentativas, encaminha à **DLQ** quando
esgota, preserva correlationId/lineage e é **fail-closed por tenant**.

## Fora do escopo da B.2.1

Promoção ao domínio (DFD/ETP/Pesquisa de Preços/TR), parser real de PDF/DOCX, wiring de workspaces
e remoção do caminho legado (`processes.parseItemsFile`).

> **Atualização (histórico):** parsers reais PDF/DOCX (B.2.3), promoção da Pesquisa (B.2.4) e, no **P0
> piloto**, importação DOCUMENTAL de DFD/ETP/TR (projeção documental → revisão → rascunho governado) e
> materialização de Itens Inteligentes estão implementados — ver [P0_PILOT_FOUNDATION.md](P0_PILOT_FOUNDATION.md).

## Reconstrução tabular geométrica (Layout v2)

**Causa raiz que motivou a mudança:** PDFs digitais de mapa de apuração (título, cabeçalhos verticais por fonte,
linha "R$", descrições multilinha com preço centralizado, "/////", média, total, percentual, página de assinatura)
eram lidos como **texto linearizado** (`getText` linha a linha) ou pela grade do `getTable`. A linearização
destruía a relação linha × coluna: "R$", fragmentos do título e cabeçalhos viravam "itens", e as colunas de
fontes não eram expandidas em cotações. O problema **não** era OCR — o texto nativo era utilizável.

```
PDF digital   → pdfjs getTextContent (transform/width/height, ordem original) ─┐
                                                                               ├→ PositionedTextToken
PDF escaneado → OCR (OcrPort) → palavras com caixa + confiança ───────────────┘        (source: native | ocr)
        → TableLayoutReconstructor (UMA reconstrução, neutra)  → NormalizedTableMatrix
        → tableToRawItems (MESMO extrator canônico de CSV/XLSX/DOCX) → conferência média/total → staging
```

| Arquivo | Papel |
|---|---|
| `server/parsers/layout/positionedText.ts` | `PositionedTextToken`; adapters `tokensFromPdfTextItems` (caixa pela matriz de transformação — suporta texto rotacionado e `/Rotate`) e `tokensFromOcrPage` (palavra alta/estreita ⇒ vertical; traços de régua `\| [ ]` nas pontas descartados) |
| `server/parsers/layout/tableLayoutReconstructor.ts` | geometria pura: linhas → fragmentos → bandas de coluna → cabeçalho → blocos multilinha → matriz |
| `server/parsers/layout/layoutExtraction.ts` | matriz → `tableToRawItems`; anotação (linha física, células descartadas, fonte não identificada); conferência média/total; papéis por estrutura quando não há cabeçalho legível |

**Algoritmo (genérico — sem conhecer órgão, fornecedor, sistema emissor ou coordenada):**

1. **Linhas físicas**: tokens horizontais agrupados pelo centro vertical com tolerância **relativa à fonte**
   (0,45 em). Texto vertical é separado (vira rótulo de coluna). Nunca `split("\n")`/ordem do array.
2. **Fragmentos**: palavras com espaço ≤ 0,8 em formam uma célula física; dois valores nunca se fundem; "R$" é
   **prefixo** (liga-se ao valor seguinte, nunca ao anterior).
3. **Linhas estruturais**: candidatas = linhas com ≥ 2 valores; as mais densas (≥ 60% do máximo de fragmentos)
   definem as colunas — linhas de total/rodapé, esparsas, não distorcem a estrutura.
4. **Colunas**: bandas = união dos intervalos X das linhas estruturais (alinhamento repetido) + bandas de linhas
   **satélite** (descrição contínua sem valores); banda só de "R$" funde à direita; banda só de marcadores funde com
   a vizinha com a qual nunca coocorre. Número de colunas de preço **livre** (3, 5, 7, 8…). Dois valores da mesma
   linha na mesma banda ⇒ colunas não alinhadas (texto com espaços) ⇒ a página usa as linhas de texto (compat.).
5. **Papéis de linha (estruturais; texto só como sinal secundário)**: item = âncora que preenche a **maioria** das
   colunas de identificação (índice/descrição/unidade + quantidade); resumo/total = tem valor sem identificação;
   continuação = só texto em colunas textuais; cabeçalho = acima do corpo, alinhado às partições (inclui texto
   vertical); título/agrupador = atravessa colunas (nunca rótulo); rodapé = após a última linha do corpo.
6. **Descrição multilinha**: blocos por espaço vertical (> 0,5 em ⇒ nova célula); continuações vão para a âncora
   do bloco (topo/centro/base detectados pelo próprio bloco; tabela densa ⇒ `LAYOUT_ROW_BOUNDARY_INFERRED`).
7. **Matriz**: "/////", "-", "N/A" ⇒ célula **vazia** registrada (nunca 0); texto sem dígito em coluna monetária ⇒
   descartado com aviso; confiança por célula = mínimo das palavras (OCR).

**Layout v3 (`PDF_LAYOUT_VERSION = 3`) — validado contra a geometria real de um mapa de apuração digital:**

- **Região tabular por estrutura**: linhas densas separadas por cabeçalho (texto vertical) ou mudança de fonte formam
  agrupamentos distintos; a tabela é o maior (empate ⇒ o último). O corpo começa no bloco da 1ª linha estrutural —
  caixas de ID/data/"R$"/valor total, título e objeto acima dele são **preâmbulo**, mesmo quando densas.
- **LogicalItemBlock**: um item pode ocupar 1, 2, 3 ou mais linhas físicas (descrição centrada, unidade acima e
  quantidade abaixo, média acima e total abaixo, identificação em 3 níveis, preço centralizado entre elas). Bloco com
  uma linha estrutural = um item; nova linha com número **não** cria item. Dois itens no mesmo bloco só com duas linhas
  estruturais independentes (mesmas colunas de preço) — com `LAYOUT_ROW_BOUNDARY_INFERRED`.
- **Células empilhadas / subcolunas virtuais**: uma banda X com k campos verticais (cabeçalho com "/" ou k linhas, ou
  níveis texto × número consistentes entre itens) vira k colunas virtuais (ex.: `UNIDADE`/`QTDE.`,
  `MÉDIA ARITMÉTICA`/`VALOR TOTAL`). Níveis só textuais são texto livre (descrição quebrada), nunca empilhados.
  Pilha de identificação (anexo/lote/item) ⇒ `rawMetadata.layout.identifier` ("I / 001 / 003"), nunca cotação.
- **Linhas de total por fonte** (rótulo + números em texto vertical) ⇒ resumo/rodapé; o total geral alimenta só a
  conferência. Cabeçalho de 1 caractere (`N`, `#`) só casa palavra inteira (fonte "N…" não vira coluna de índice).
- **Golden E v2** (`stackedMapPdf`) reproduz essa geometria (palavra a palavra, monoespaçada, 100% fictícia).

**Páginas sem itens**: página sem tabela (identificação, assinatura, rodapé) ⇒ `pageHasNoItemTable`; havendo tabela
em qualquer página (nativa ou OCR), essas páginas **não** passam pelo fallback de linhas (não geram item-lixo).

**Fontes/cotações**: cada valor válido é uma cotação independente (formato largo do extrator canônico); fornecedor =
rótulo da coluna (inclusive vertical). Coluna sem rótulo legível ⇒ valor preservado, `rawSupplier = null` +
`SOURCE_IDENTITY_UNRESOLVED` (nunca inventa fornecedor). Coluna casada como "Fonte/Marca/Obs." cujos valores são
todos preços é tratada como coluna de cotação.

**Média e total impressos = evidência de conferência** (nunca item, nunca preço): média calculada das cotações
válidas pelo contrato monetário (centavos inteiros, half-up **uma** vez) × média impressa (tolerância 1 centavo ⇒
senão `DOCUMENT_AVERAGE_MISMATCH`); total calculado (Σ quantidade × média calculada) × total impresso (tolerância
1 centavo/item ⇒ senão `TOTAL_RECONCILIATION_MISMATCH`). Resultado em `extraction.layout.validation`. Nada é
ajustado para "bater". Valor fora do formato monetário estrito (ex.: `1.14000` de OCR) ⇒ `AMBIGUOUS_MONEY_VALUE`.

**Sem cabeçalho legível** (ex.: rótulos verticais não lidos pelo OCR): papéis inferidos pela estrutura — descrição =
coluna textual mais longa; unidade = textual curta; quantidade = 1ª coluna de valores; **média = coluna derivada**
(média das colunas de valor à esquerda, ±1 centavo); total = quantidade × média; fontes sem identidade + aviso
`LAYOUT_HEADER_INFERRED`. Estrutura inconclusiva ⇒ ordem posicional com `HEADER_INFERENCE`.

**Convergência OCR**: as palavras do OCR entram no MESMO reconstrutor (mesma matriz para a mesma geometria — teste
de convergência). O fallback de linhas do OCR (`ocrLayout.ts` v1) só atua em página sem linhas-âncora e sem tabela
no documento. **OCR não roda em PDF digital** com texto útil (`extractionMode = native_text`).

**Versões e replay**: `PDF_LAYOUT_VERSION` (`3`) entra em `extraction.layoutVersion`, no fingerprint
(`extraction-lineage/v2`: checksum + modo por página + heurística + **layout** + parser + OCR quando aplicável) e
em `parserMetadata.layoutVersion` de cada item. Mesmo arquivo + mesmas versões ⇒ mesma ordem item → cotações e
mesmo fingerprint. Mudou o algoritmo ⇒ nova versão.

**Complexidade**: ordenação + agrupamento ≈ **O(n log n)** por página (n = tokens), atribuição de coluna por busca
binária (O(log c)); sem comparação par-a-par entre tokens. Golden E (≈ 130 tokens) ≈ 30 ms; 5.600 tokens < 1 s
(teste de desempenho) — ordens de grandeza abaixo do OCR.

**Observabilidade**: evento `import_layout_reconstructed` (organizationId, processId, sessionId, correlationId,
pageCount, tokenCount, rowCount, columnCount, candidateItemCount, validItemCount, layoutVersion, layoutMode,
durationMs, warningsCount) — **sem** conteúdo do documento.

**Golden E** (`server/__tests__/fixtures/layoutPdfFixtures.ts`, gerado em tempo de teste, 100% fictício): 5 itens,
30 cotações, médias 950,31 / 67,23 / 1.134,28 / 145,29 / 1.052,82, total 3.349,93 — com invariantes negativas,
teste diferencial v1 × v2 e variantes geométricas (sem grade, cabeçalho horizontal, topo, densa, 3 fontes…).

## Reprocessamento seguro da extração (Layout v2)

Uma sessão `awaiting_review` pode ser **reextraída na MESMA sessão** (mesmo original, checksum e linhagem) somente
se **nenhuma decisão humana** existe (`server/domain/importReprocess.ts`):

| Bloqueio | Condição |
|---|---|
| `NOT_AWAITING_REVIEW` | status ≠ `awaiting_review` (aprovada/rejeitada/arquivada/falha) |
| `DOCUMENT_IMPORT` | DFD/ETP/TR (projeção documental) |
| `PROMOTED` | `promotionStatus ≠ none` ou linha no ledger `import_promotions` |
| `ITEMS_REVIEWED` | qualquer item aceito, rejeitado ou pulado |
| `ITEMS_CORRECTED` | item com `correctionRevision > 0` ou histórico em `import_item_corrections` |
| `REPROCESS_IN_PROGRESS` | reserva `stage = reprocessing` vigente (15 min) |

**Invariante: nenhuma decisão humana é sobrescrita.** Fluxo (`importReprocessService` + worker):

```
ingestion.reprocessExtraction (operator+, tenant + processo, motivo)
  → reserva ATÔMICA (UPDATE condicional; status continua awaiting_review; staging antigo intacto)  [concorrência]
  → worker: parse/OCR FORA de transação → sem item revisável? mantém o anterior, libera e audita
  → TRANSAÇÃO: lock da sessão (FOR UPDATE) + reserva/estado/ledger/correções reconferidos
               → itens da sessão FOR UPDATE, todos intocados → DELETE + INSERT (troca atômica)
               → parserVersion, extractionSummary (linhagem nova + `reextractions[]`), stage, avisos
               → activity_logs `import_reextracted` (mesma transação)
  → revisão concorrente (review espera o lock; depois não acha o item antigo ⇒ CONFLICT) ou falha ⇒ rollback total
```

Não cria sessão, pesquisa, promoção, cotação nem Item Inteligente; a promoção continua deduplicada pelo ledger.
**RBAC**: `operator+` — o mesmo papel que envia, enfileira e revisa a sessão; reprocessar não aprova nem promove
(promoção segue `manager+`). **Auditoria**: `import_reextraction_requested` (ator, org, processo, sessão, checksum,
versões anteriores, contagem anterior, motivo, correlationId, timestamp), `import_reextracted` (+ versões novas e
nova contagem) ou `import_reextraction_not_applied` (motivo). **UI**: ação "Reprocessar extração" só quando elegível,
com a explicação "Reprocessar substitui apenas a extração ainda não revisada. Nenhuma decisão humana será
sobrescrita." e motivo obrigatório.
