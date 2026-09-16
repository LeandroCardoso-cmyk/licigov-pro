# DATA-039 — Atomicidade transacional das operações compostas do fluxo canônico

> Bloco D (produção e resiliência). Torna ATÔMICAS as escritas compostas críticas do pipeline
> canônico de licitação, com replay-safety estrutural, isolamento multi-tenant e fail-closed.
> **Escopo:** criação de Processo + evento inicial; importação de Pesquisa de Preços (cabeçalho +
> itens). **Não** cobre aditivo/apostilamento/ocorrência (ver follow-up abaixo).

## Problema

O pipeline canônico executava escritas compostas em passos sequenciais **não atômicos**:
- `createProcess`: `insertProcess` → `recordProcessEvent` (evento de criação) — uma falha entre os dois
  deixava um processo **sem** seu evento de criação (ou um evento órfão).
- `importPriceResearch`: `insertResearch` → laço de `insertResearchItem` — uma falha no meio deixava
  uma pesquisa com **itens faltando** (estado corrompido).
Além disso, retries (clique duplo / retry de rede) podiam **duplicar** estado, e o caminho degradado
sem banco (`if (!db) return`) podia **fingir sucesso** sem persistir.

## Invariantes

1. **Atomicidade:** processo+evento e pesquisa+itens são tudo-ou-nada.
2. **Replay-safety determinística:** ids determinísticos e namespaced por tenant; retry (sequencial e
   **concorrente**) converge para exatamente-um via PRIMARY KEY + `onDuplicateKeyUpdate`.
3. **Isolamento multi-tenant:** `organizationId` participa de todo id e de toda query.
4. **Fail-closed:** operação autoritativa sem banco **lança** (nunca sucesso fantasma).
5. **Auditabilidade/lineage:** o evento persiste actor + correlationId + timestamp.

## Transaction boundaries (curtas)

- `createProcessWithInitialEvent(p, event)` → `db.transaction`: `insertProcess(tx)` +
  `recordProcessEvent(tx, idempotencyKey:"initial")`.
- `insertResearchWithItems(r, items)` → `db.transaction`: `insertResearch(tx)` +
  `insertResearchItem(tx)` para cada item.
- Funções de baixo nível são **executor-aware** (aceitam o handle `tx`) — padrão `ProcurementExecutor`.
- **Nada de I/O externo dentro da transação** (ver "Operações derivadas").

## Replay semantics

- **Processo:** `id = sha256("plp:" + org + ":" + processNumber)` — estável por (tenant, número).
- **Evento inicial:** `recordProcessEvent` aceita `idempotencyKey`; com `"initial"`, o id do evento é
  `sha256("ptl-key:" + org + ":" + processId + ":" + eventType + ":initial")` — **independente da
  ordem**. Sem a chave, mantém-se o id por ordem (append-only) dos demais eventos (contrato inalterado).
- **Pesquisa:** `id = sha256("prw:" + org + ":" + processId + ":" + source)`.
- **Item:** `id = sha256("pri:" + org + ":" + researchId + ":" + index + ":" + descrição)`.
- Retry idêntico → mesmos ids → `onDuplicateKeyUpdate` → sem duplicação.

## Concurrency semantics (garantia ESTRUTURAL, sem TOCTOU)

A idempotência do evento inicial **não** usa check-then-insert. Como o id é determinístico e
independente de ordem, N requisições concorrentes do mesmo processo colidem no **mesmo id**; a
**PRIMARY KEY + `onDuplicateKeyUpdate`** garante exatamente-um — a garantia é do banco, não da
aplicação. Não há janela `SELECT(none)→INSERT / SELECT(none)→INSERT`. Sem lock global, sem Redis, sem
idempotência em memória. Provado por smoke MySQL com 8 execuções concorrentes → 1 processo + 1 evento.

## Tenant isolation

Todo id inclui `organizationId`; toda leitura/dedup/rollback filtra por `organizationId`. Dois tenants
com o mesmo número de processo geram ids distintos → sem colisão, sem confused-deputy, sem
visibilidade cruzada. Coberto por teste cross-tenant (dois tenants no mesmo banco).

## Failure handling (fail-closed + sanitizado)

- Banco indisponível em operação autoritativa → **lança** erro genérico (sem infra/secret). Precedente:
  `documentVersionService` (escritas DATA-012). O router traduz para mensagem institucional pt-BR e
  **loga o técnico com correlationId** (`serviceLogger`), sem vazar detalhe.
- `importPriceResearch` sanitiza **apenas** a persistência autoritativa (try/catch dirigido) — **não**
  mascara falhas de enriquecimento derivado.
- Rollback real (transação que lança não deixa estado parcial) provado em MySQL, não em mock.

## Operações derivadas (fora da transação)

Enriquecimento (Itens Inteligentes via CATMAT/IA) e o evento de timeline da importação são
**derivados/re-executáveis** e ficam **fora** da transação — para nunca manter transação SQL aberta
durante I/O externo (IA/rede). São idempotentes por id e reconstruíveis; sua falha **não** compromete
o núcleo autoritativo já commitado, e **não** é convertida em sucesso silencioso.

## Observabilidade

Reusa a infraestrutura existente (`serviceLogger`/`structuredLog` + `process_timeline` persistido).
Rastreável: quem (actor), tenant (organizationId), processo/pesquisa (ids), correlationId, resultado,
timestamp, e erro **sanitizado** quando falha. **Não** loga secrets, documentos completos, conteúdo
jurídico ou payloads excessivos.

## Testes

- `data039-atomicity-mysql-smoke.test.ts` (MySQL real): commit atômico; retry sequencial e
  **concorrente**; cross-tenant; retry de pesquisa; **rollback** (processo+evento e pesquisa+itens).
- `data039-fail-closed.test.ts` (unit, `getDb` mockado): operações autoritativas lançam sem banco;
  mensagem não vaza infra/secret.
- `procurement-create-process.test.ts` (router): wiring do helper atômico; auth; idempotência;
  mensagem amigável sanitizada em falha.

## Limitações / Accepted tradeoffs

- **`registerOccurrence` e a família aditivo/apostilamento NÃO são atômicos** (interleave de geração
  pesada + sequência por contagem) — defeito real documentado em
  `docs/ops/DATA_039_ADDENDUM_ATOMICITY_FOLLOWUP.md` (redesign; fora deste escopo).
- Sem banco em **dev**, a criação passa a **falhar** (fail-closed) em vez de degradar — tradeoff
  aceito: prod sempre tem `DATABASE_URL` (boot valida); dev sem DB não pode criar de qualquer forma.
- `recordProcessEvent` sem `idempotencyKey` mantém id por ordem (append-only) — não idempotente entre
  retries por design, correto para eventos de fluxo (múltiplos "change" legítimos).

## Integração futura (F-EMB1)

DATA-039/G8 é disjunto do F-EMB1 (embeddings/RAG). Nenhuma migration criada; nenhuma mudança em
`schema.ts`/`package.json`/`_journal.json`. Ver `docs/handoffs/CDEFX_FEMB1_INTEGRATION_RISK.md` para a
estratégia de integração (cherry-pick aditivo + união do CI; sem merge nesta janela).
