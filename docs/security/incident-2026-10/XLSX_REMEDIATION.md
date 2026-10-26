# Remediação do `xlsx` (SheetJS 0.18.5) — SEC-AUD-07

**Revisão 2 — 26/10/2026.** Advisories: GHSA-4r6h-8v6p-xvw6 (prototype pollution na leitura) e
GHSA-5pgg-2g8v-p4x9 (ReDoS), high; o npm não publica versão corrigida. **Decisão do Owner:** suspender
temporariamente o `.xls`, com orientação de conversão para `.xlsx`.

## Estado

| Item | Antes | Agora |
|---|---|---|
| Leitura XLSX | SheetJS 0.18.5 no processo da aplicação | `exceljs` 4.4.0 em **processo filho isolado** (`xlsxReadIsolated.ts`), com limites reais |
| Leitura XLS (BIFF/OLE) | SheetJS 0.18.5 | **Suspensa**: `UNSUPPORTED_FORMAT` com a orientação abaixo — inclusive XLS renomeado para `.xlsx` (detecção pelo conteúdo) e arquivo declarado `.xls` por extensão ou MIME |
| Exportação XLSX | SheetJS → `exceljs` (PR anterior) | `exceljs`; texto iniciado por `=` continua texto (sem `<f>`) |
| Dependência `xlsx` | `package.json` + lockfile | **Removida** (sem import estático/dinâmico, sem fallback; teste de varredura garante) |
| Baseline do `audit:gate` | 14 (incluía as 2 GHSA do `xlsx`) | **12** (só reduz) |

Mensagem única (`shared/spreadsheetFormats.ts`), usada no erro do parser, na recusa de `ingestion.createSession`, na
capacidade (`unavailableMessage`) e na validação do cliente antes do envio:

> O formato .xls está temporariamente indisponível. Abra o arquivo no Excel ou LibreOffice, salve como .xlsx e envie novamente.

## Caminhos verificados

| Superfície | Tratamento |
|---|---|
| `ingestion.getCapabilities` | `.xls` listado como `supported:false`, `capabilityStatus:"disabled"`, com `unavailableMessage` |
| `FileDropzone` (ingestão canônica — Pesquisa de Preços, Document Intake) | `accept` só com formatos suportados (sem `.xls`); aviso com a orientação; `.xls` arrastado recebe a mensagem antes do upload |
| `ingestion.createSession` | Recusa `.xls` declarado (`UNSUPPORTED_MEDIA_TYPE` + mensagem); nenhuma sessão nova nasce para falhar |
| `XlsxParser` (worker da fila) | Conteúdo OLE/CFB ou declaração `.xls` ⇒ `UNSUPPORTED_FORMAT`; outro conteúdo não-ZIP ⇒ `CORRUPT_FILE`; ambos **determinísticos** (sem retry automático). Leitor indisponível (infra) ⇒ `PARSE_ERROR` (retry/backoff existente) |
| Texto de ajuda da Pesquisa de Preços | "XLSX ou CSV" |
| Modais legados de itens (`ImportItemsModal`, `TRItemsModal`, `UploadStep`) | **Sem alteração**: inalcançáveis (`ProcessDetails` fora de rota) e o endpoint `processes.parseItemsFile` está desativado (FORBIDDEN, LEG-005) — nenhum arquivo chega a parser por eles |
| CSV, PDF, DOCX | Sem alteração |

Sessões antigas: nada é reprocessado; o tipo `xls` continua reconhecido em `importTypes`/promoção para sessões já
gravadas; `PARSER_VERSION` 1.3.0 → **1.4.0** e `rawMetadata.engine = "exceljs"` registram o leitor nas sessões
novas. Uma reextração manual de sessão `.xls` antiga termina em `UNSUPPORTED_FORMAT` (determinístico). Revisão e
promoção continuam com aprovação humana.

## Limites (o que de fato contém consumo excessivo)

`readXlsxMatrices` chamava `wb.xlsx.load` (JSZip descomprime **tudo** em memória, sem teto) antes de qualquer
checagem de célula/aba, e `assertZipWithinLimits` usava só tamanhos **declarados**. Agora, em camadas:

1. **Diretório declarado** (barato, sem descomprimir): ≤ 2.000 entradas, ≤ 250 MB, taxa ≤ 200:1, sem ZIP64.
2. **Descompressão real** (`scanZipRealContent`, stream, conteúdo descartado), **antes** do leitor: aborta ao
   passar de 250 MB reais somando as entradas; conta abas (≤ 100) e células reais `<c>` (≤ 1.000.000 na pasta,
   ~340 B de heap cada no `exceljs`, medido).
3. **Matriz**: intervalo por aba ≤ 2 M células e soma entre abas ≤ 4 M, antes de alocar.
4. **Processo filho** com `--max-old-space-size=768`, tempo máximo de 60 s (SIGKILL), ambiente mínimo (sem
   `DATABASE_URL`, chaves, sessão ou `NODE_OPTIONS`) e um filho por vez por processo. Um `worker_thread` foi
   descartado: `--max-old-space-size` global/`NODE_OPTIONS` anula o `resourceLimits` dele (verificado em Node 22).
   `Promise.race` com timeout não serviria: não cancela parser síncrono nem limita memória.

Falha de limite ⇒ `SIZE_EXCEEDED` (ou `CORRUPT_FILE` para ZIP inválido), determinístico.

Ensaio adversarial (`xlsx-adversarial-isolated.test.ts`, executado em processo filho com `NODE_OPTIONS` pedindo
4 GB de heap de propósito, nunca no processo da aplicação):

| Entrada | Resultado |
|---|---|
| Diretório declara 100 bytes, conteúdo real 300 MB (limites de produção) | checagem declarada passa; descompressão real ⇒ `ZIP_TOO_LARGE` (~1,2 s) |
| 300 entradas de 1 MB declarando 10 bytes cada | `ZIP_TOO_LARGE` |
| 150 worksheets | `TOO_MANY_SHEETS` antes do leitor |
| Intervalo A1:XFD1048576 | `TOO_MANY_CELLS` sem alocar a matriz |
| 5 abas de 1 M células de intervalo | `TOO_MANY_CELLS` (orçamento agregado) |
| Células reais acima do limite | `TOO_MANY_CELLS` antes do leitor |
| Leitura acima do tempo | `READ_TIMEOUT` em ~300 ms, filho morto |
| Heap do filho esgotado durante a leitura (teto de 24 MB no teste) | `READ_MEMORY`; o processo chamador segue vivo |
| Tenant A hostil + tenant B legítimo simultâneos | A ⇒ `READ_TIMEOUT`; B lido corretamente (espera o filho de A, FIFO) |
| Planilha legítima de 200 mil células | lida (~1,5 s) |

Em todos os casos o maior atraso do event loop do processo chamador ficou abaixo de 15 ms.

Correção após a CI (run 810): o estouro de heap era reconhecido só pelo texto do stderr, e a janela guardava o
fim — o V8 escreve "heap out of memory" antes do rastro nativo, que na CI era longo, e o caso virou "leitor
indisponível". Agora conta o término (`SIGABRT`/134) e o início + fim do stderr. Junto: o filho usava
`once("error")`; um segundo evento (ex.: `ERR_IPC_CHANNEL_CLOSED` quando o filho morre no envio) ficaria sem
ouvinte e derrubaria o processo da aplicação — passou a `on("error")` + callback no `send`. Custo: ~0,3–0,4 s por
leitura para subir o filho em dev/teste (tsx); em produção o filho é JS empacotado.

## Compatibilidade (goldens no lugar do diferencial)

O diferencial dependia do SheetJS. A saída dele foi **congelada** uma vez (`server/__tests__/fixtures/spreadsheets/`,
dados fictícios) e o leitor atual é comparado contra esses goldens: corpus escrito pelo `exceljs` (cotações, moeda e
decimais, vazios e intervalo fora de A1, células só formatadas, datas e formatos, fórmulas com/sem cache e erros,
strings iniciadas por `=`/`+`/`@`/`-`, mescladas, rich text, hyperlink, booleanos, várias abas inclusive oculta e
vazia, números extremos e unicode) e dois arquivos escritos pelo próprio SheetJS (tipos mistos; strings inline).

**Fuso:** a mesma sonda roda em processo filho com `TZ=UTC` e `TZ=America/Sao_Paulo` (offset 180 conferido) e as
duas saídas — matrizes e itens extraídos (datas `2026-10-25`, `2026-01-01`; `1,234`/`1.234`, `23,9`) — são
iguais entre si e ao golden. Nenhum teste é pulado por fuso.

**Limitação:** o corpus é sintético; recomenda-se repetir a comparação com 3–5 planilhas reais anonimizadas em
staging antes de promover.
