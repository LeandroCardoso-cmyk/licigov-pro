# P0 Piloto — Document Intake + Pesquisa de Preços → Itens Inteligentes → TR → Edital

> Princípio: **"O LiciGov entra no processo no ponto em que a Prefeitura já está."**
> A Secretaria pode ter o DFD, o ETP ou o TR prontos, ou só as cotações. O processo começa daí, sem
> pré-requisito artificial, e todas as entradas convergem para os MESMOS artefatos canônicos.

Constituição: [`PRODUCT_NORTH_STAR.md`](PRODUCT_NORTH_STAR.md) (IA supervisionada, Regra de Ouro, não-ERP).

Evolução: o **Contexto Canônico da Contratação** ([`CANONICAL_PROCUREMENT_CONTEXT.md`](CANONICAL_PROCUREMENT_CONTEXT.md))
passa a ser a base de fatos reutilizáveis entre documentos; o DFD é o 1º consumidor
([`DFD_CANONICAL_PREFILL.md`](DFD_CANONICAL_PREFILL.md)).

---

## 1. DOCUMENT INTAKE (DFD / ETP / TR importados como documento)

**Mesmo Import Engine** (sem pipeline paralelo): `import_sessions` → upload multipart → Storage Service
(S3; o binário nunca vai ao banco) → fila (`importQueueService`) → parser REAL (PDF `pdf-parse` / DOCX
`mammoth`, versão **2.1.0**) → staging → revisão humana → promoção governada.

| Passo | Onde | Regra |
|---|---|---|
| Tipo | `importType` = `document_dfd` \| `document_etp` \| `document_tr` | só PDF com texto ou DOCX (`.doc` recusado) |
| Extração | parser em `extractionMode: "document"` → `DocumentProjection` (`document-projection/1.0`) | blocos ordenados (título/parágrafo/lista/tabela) + página/tabela; markdown determinístico + `contentHash`. **Sem IA.** |
| OCR | PDF só imagem → sessão `failed` com `OCR_REQUIRED` | terminal, sem retry, **nada fingido como extraído** |
| Staging | `import_document_staging` (1 linha por sessão) | `rawContent`/`rawBlocks`/`rawContentHash` **imutáveis**; `reviewedContent` = overlay humano |
| Revisão | `saveDocumentReview(expectedRevision)` | lock otimista (`CONFLICT`); editar após aprovar desfaz a aprovação |
| Aprovação | `approveDocument(expectedContentHash)` | aprova EXATAMENTE o que o humano viu; sessão → `approved` |
| Promoção | `promoteDocument(mode)` | ver §2 |
| Sugestão (TR) | `itemSuggestions` (tabelas do documento) | **sugestão**, nunca Item Inteligente automático |

Dedup por checksum e retomada de sessão são **escopados por `importType`** (o mesmo arquivo enviado como
TR não adota a sessão da Pesquisa — adoção cruzada corrigida).

## 2. PROMOÇÃO GOVERNADA A RASCUNHO

`documentIntakeService.promoteDocumentToDraft` → `generated_documents` (kind `dfd`/`etp`/`tr`,
status **`rascunho`**), reusando `applyDraftContentMutationTx` (FOR UPDATE, `expectedState`, hash):

- `mode: "create"` — exige **ausência** de rascunho. Rascunho existente ⇒ **`CONFLICT` (fail-closed)**.
- `mode: "replace"` — substituição EXPLÍCITA: `expectedDraftContentHash` (o rascunho que o humano viu) +
  `reason` (≥ 5) ; rascunho mudou ⇒ `CONFLICT`. Conteúdo anterior preservado em
  `generated_document_edits.previous_content` (op `import_replace`). Originador (`author_user_id`) preservado.
- Ledger: `generated_document_edits` (`import_promote` também registra a CRIAÇÃO — `ledgerOnCreate`),
  `import_promotions` (`targetKind` = kind; UNIQUE por sessão), timeline do processo, activity log (só hashes).
- Idempotência: `idempotencyKey` (replay devolve o snapshot; chave reutilizada com outro payload ⇒ `CONFLICT`).
- Lineage (`sources`): `origem:import`, `import:<sessão>`, `checksum:<12>`, `parser:<tipo>@<versão>`,
  `kind:<k>`, `projection:<versão>`. **Sem storageKey.**
- **Nunca** toca `official_documents`; a emissão oficial continua `manager` + SoD (autor/último editor ≠ emissor).

A jusante, **rascunho importado ≡ rascunho gerado** (ETP/TR/Edital leem o mesmo `generated_documents`).

## 3. PRICE RESEARCH PIPELINE

Entradas: PDF / DOCX / XLSX / XLS / CSV / colar / manual (`FF_CANONICAL_INGESTION` — **não ligado em produção**).

- **Extrator tabular único** (`tabularExtraction.ts`) para CSV/XLSX/PDF/DOCX: cabeçalhos → papéis
  (descrição, qtd, unidade, preço unitário, total, **fornecedor, marca, modelo, observação, fonte**),
  colunas estatísticas (média/mediana/menor…) nunca viram cotação.
- **Formato LONGO** (1 linha = 1 cotação) e **LARGO / mapa comparativo** (1 coluna por fornecedor →
  1 cotação por coluna, fornecedor = cabeçalho sem "(R$)"). **Ambíguo** (preço unitário explícito + colunas
  de fornecedor) ⇒ aviso `WIDE_FORMAT_AMBIGUOUS`, **sem chute**.
- **Contrato monetário** (`domain/money.ts`, detalhado em §10.1): centavos inteiros, half-up (BigInt), UM
  arredondamento; texto pt-BR `"R$ 1.234,56"`, `"18,90"`, `"1234.56"`; `"1,234"` = **ambíguo** (correção
  rejeitada `AMBIGUOUS_MONEY`; promoção fail-closed). Célula NUMÉRICA de XLSX **nunca** passa pelo parser de
  texto. Banco canônico = `DECIMAL(14,2)` em **reais**.
- **Promoção** (`manager`, uma transação): `price_research` + `price_research_items` (com fornecedor/marca/
  modelo/obs./fonte) **e** materialização em **Itens Inteligentes** (`itemMaterializationService`):
  - chave lógica determinística = descrição normalizada | unidade canônica | quantidade (milésimos) —
    **sem fuzzy**; id = `sha256(iitem:v2:org:processo:chave)`;
  - item novo → `pendente`; `pendente/em_analise` → cotações convergem por `quoteId` + `contentHash`
    (replay não duplica; conteúdo alterado ATUALIZA);
  - `aprovado/rejeitado` → decisão **preservada** e item sinalizado `source_changed` (§10.3) — nunca
    sobrescrito, nunca ignorado em silêncio;
  - mesmo arquivo (checksum) já promovido no processo ⇒ `CONFLICT` — garantido pelo BANCO (§10.5).
- **Enriquecimento pós-commit** (degradável, sem IA na transação): sugestão CATMAT (ranking), riscos,
  recomendações; `enrichment_status` `pending → processing → done | failed` com recuperação durável (§10.9). **Sugestão ≠ decisão**: nunca sobrescreve
  item com decisão no ledger `catmat_decisions`.
- O caminho manual/colar (`importPriceResearch` → `importManualPriceResearch`) converge no mesmo modelo, na
  MESMA transação (Pesquisa + cotações + base do item), enriquecimento pós-commit.

## 4. AUTHORING CONTEXT (ETP / TR)

`services/authoring/authoringContext.ts` (`authoring-context/2.0`), tenant-scoped:

| Documento | Fontes |
|---|---|
| ETP | processo + DFD (+ resumo de itens/pesquisa se houver) + RAG (art. 18) |
| TR | processo + DFD + ETP + **Itens Inteligentes aprovados** + cotações + **classificação confirmada** (`catmat_decisions` confirmado/substituído) + RAG (art. 6º, XXIII) |

Fonte ausente ⇒ `[REVISAR: …]` explícito + `missing` (nunca inventada; nunca bloqueio artificial).

**Números não são da IA.** Descrição, quantidade, unidade, preço médio, valor do item e valor global entram
por um **quadro autoritativo** (`domain/authoritativeItems.ts`, `authoritative-items/1.0`) renderizado pelo
servidor e inserido no conteúdo:

```
valor estimado do item   = quantidade × preço médio      (centavos, half-up)
valor estimado global    = Σ valor estimado do item
"Baseado em N cotação(ões) válida(s) em M item(ns) aprovado(s)."   (válida = preço > 0)
CATMAT/CATSER: código só quando CONFIRMADO; senão "a revisar (sugestão não confirmada)"
```

O prompt instrui a IA a NÃO redigir quantidades/preços/totais. O mesmo quadro é usado pelo **Edital**.

## 5. TR SOURCE DIGEST + SOURCE_CHANGED

`sourcesDigest` = SHA-256 do **snapshot canônico efetivamente consumido pelo prompt** (§10.7) — regra:
*se altera o prompt, altera o digest; se não altera o prompt, não altera o digest*. Gravado como
`srcdigest:<16>` (+ `ctx:`, `base:dfd@`, `base:etp@`, `coverage:dfd=…`, `itens:`, `cotacoes:`).

`procurementProcess.authoringSourceState` (ETP/TR) — generaliza o SOURCE_CHANGED do Edital:
`never_generated` · `current` · `source_changed` · `imported` (rascunho importado, sem digest) + resumo
das fontes para a UI de pré-geração.

## 6. REPLAY

- `generatePayloadHash` inclui `sourcesDigest` → retry com as MESMAS fontes replaya (sem nova cognição);
  fonte alterada sob a MESMA chave ⇒ `CONFLICT` (nunca devolve documento gerado com contexto antigo).
- Promoção documental e de pesquisa: idempotentes (chave + ledger UNIQUE por sessão).
- Materialização: merge por `quoteId`; replay sem escrita.
- `EDITAL_CONTEXT_VERSION` → `1.2` (1.1: preço em reais, sem `/100`; classificação confirmada; quadro
  autoritativo. 1.2: nº do processo, excerto com cobertura, estado de fonte dos itens no digest): editais
  gerados com versões anteriores aparecem como `source_changed` — correto, o contexto deles era outro.

## 7. RBAC

| Ação | Papel mínimo |
|---|---|
| Ler intake/staging/itens/estado de fontes | viewer (tenant) |
| Criar sessão / upload / enfileirar / revisar / corrigir / aprovar sessão | **operator** |
| Revisar / aprovar / descartar / promover **documento a rascunho** | **operator** |
| Gerar DFD/ETP/TR/Edital, importar pesquisa (manual), aprovar/rejeitar item, decidir CATMAT, criar processo | **operator** |
| Aplicar cotações atualizadas (`applyItemSourceUpdate`) / resolver identidade ambígua (`resolveItemIdentity`) | **operator** |
| Marcar processo como emitido (`issueProcess`) — só PROJETA a etapa; exige Edital OFICIAL já emitido | **manager** |
| Promover **Pesquisa** ao domínio (+ Itens Inteligentes) | **manager** (inalterado) |
| Emissão oficial | **manager** + SoD (inalterado) |

`organizationId` vem SEMPRE do contexto autenticado. Outro tenant/processo ⇒ `NOT_FOUND` (não vaza existência).

## 8. MIGRATION 0303 (replay-safe, aditiva)

`drizzle/0303_p0_document_intake_price_items.sql`: `CREATE TABLE IF NOT EXISTS import_document_staging`;
colunas `rawSupplier/rawBrand/rawModel/rawNotes/rawSource` em `import_staging_items`;
`intelligent_items.enrichment_status` (default `done`); `generated_documents.content` → `LONGTEXT`
(widening, documentos importados > 64 KB). Guardas via INFORMATION_SCHEMA (procedures), sem DROP
destrutivo. Validada: clean install, upgrade, replay, `drizzle-kit generate` sem diff.

## 9. HARDENING BLOQUEANTE (pré-merge do PR #245)

Suítes: `server/__tests__/unit/p0-pilot-hardening.test.ts` (domínio puro) e
`server/__tests__/integration/p0-pilot-hardening-mysql-smoke.test.ts` (MySQL real, passo próprio no CI).

### 9.1 Contrato monetário (três entradas, um arredondamento)

| Entrada | Origem | Conversão |
|---|---|---|
| A — número NATIVO | célula NUMBER de XLSX (`rawTypedValues.{campo} = {type:"number", value:"1.234"}`) | `numericToCents` — decimal exato mais curto do double (`numberToDecimalString`) → centavos half-up. **Nunca** passa pelo parser pt-BR. |
| B — decimal canônico | correção humana/typed (`"1234.56"`) | `canonicalDecimalToCents` |
| C — texto localizado | CSV/PDF/DOCX/colar/célula TEXT | `parseBRLDetailed` (pt-BR); `"1,234"` ⇒ ambíguo (fail-closed) |

`resolveEffectiveMoney`/`resolveEffectiveQuantity` escolhem a origem: correção humana → número nativo → texto.
Exemplos provados: NUMBER `1.234` → 123 · `1.005` → 101 (half-up sobre o decimal exato, sem `toFixed`) ·
`100` → 10000 · TEXT `"1,234"` → rejeitado · `"1.234,56"` → 123456 · `"R$ 18,90"` → 1890. O texto exibido de
uma célula numérica é pt-BR **sem** separador de milhar (`1234,5`), para não reintroduzir ambiguidade. O
dobro arredondamento anterior (`toFixed(3)` + half-up) foi removido; `multiplyQuantityCents` usa a escala
exata da quantidade.

### 9.2 Versionamento de cotação

`quoteId` = identidade (id determinístico da linha em `price_research_items`); `contentHash`
(`quote-content/1`) = conteúdo (descrição, qtd, unidade, fornecedor, marca, modelo, preço em centavos, fonte). Mesma identidade + hash igual ⇒ replay (no-op); hash
diferente ⇒ versão nova (substitui). `quoteSetSignature` resume o conjunto. `price_research_items`
converge TODOS os campos de conteúdo no upsert (antes só alguns).

### 9.3 Convergência Pesquisa × Item Inteligente

Pesquisa + cotações + base do item numa ÚNICA transação (`persistResearchAndMaterialize`); enriquecimento
pós-commit. Por item:

| Estado do item | Conjunto de cotações | Resultado |
|---|---|---|
| novo | — | `created` (`pendente`) |
| `pendente`/`em_analise` | igual | `unchanged` |
| `pendente`/`em_analise` | diferente | `updated` (preço médio recalculado) |
| `aprovado`/`rejeitado` | igual | `preserved` |
| `aprovado`/`rejeitado` | diferente | `sourceChanged`: decisão e números INTOCADOS, `source_state = source_changed`, cotações novas em `pending_suppliers`; timeline registra |

`applyItemSourceUpdate` (operator) aplica as cotações pendentes: o item volta a `em_analise`
(`approved_by` limpo) — números novos exigem nova decisão. Nunca "Pesquisa = 300 × Item = 200" sem sinal.

### 9.4 Reconciliação legado → v2

Resolução de identidade: id v2 → `intelligent_item_identity_aliases` (append-only, UNIQUE por
org+processo+hash da chave) → item legado (id v1 = hash da descrição). Reconcilia SOMENTE com **exatamente
um** candidato compatível (mesma descrição normalizada, unidade e quantidade) — preserva id, status,
`approved_by`, CATMAT e lineage, grava alias `legacy`. Zero/múltiplos/incompatível ⇒ `review_required`
(fail-closed, sem fuzzy); `resolveItemIdentity` (operator) grava alias `manual` (vincular) ou `new_item`
e re-materializa a chave a partir das cotações já persistidas. O quadro autoritativo só lê itens
canônicos ⇒ nunca conta duas vezes.

### 9.5 Deduplicação concorrente

`import_promotions.sourceChecksum` + `UNIQUE(organizationId, procurementProcessId, importType,
sourceChecksum)`. A promoção RESERVA a linha no início da transação (antes de qualquer efeito); a
segunda sessão concorrente do mesmo arquivo bloqueia no índice e recebe `ER_DUP_ENTRY` após o commit da
primeira ⇒ replay (mesma sessão) ou `CONFLICT` (outra sessão). Provado com **duas conexões reais**.

### 9.6 Ledger da revisão documental (append-only)

`import_document_review_ledger`: `extracted`, `reviewed`, `approval_invalidated`, `approved`,
`rejected`, `promoted` — cada evento com `revision`, `contentHash`, `previousContentHash`, ator,
correlação e (opcional) conteúdo da revisão; `sequence` alocado sob `FOR UPDATE` da staging +
`UNIQUE(org, staging, sequence)`; gravado na MESMA transação da ação. `ingestion.documentReviewHistory`
reconstrói todas as versões. A lineage da promoção referencia a revisão aprovada:
`aprovado:rev<N>@<hash12>`.

### 9.7 Snapshot canônico da autoria (digest)

`authoring-context/2.0` / `edital-context/1.2`: o digest é `canonicalDigest` (JSON canônico, chaves
ordenadas) do snapshot que o prompt consome — processo (objeto, número), excerto do DFD/ETP (hash do
EXCERTO + cobertura + status + origem), itens aprovados com as cotações renderizadas (ordenadas por
conteúdo, sem `quoteId`), estado de fonte e nº de pendentes. Mudar fornecedor/preço/quantidade/nº do
processo/trecho consumido ⇒ digest muda; reordenar cotações ou trocar um rótulo que não entra no prompt
⇒ digest igual.

### 9.8 Contrato de idempotência (`ingestion.createSession`)

`createSessionPayloadHash` = sha256(`ingestion.createSession/v2`, org do CONTEXTO, processo, importType,
checksum, mime, tamanho, finalidade). Mesma chave + mesmo payload ⇒ replay (mesma sessão); mesma chave +
payload diferente ⇒ `IDEMPOTENCY_CONFLICT`.

### 9.9 Recuperação do enriquecimento

`pending → processing → done | failed` com `enrichment_attempts`, `enrichment_last_attempt_at`,
`enrichment_error_code`. Claim por CAS (só um worker processa). `recoverStaleEnrichment` no boot e no
replay da promoção retoma `pending` e `processing` parado > 10 min; limite de 3 tentativas ⇒ `failed`
(sem loop). Enriquecimento continua degradável e fora de transação.

### 9.10 Contagem de cotações, cobertura documental e emissão

- `quoteCount` = cotações **válidas** (preço > 0) — "Baseado em 2 cotações válidas".
- Documento acima do orçamento (`AUTHORING_DOC_BUDGET` 6000 / Edital 4000): `selectDocumentExcerpt`
  section-aware — todas as seções representadas, cobertura `full`/`partial` explícita no prompt e na
  lineage (`coverage:dfd=partial`). Nunca afirma consumo integral quando não houve.
- `issueProcess` **não emite documento**: exige `manager` e um Edital com emissão OFICIAL prévia
  (ledger `official_document_promotions`, fluxo com SoD); sem ela ⇒ `PRECONDITION_FAILED`. Só projeta a
  etapa `ISSUED` do processo.

## 10. MIGRATION 0304 (replay-safe, aditiva)

`drizzle/0304_p0_hardening.sql`: `CREATE TABLE IF NOT EXISTS` `import_document_review_ledger` e
`intelligent_item_identity_aliases`; colunas `import_staging_items.rawTypedValues`,
`import_promotions.sourceChecksum`, `intelligent_items.{source_state, source_state_reason,
source_changed_at, pending_suppliers, enrichment_attempts, enrichment_last_attempt_at,
enrichment_error_code}`; `UNIQUE uq_import_promotions_source`. Guardas por INFORMATION_SCHEMA
(procedures), sem DROP de dado, sem backfill, sem dedupe. Linhas legadas ficam com `sourceChecksum` NULL
(não colidem). Duplicata NÃO-NULL (só por escrita manual) ⇒ a criação do UNIQUE falha (**fail-closed**).
Provado no smoke: upgrade com dados legados, replay no-op, fail-closed; `drizzle-kit generate` sem diff.

## 11. LIMITATIONS (declaradas)

- **Sem OCR**: PDF digitalizado é recusado com orientação.
- `.doc` (Word 97-2003) não suportado — apenas DOCX.
- Projeção documental: títulos por heurística determinística (numeração/maiúsculas/estilos); layout
  complexo de PDF (colunas, cabeçalhos repetidos) pode exigir correção na revisão.
- Itens de um TR importado são **sugestão**; materializar exige passar pela Pesquisa de Preços (follow-up).
- Consolidação por chave lógica EXATA: itens parecidos mas não idênticos ficam separados (polimento humano);
  identidade ambígua é resolvida por humano (`resolveItemIdentity`), nunca por similaridade.
- `FF_CANONICAL_INGESTION` continua desligado em produção; ativação é decisão do owner (fora deste PR).
