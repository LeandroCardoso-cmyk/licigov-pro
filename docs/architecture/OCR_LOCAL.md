# ADR — OCR local governado para PDF digitalizado (Pesquisa de Preços)

**Status:** proposto (PR, sem merge/deploy) · **Escopo:** U2A-OCR · **Relacionados:** [IMPORT_ENGINE.md](IMPORT_ENGINE.md),
[INGESTION_RUNBOOK.md](../ops/INGESTION_RUNBOOK.md), [PRODUCT_NORTH_STAR.md](PRODUCT_NORTH_STAR.md)

## Contexto

O piloto recebe pesquisas de preços em **PDF digitalizado** (somente imagem). Antes desta mudança o parser
detectava o caso (`OCR_REQUIRED`), mas o worker levava a sessão a `awaiting_review` com **zero itens** — era
possível "aprovar" uma sessão vazia, e o mesmo checksum ficava preso nessa sessão (beco sem saída).

## Decisão

1. **Hardening (independe do OCR):** desfechos explícitos (`OCR_REQUIRED`, `OCR_PROCESSING`, `OCR_FAILED`,
   `PARSER_FAILED`, `NO_VALID_ITEMS`, `REVIEW_REQUIRED`, `READY_FOR_REVIEW`) e invariantes de domínio
   `validItemCount === 0 ⇒ aprovar PROIBIDO` / `⇒ promover PROIBIDO` (`server/domain/importOutcome.ts`).
   Sem migration: `status` (enum existente) + `stage` (varchar) + `errors[0].code`.
2. **OCR LOCAL** com Tesseract (WASM) atrás de uma **porta de domínio** `OcrPort` (`server/domain/ocr.ts`);
   o adapter concreto vive na infraestrutura (`server/providers/ocr/tesseractOcrAdapter.ts`). O domínio e o
   parser não conhecem Tesseract.
3. **Um único parser tabular:** OCR produz palavras com caixa delimitadora; `parsers/ocrLayout.ts` reconstrói
   linhas/colunas por **geometria determinística** e entrega matriz/linhas ao **mesmo**
   `matrixToRawItems`/`linesToRawItems` do texto nativo. Não há parser de OCR nem segunda materialização.
4. **Sem LLM** em nenhuma etapa: nada reconhece preço, inventa coluna, reconstrói quantidade, decide fornecedor
   ou corrige valor. Incerteza vira **aviso + confiança por campo**, e a revisão humana decide.

### Pipeline

```
upload → assinatura %PDF → checksum → texto nativo (getText/getTable)
      → heurística determinística de "texto útil" por página (nativeTextAssessment.ts, v1)
      → páginas sem texto útil (ou documento sem nenhuma linha de item) → render 1 página/vez (pdf-parse) → OcrPort
      → geometria → MESMO parser tabular → staging (itens BRUTOS + avisos + texto bruto da linha)
      → revisão humana → aprovação (≥1 item aceito) → promoção governada (manager+, transacional, idempotente)
```

Nunca: PDF → gravação direta no domínio.

### Heurística de texto útil (determinística, versionada)

Página útil ⇔ (≥ 30 caracteres alfanuméricos **e** ≥ 4 palavras de ≥ 2 alfanuméricos, após remover marcadores de
página) **ou** tabela estruturada exposta pelo PDF. Não é `text.length > 0` (carimbos/números de folha não contam).
Se o texto nativo não render nenhuma linha de item, o documento inteiro segue para OCR (`ocrReason =
native_text_without_items`). Mudar limiares ⇒ nova `NATIVE_TEXT_HEURISTIC_VERSION` (entra no fingerprint).

### Incerteza, dinheiro e replay

- Valores ficam **brutos** (`"1.234,56"`, `"R$ 1.234,56"`, `"12,5"`); o contrato monetário existente decide no
  staging/promoção e **recusa** o ambíguo. Token numérico com letra (ex.: `1.2O4,56`) ⇒ `OCR_AMBIGUOUS_VALUE`, nunca
  corrigido. Confiança < `OCR_MIN_CONFIDENCE` ⇒ `OCR_LOW_CONFIDENCE` no campo. Descrição continuada na linha seguinte
  ⇒ unida com `OCR_MULTILINE_MERGED`. Célula que cobre duas colunas ⇒ `MERGED_CELL`. Coluna 1,2,3… nunca é preço de
  fornecedor (mesmo com o cabeçalho "Item" mal lido).
- **Fingerprint** (`server/domain/extractionLineage.ts`): checksum + modo por página + heurística + motor/versão/núcleo
  + idioma + dados de idioma + configuração (PSM/OEM) + largura de render + versão do layout + versão do parser.
- **Não-determinismo registrado:** a saída do OCR pode variar entre CPUs/SIMD; a linhagem traz `nondeterministic: true`
  e `outputDigest` (sha256 do texto bruto) para comparar replays. A revisão humana continua obrigatória.
- **Linhagem** em `import_sessions.extractionSummary.extraction` (modo `native_text`/`ocr`/`mixed`, páginas, motor,
  duração, avisos, falha, fingerprint, correlationId, timestamps). Texto bruto por página em artefato derivado
  `{storageKey}.ocr-{fingerprint16}.json` no mesmo storage; o **original é imutável**.

### Retry, idempotência e checksum

- Falhas de desfecho são terminais **sem auto-retry** (determinísticas, ou OCR pesado): a nova tentativa é explícita
  (`enqueueProcessing`) e reutiliza a **mesma sessão** (dedup por checksum). A reextração substitui só itens intocados;
  item revisado/corrigido bloqueia (`STAGING_ALREADY_REVIEWED`). Sessões vazias legadas são encerradas com auditoria.
- A promoção segue deduplicada pelo ledger `import_promotions` (replay idempotente; mesmo arquivo em outra sessão ⇒
  `CONFLICT`). A reserva do ledger é revertida quando não há item válido (nada é materializado).

### Limites de recurso

| Limite | Default (env) | Teto |
|---|---|---|
| Páginas com OCR por arquivo | 20 (`OCR_MAX_PAGES`) | 100 |
| Tempo total (render + OCR) | 180 s (`OCR_TIMEOUT_MS`) | 900 s |
| Largura de renderização | 2000 px (`OCR_RENDER_WIDTH`) — uma página por vez | 3000 |
| Concorrência por processo | 1 (`OCR_MAX_CONCURRENCY`) + fila serial existente | 2 |
| Tamanho do arquivo | 50 MB (limite geral de ingestão) | — |
| Memória | worker Tesseract criado por arquivo e encerrado ao fim; medido ~+160 MB RSS por página A4 | — |

OCR roda no worker da fila existente, **fora** de transação de banco. `OCR_ENABLED=false` é o kill-switch
(desfecho `OCR_REQUIRED`). Na suíte de testes o OCR fica desligado por padrão; os testes injetam a porta.

## Dependências adicionadas

| Pacote | Versão (exata) | Licença | Motivo | Runtime | Impacto |
|---|---|---|---|---|---|
| `tesseract.js` | 7.0.0 | Apache-2.0 | Motor OCR (API Node, worker_threads) | sem `engines` declarado; verificado em Node 22 (projeto: `>=20 <23`) | +1,7 MB |
| ↳ `tesseract.js-core` (transitiva) | 7.0.0 | Apache-2.0 | Tesseract compilado para WASM (SIMD/LSTM) | WASM no Node | +44 MB |
| `@tesseract.js-data/por` | 1.0.0 | MIT (modelo Tesseract: Apache-2.0) | Modelo de **português** empacotado (sem download em runtime) | leitura local, gzip | +7,9 MB |

Transitivas novas: `bmp-js`, `idb-keyval`, `is-url`, `opencollective-postinstall`, `wasm-feature-detect`, `zlibjs`,
`regenerator-runtime` (já presente como opcional), `node-fetch` (já presente). Renderização da página reutiliza
`pdf-parse`/`@napi-rs/canvas`, **já** dependências de produção.

- **Build:** `esbuild --packages=external` — o bundle do servidor não incorpora o OCR (resolvido do `node_modules`
  em runtime); `vite build` do cliente inalterado. Sem Dockerfile/Nixpacks novo (Railpack instala as deps de produção).
- **Scripts de instalação:** o pnpm 10 ignora o postinstall do `tesseract.js` (só mensagem de patrocínio) — sem efeito.
- **Auditoria:** `pnpm audit --prod` antes/depois = mesmos números (10 low · 56 moderate · 40 high · 3 critical,
  todos pré-existentes); `pnpm audit:gate` OK (nenhuma high/critical nova). Nenhuma dependência não relacionada foi
  atualizada.
- **Filesystem:** `cacheMethod: "none"` — nada é gravado em disco (compatível com FS somente-leitura).
- **Rede:** nenhuma chamada externa; nenhuma credencial; nenhuma variável secreta.

### Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Leitura incorreta de dígitos/colunas | Valores brutos + avisos por campo + contrato monetário fail-closed + revisão item a item |
| Tabela sem cabeçalho reconhecível | Cai na heurística de linhas (a mesma do texto nativo), com `HEADER_INFERENCE`; itens fracos são rejeitáveis |
| Consumo de CPU/memória no Railway | Fila serial, 1 worker por arquivo encerrado ao fim, limites de páginas/tempo, kill-switch |
| Variação de saída entre máquinas | Registrada (`nondeterministic`, `outputDigest`); fingerprint fixa a configuração |
| Documento com layout complexo (várias tabelas, rotação) | Fora do escopo; resultado vai para revisão ou `NO_VALID_ITEMS` com orientação |

### Fallback

`OCR_ENABLED=false` (ou falha do motor) ⇒ `OCR_REQUIRED`/`OCR_FAILED` com mensagem e próximo passo: enviar o PDF
original com texto ou a planilha (XLSX/CSV). Nada é fingido como extraído.

## Alternativas consideradas (não contratadas)

| Opção | Por que não agora |
|---|---|
| Google Cloud Vision / AWS Textract / Azure Document Intelligence | Exigem conta, credencial e segredo novos, envio do documento a terceiro e custo por página — fora do autorizado; o adapter `OcrPort` permite plugar um provedor depois sem tocar no domínio |
| Binário `tesseract` do sistema (apt) | Exige alterar a imagem de build (Nixpacks/Dockerfile); o WASM roda com as deps do `pnpm install` |
| LLM multimodal | Proibido para reconhecer preço/estrutura (princípio de IA supervisionada; não determinístico) |

## Fora do escopo

DFD/ETP/TR digitalizados (modo documento continua `OCR_REQUIRED`), Edital/Parecer/Contratos, anexos de tarefas,
parsers legados (`parseItemsFile`), refatoração geral do Storage Service.
