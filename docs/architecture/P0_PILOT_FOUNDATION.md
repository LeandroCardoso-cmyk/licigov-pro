# P0 Piloto — Document Intake + Pesquisa de Preços → Itens Inteligentes → TR → Edital

> Princípio: **"O LiciGov entra no processo no ponto em que a Prefeitura já está."**
> A Secretaria pode ter o DFD, o ETP ou o TR prontos, ou só as cotações. O processo começa daí, sem
> pré-requisito artificial, e todas as entradas convergem para os MESMOS artefatos canônicos.

Constituição: [`PRODUCT_NORTH_STAR.md`](PRODUCT_NORTH_STAR.md) (IA supervisionada, Regra de Ouro, não-ERP).

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
- **Contrato monetário** (`domain/money.ts`): centavos inteiros, half-up (BigInt); `"R$ 1.234,56"`,
  `"18,90"`, `"1234.56"`; `"1,234"` = **ambíguo** (correção rejeitada `AMBIGUOUS_MONEY`; promoção fail-closed).
  Banco canônico = `DECIMAL(14,2)` em **reais**.
- **Promoção** (`manager`, uma transação): `price_research` + `price_research_items` (com fornecedor/marca/
  modelo/obs./fonte) **e** materialização em **Itens Inteligentes** (`itemMaterializationService`):
  - chave lógica determinística = descrição normalizada | unidade canônica | quantidade (milésimos) —
    **sem fuzzy**; id = `sha256(iitem:v2:org:processo:chave)`;
  - item novo → `pendente`; `pendente/em_analise` → cotações mescladas por `quoteId` (replay não duplica);
    `aprovado/rejeitado` → **preservado** (decisão humana nunca revertida);
  - mesmo arquivo (checksum) já promovido no processo ⇒ `CONFLICT`.
- **Enriquecimento pós-commit** (degradável, sem IA na transação): sugestão CATMAT (ranking), riscos,
  recomendações; `enrichment_status` `pending → done | failed`. **Sugestão ≠ decisão**: nunca sobrescreve
  item com decisão no ledger `catmat_decisions`.
- O caminho manual/colar (`importPriceResearch`) converge no mesmo modelo (antes: um item por linha e
  reset de status em reimportação).

## 4. AUTHORING CONTEXT (ETP / TR)

`services/authoring/authoringContext.ts` (`authoring-context/1.0`), tenant-scoped:

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
"Baseado em N cotação(ões) aprovada(s) em M item(ns)."
CATMAT/CATSER: código só quando CONFIRMADO; senão "a revisar (sugestão não confirmada)"
```

O prompt instrui a IA a NÃO redigir quantidades/preços/totais. O mesmo quadro é usado pelo **Edital**.

## 5. TR SOURCE DIGEST + SOURCE_CHANGED

`sourcesDigest` = sha256(versões dos contratos + org + processo + kind + objeto + hash do DFD + hash do ETP
(TR) + assinatura ordenada dos itens aprovados: id/descrição/qtd/unidade/centavos/nº cotações/código
confirmado). Gravado como `srcdigest:<16>` (+ `ctx:`, `base:dfd@`, `base:etp@`, `itens:`, `cotacoes:`).

`procurementProcess.authoringSourceState` (ETP/TR) — generaliza o SOURCE_CHANGED do Edital:
`never_generated` · `current` · `source_changed` · `imported` (rascunho importado, sem digest) + resumo
das fontes para a UI de pré-geração.

## 6. REPLAY

- `generatePayloadHash` inclui `sourcesDigest` → retry com as MESMAS fontes replaya (sem nova cognição);
  fonte alterada sob a MESMA chave ⇒ `CONFLICT` (nunca devolve documento gerado com contexto antigo).
- Promoção documental e de pesquisa: idempotentes (chave + ledger UNIQUE por sessão).
- Materialização: merge por `quoteId`; replay sem escrita.
- `EDITAL_CONTEXT_VERSION` → `1.1` (preço em reais, sem `/100`; classificação confirmada; quadro
  autoritativo): editais gerados com 1.0 aparecem como `source_changed` — correto, o contexto deles tinha
  o valor errado.

## 7. RBAC

| Ação | Papel mínimo |
|---|---|
| Ler intake/staging/itens/estado de fontes | viewer (tenant) |
| Criar sessão / upload / enfileirar / revisar / corrigir / aprovar sessão | **operator** |
| Revisar / aprovar / descartar / promover **documento a rascunho** | **operator** |
| Gerar DFD/ETP/TR/Edital, importar pesquisa (manual), aprovar/rejeitar item, decidir CATMAT, criar processo | **operator** |
| Promover **Pesquisa** ao domínio (+ Itens Inteligentes) | **manager** (inalterado) |
| Emissão oficial | **manager** + SoD (inalterado) |

`organizationId` vem SEMPRE do contexto autenticado. Outro tenant/processo ⇒ `NOT_FOUND` (não vaza existência).

## 8. MIGRATION 0303 (replay-safe, aditiva)

`drizzle/0303_p0_document_intake_price_items.sql`: `CREATE TABLE IF NOT EXISTS import_document_staging`;
colunas `rawSupplier/rawBrand/rawModel/rawNotes/rawSource` em `import_staging_items`;
`intelligent_items.enrichment_status` (default `done`); `generated_documents.content` → `LONGTEXT`
(widening, documentos importados > 64 KB). Guardas via INFORMATION_SCHEMA (procedures), sem DROP
destrutivo. Validada: clean install, upgrade, replay, `drizzle-kit generate` sem diff.

## 9. LIMITATIONS (declaradas)

- **Sem OCR**: PDF digitalizado é recusado com orientação.
- `.doc` (Word 97-2003) não suportado — apenas DOCX.
- Projeção documental: títulos por heurística determinística (numeração/maiúsculas/estilos); layout
  complexo de PDF (colunas, cabeçalhos repetidos) pode exigir correção na revisão.
- Itens de um TR importado são **sugestão**; materializar exige passar pela Pesquisa de Preços (follow-up).
- Consolidação por chave lógica EXATA: itens parecidos mas não idênticos ficam separados (polimento humano).
- `FF_CANONICAL_INGESTION` continua desligado em produção; ativação é decisão do owner (fora deste PR).
