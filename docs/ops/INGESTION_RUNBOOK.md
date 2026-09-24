# Runbook — Ingestão Canônica (PR B.2.1)

Troubleshooting da superfície `ingestion.*` e da rota de byte-upload. Somente operação — não
altera produção/secrets. Arquitetura em [`../architecture/IMPORT_ENGINE.md`](../architecture/IMPORT_ENGINE.md).

## Habilitar/desabilitar por tenant

A superfície é **fail-closed** pela flag `FF_CANONICAL_INGESTION`.

- Avaliação: `featureFlagService.isFeatureEnabled(flagName, organizationId)` — override do tenant em
  `tenant_feature_flags` → flag global → default **desligado**.
- **Habilitar/desabilitar para um tenant (qualquer ambiente, inclusive produção):** somente pela
  superfície institucional `featureFlagAdmin` (admin de plataforma), por organização:
  1. `featureFlagAdmin.getTenantFlag { organizationId, flagName: "FF_CANONICAL_INGESTION" }` — conferir
     `origin`/`effectiveValue`/`writeAllowed` antes.
  2. `featureFlagAdmin.setTenantFlag { organizationId, flagName: "FF_CANONICAL_INGESTION", enabled: true,
     reason: "<justificativa ≥ 15 caracteres em produção>", idempotencyKey: "<uuid novo>" }`.
  3. Conferir de novo com `getTenantFlag` → `origin: "tenant"`, `effectiveValue: true`.
  4. Reversão: o mesmo `setTenantFlag` com `enabled: false` (nova `idempotencyKey`).
  Cada alteração grava override + auditoria (`activity_logs`, com antes/depois, ator, reason,
  correlationId, requestId, idempotencyKey) na MESMA transação.
- `FF_CANONICAL_INGESTION` é a única flag em `PRODUCTION_GOVERNABLE_TENANT_FLAGS`: governável em produção,
  sempre por tenant (nunca global). Demais flags continuam bloqueadas em produção (`FORBIDDEN`).
- **Nunca** SQL manual (INSERT/UPDATE em `tenant_feature_flags` ou `feature_flags`) — perde a auditoria
  atômica, a idempotência e a invalidação de cache.
- Kill-switch global: uma flag global desligada mantém todos os tenants bloqueados.
- Verificação rápida: `getSessionStatus` retorna `FORBIDDEN` → flag desligada para o tenant.

## Sintomas → causa provável → ação

| Sintoma (HTTP/tRPC) | Causa provável | Ação |
|---|---|---|
| `FORBIDDEN` "não habilitada" | Flag `FF_CANONICAL_INGESTION` desligada p/ o tenant | Ligar a flag do tenant via `featureFlagAdmin.setTenantFlag` (acima) |
| `401` no upload | Cookie JWT ausente/expirado | Reautenticar; conferir `sdk.authenticateRequest` |
| `403` no upload | Usuário sem membership ativo na org | Conferir `organization_members.ativo` |
| `415` "não suportado" | MIME fora de `ALLOWED_MIME_TYPES` | Enviar XLSX/CSV/PDF/DOCX válido |
| `400` "não corresponde ao tipo declarado" | *Magic bytes* ≠ MIME declarado (ex.: PDF renomeado p/ .xlsx) | Enviar o arquivo correto |
| `400` "checksum divergente" | Bytes enviados ≠ checksum declarado no `createSession` | Recalcular sha256 e reenviar |
| `413` "excede 50MB" | Arquivo acima do teto | Dividir/reduzir o arquivo |
| `409` no upload | Sessão não está mais em `uploaded` (ou re-upload com checksum diferente) | Criar nova sessão |
| `412` "arquivo ainda não enviado" (enqueue) | `enqueueProcessing` antes do upload concluir | Fazer o upload antes de enfileirar |
| `409` "estado terminal" (enqueue) | Sessão já aprovada/arquivada/rejeitada | Criar nova sessão |
| `412` "revisão incompleta" (approve) | Há itens de staging `pending` | Revisar todos os itens antes de aprovar |
| `412` `NO_VALID_ITEMS_TO_APPROVE` (approve) | Sessão sem itens, ou todos rejeitados/pulados | Aceitar ao menos um item, ou descartar e reenviar outro arquivo |
| `412` `NO_VALID_ITEMS_TO_PROMOTE` (promote) | Nenhum item aprovado com descrição | Idem — a transação é revertida, nada é materializado |
| `CONFLICT` "outro arquivo" (createSession) | `idempotencyKey` reusada com checksum diferente | Usar nova chave idempotente |

## Dedup e idempotência

- **Dedup por checksum:** `createSession` reutiliza a sessão **ativa** (não `rejected`/`archived`)
  do tenant com o mesmo `checksum` → retorna `{ duplicate: true }` sem criar nova linha.
- **Idempotência de `createSession`:** por `idempotencyKey` (+ payloadHash = checksum). Replay com
  a mesma chave e mesmo arquivo retorna a resposta cacheada; com arquivo diferente → `CONFLICT`.
- **Replay do processamento:** `enqueueProcessing` é seguro para reexecutar; não duplica jobs em voo.
- **Checksum nunca fica bloqueado (U2A):** uma sessão `failed` (OCR_REQUIRED/OCR_FAILED/PARSER_FAILED/
  NO_VALID_ITEMS) é **reutilizada** pelo dedup — reenviar o mesmo arquivo ou "Tentar novamente" reprocessa a
  MESMA sessão. A reextração **substitui só itens intocados** (pendentes, sem correção); havendo item
  revisado/corrigido ela é bloqueada (`STAGING_ALREADY_REVIEWED`). Sessões "beco sem saída" legadas
  (`awaiting_review` vazia → `rejected`; `approved` sem item aceito e não promovida → `archived`) são
  encerradas de forma auditada (`import_session_empty_retired`) e uma nova é criada. A promoção continua
  deduplicada pelo ledger (`import_promotions`) — nenhuma cotação duplicada.

## Fila (in-memory) e recuperação

- `importQueueService`: retry com backoff (até `MAX_RETRIES=3`), depois **DLQ**.
- O **job não carrega o arquivo** — só `storageKey`+metadados; o worker baixa do S3 no parse.
- Reinício do processo **esvazia** a fila in-memory, mas `recoverStuckImportSessions` roda no boot
  e reidrata sessões presas (`queued`/`parsing`) com **claim atômico** (sem execução duplicada),
  limite de tentativas, DLQ e correlationId preservado. É **fail-closed por tenant** (só reprocessa
  orgs com `FF_CANONICAL_INGESTION` ligada) — em produção com a flag desligada, é no-op.
- Os bytes são relidos do S3 durável — nada se perde no storage.
- Sem GEMINI/LLM no caminho (extração é 100% local/AST-based; o OCR também é local — ver abaixo).

## Desfechos da extração (Pesquisa de Preços / itens) — U2A

O `status` persistido é o enum existente; o desfecho fica **explícito** em `stage` + `errors[0].code`
(sem migration). **Nunca** há `awaiting_review` com zero itens.

| Desfecho | status / stage | Aprovável / promovível | Próximo passo |
|---|---|---|---|
| `OCR_PROCESSING` | `parsing` / `ocr_processing` | — | aguardar (PDF digitalizado em reconhecimento) |
| `OCR_REQUIRED` | `failed` / `ocr_required` | não / não | OCR desligado: enviar PDF com texto ou planilha |
| `OCR_FAILED` | `failed` / `ocr_failed` | não / não | "Tentar novamente" (mesma sessão) ou outro arquivo |
| `PARSER_FAILED` | `failed` / `parser_failed` | não / não | arquivo corrompido/protegido: enviar arquivo válido (sem auto-retry se determinístico) |
| `NO_VALID_ITEMS` | `failed` / `no_items` | não / não | enviar arquivo com a tabela de itens |
| `REVIEW_REQUIRED` | `awaiting_review` / `review_required` | após revisão (≥1 aceito) | conferir itens lidos por OCR/avisos |
| `READY_FOR_REVIEW` | `awaiting_review` / `awaiting_review` | após revisão (≥1 aceito) | revisar |

## OCR local de PDF digitalizado (U2A-OCR)

- **Onde:** só no modo de LINHAS (Pesquisa de Preços/itens). DFD/ETP/TR (modo documento) **não** usam OCR.
- **Pipeline:** upload → assinatura `%PDF` → checksum → texto nativo; páginas sem **texto útil** (heurística
  determinística `nativeTextAssessment.ts`: ≥30 alfanuméricos e ≥4 palavras, ou tabela estruturada) seguem
  para OCR → texto normalizado → **o MESMO parser tabular** → staging → revisão → aprovação → promoção.
- **Motor:** `tesseract.js` 7 (WASM) + `@tesseract.js-data/por` (português, lido do `node_modules`,
  sem download, sem gravação em disco). Sem serviço externo, sem credencial, sem segredo.
- **Onde roda:** no worker da fila existente, fora de qualquer transação de banco.
- **Limites (env, sem segredo):** `OCR_MAX_PAGES` (20), `OCR_TIMEOUT_MS` (180000, render + OCR),
  `OCR_RENDER_WIDTH` (2000 px, uma página por vez), `OCR_MIN_CONFIDENCE` (75), `OCR_MAX_CONCURRENCY` (1).
  Tamanho: 50 MB (limite geral). **Kill-switch:** `OCR_ENABLED=false` ⇒ desfecho `OCR_REQUIRED`.
- **Incerteza nunca vira dado:** valores ficam BRUTOS; confiança por campo; avisos `OCR_EXTRACTED`,
  `OCR_LOW_CONFIDENCE`, `OCR_AMBIGUOUS_VALUE` (ex.: "1.2O4,56" — não é corrigido), `OCR_MULTILINE_MERGED`,
  `MERGED_CELL`; o contrato monetário recusa valor ambíguo na promoção.
- **Linhagem:** `extractionSummary.extraction` (modo `native_text`/`ocr`/`mixed` por página, motor, versões,
  idioma, configuração, páginas, duração, avisos, `fingerprint`, `outputDigest`, correlationId, timestamps).
  Texto bruto do OCR por página em artefato derivado `{storageKey}.ocr-{fingerprint16}.json` (o original é
  imutável); cada item guarda o texto bruto da sua linha (`rawMetadata.ocr.lineText`).
- **Log estruturado** `import_extraction_outcome`: correlationId, organizationId, processId, sessionId, checksum,
  extractionMode, motor/versão, páginas, duração, nº de avisos, estado final — **sem** conteúdo do documento.
- **Memória:** o worker Tesseract (~100–200 MB durante o reconhecimento) é criado por arquivo e encerrado
  ao fim; a fila é serial por processo.

## PDF digital layout-aware e reprocessamento seguro (Layout v2)

- **PDF digital (com texto)**: extraído pela reconstrução geométrica (`extraction.layout.mode = positioned`,
  `layoutVersion = 3`); OCR **não** roda. `extraction.layout.validation` mostra cotações válidas e a conferência
  média/total (`totalMatches`). Páginas sem tabela aparecem em `pagesWithoutItemTable` e não geram itens.
- **Log** `import_layout_reconstructed` (contagens de páginas/tokens/linhas/colunas/itens, versão, duração, avisos) —
  sem conteúdo do documento. Útil para comparar `candidateItemCount` × `validItemCount`.

| Sintoma | Causa provável | Ação |
|---|---|---|
| Itens como "R$", título ou cabeçalho numa sessão antiga | Extração anterior ao Layout v2 (parser ≤ 2.2.0) | Se **nenhum** item foi revisado: "Reprocessar extração" (mesma sessão). Senão: rejeitar os itens indevidos |
| `DOCUMENT_AVERAGE_MISMATCH` / `TOTAL_RECONCILIATION_MISMATCH` | Média/total impressos ≠ cálculo das cotações válidas | Conferir cotações com o original; o sistema **não** ajusta valores |
| `SOURCE_IDENTITY_UNRESOLVED` | Rótulo da coluna de fonte ilegível (ex.: OCR) | Informar a fonte na revisão (valor foi preservado) |
| `LAYOUT_HEADER_INFERRED` / `LAYOUT_VALUES_NOT_EXTRACTED` | Cabeçalho ilegível / coluna com leitura inconsistente | Conferir colunas com o original; preferir o PDF com texto ou a planilha |
| `LAYOUT_STACKED_CELLS` (info) | Colunas com campos empilhados (unidade/qtde., média/total, anexo/lote/item) separadas | Esperado; conferir unidade/quantidade na revisão |
| `LAYOUT_STACKED_CELL_INCOMPLETE` | Célula empilhada com nível faltando em algum item | Conferir unidade/quantidade e média/total do item com o original |
| `LAYOUT_COLUMNS_UNRESOLVED` (info) | Texto com espaços sem colunas alinhadas | Esperado: extração pelas linhas de texto (comportamento anterior) |

**Reprocessar extração (`ingestion.reprocessExtraction`)** — operator+, escopado por tenant + processo, motivo
obrigatório (≥ 10 caracteres). Permitido SOMENTE com a sessão em `awaiting_review`, todos os itens pendentes, sem
correção humana e sem promoção. Retornos:

| Retorno | Significado | Ação |
|---|---|---|
| `PRECONDITION_FAILED REPROCESS_FORBIDDEN` | Há decisão humana (aceito/rejeitado/pulado/corrigido) ou promoção | Não reprocessar; revisar item a item |
| `CONFLICT REPROCESS_FORBIDDEN` | Reprocessamento já em andamento (reserva de 15 min) ou processamento em voo | Aguardar; a UI mostra "Reprocessando a extração" |
| `NOT_FOUND` | Sessão de outro tenant/processo | — |

- Durante o reprocessamento a sessão fica `awaiting_review` com `stage = reprocessing` e o staging antigo intacto.
  Se alguém revisar um item nesse intervalo, a troca é **recusada** (a decisão humana vence) e nada muda.
- A troca é **atômica** (uma transação); nova extração sem item revisável **nunca** substitui a anterior.
- Auditoria em `activity_logs`: `import_reextraction_requested` → `import_reextracted` ou
  `import_reextraction_not_applied` (com código). Histórico em `extractionSummary.reextractions[]`.
- **Nunca** apagar/alterar staging por SQL para "reprocessar": use a ação governada (auditoria e atomicidade).
- Reserva órfã (processo reiniciado no meio): expira em 15 min e um novo pedido pode retomá-la.

## Revisão por item lógico (Pesquisa de Preços)

A tela de revisão mostra **itens** (ex.: 5) com as **cotações** subordinadas (ex.: 30). O staging continua uma linha
por cotação; os contadores são separados ("Itens" × "Cotações"). Ver `docs/architecture/IMPORT_ENGINE.md`.

| Sintoma | Causa provável | Ação |
|---|---|---|
| "Aceitar item" → `CONFLICT` ("O item mudou desde a última leitura") | Outro revisor, correção ou reextração alterou o item após a leitura | Atualizar a revisão e decidir de novo (nada foi aplicado) |
| "Decisão em lote indisponível para este item" (`ITEM_IDENTITY_COLLISION` / `ITEM_IDENTITY_SPLIT`) | Linhas distintas do documento com a mesma descrição/unidade/quantidade, ou correção que separou cotações de uma linha | Decidir as cotações individualmente (expandir o item); conferir com o original |
| "⚠ Divergência na média" (`GROUP_AVERAGE_MISMATCH`) | Média impressa ≠ média calculada das cotações | Conferir cotações com o original; o sistema não ajusta valores |
| "Preço médio (após revisão)" diferente da média do documento | Há cotação rejeitada/pulada no item | Esperado: a média do documento e a calculada seguem visíveis como evidência |
| "Registros sem item identificado" | Linha extraída sem descrição | Revisar individualmente (em geral, rejeitar) |
| `PRECONDITION_FAILED` na decisão por item | Sessão não está aguardando revisão (aprovada/promovida) | — |

- A decisão por item afeta **somente cotações pendentes** do item; decisões individuais anteriores são preservadas.
- Auditoria: `activity_logs.action = import_item_group_reviewed` com cada cotação afetada (antes/depois), itens,
  motivo e correlationId. Log estruturado `price_research_review_grouped` (contagens e duração, sem conteúdo).
- **Nunca** aprovar cotações por SQL: use a revisão (atomicidade + auditoria).

## Upload (multipart streaming)

- `POST /api/ingestion/upload/:sessionId` — `multipart/form-data` (campo de arquivo único).
- Auth/tenant/flag são resolvidos ANTES de consumir o corpo; o limite (50 MB) é aplicado durante
  o stream e aborta imediatamente ao exceder (413).
- Falha no meio do upload (limite, interrupção do cliente, storage) → o objeto parcial é removido
  automaticamente (cleanup em `finally`).
- Toolchain de streaming: `busboy` (parser) + `@aws-sdk/lib-storage` (upload multipart ao S3).

## Schema canônico e migration 0288 (reconciliadora)

Os campos canônicos de `import_sessions` — `checksum` `varchar(64)` NULL, `processId` `int` NULL
(compatível com `processes.id`), `importPurpose` `varchar(50)` NULL — e o índice tenant-aware
**não exclusivo** `import_sessions_org_checksum_idx (organizationId, checksum)` são criados pela
migration **formal** `drizzle/0288`, não pelo `ensureSchema`.

**Contexto operacional:** um estado intermediário anterior (commit `91bd893`) criava essas colunas
via `ensureSchema`/`addColumnIfMissing`. Em um banco que já passou por esse estado (ex.: staging), a
versão antiga da 0288 (`ALTER ... ADD checksum`) colidia com a coluna existente
(`ER_DUP_FIELDNAME` / `42S21`), derrubando o boot no `runMigrations()`.

**A 0288 é RECONCILIADORA** (consulta `INFORMATION_SCHEMA` + SQL dinâmico `PREPARE/EXECUTE`), segura
para os três estados, sem intervenção manual no banco:

| Estado do banco | Comportamento da 0288 |
|---|---|
| Novo (sem os campos) | adiciona as 3 colunas + o índice |
| Transitório (colunas já criadas pelo `ensureSchema` antigo) | **não recria** (sem `ER_DUP_FIELDNAME`); adiciona só o índice que faltava |
| Parcial / repetido / concorrente | completa o que falta; idempotente |
| Coluna/índice existente **incompatível** (tipo, tamanho, nulabilidade) | **aborta de forma acionável** (tabela-sentinela `erro_0288_*`) — nunca muta silenciosamente |

Defesa em profundidade: após o `runMigrations()`, o `ensureSchema → assertColumnsPresent` revalida
**presença + tipo + tamanho + nulabilidade** dessas colunas e falha de forma acionável em
staging/produção (aviso em dev) — **sem** mutar o schema.

**Rollback lógico** (se necessário): as colunas são aditivas e nuláveis; dropar as 3 colunas + o
índice é seguro (sem dados obrigatórios) e faz a 0288 reaplicá-las no próximo boot. Nenhuma marcação
manual do journal é necessária — o drizzle decide pela cadeia (`created_at < folderMillis`).

## Observações

- Parsers **PDF/DOCX** são reais (B.2.3); PDF digitalizado da Pesquisa via OCR local (U2A-OCR).
- **Nenhuma** gravação direta no domínio: itens ficam em `import_staging_items` até a **promoção governada**
  (`promoteSession`, B.2.4 — transacional, idempotente, exige papel **manager+**; o operador revisa e aprova,
  a UI oculta a ação para quem não é gestor e explica o motivo).
- Logs **nunca** contêm URL assinada, credenciais ou conteúdo de documento.

### P0 piloto — importação documental e Itens Inteligentes
| Sintoma | Causa provável | Ação |
|---|---|---|
| Importação de DFD/ETP/TR falha com `OCR_REQUIRED` | PDF digitalizado (só imagem) | Esperado (documento não usa OCR): enviar o PDF original com texto ou o DOCX |
| Pesquisa falha com `OCR_REQUIRED` | PDF digitalizado e `OCR_ENABLED=false` | Religar o OCR ou enviar PDF com texto/planilha |
| Pesquisa falha com `OCR_FAILED` | Motor/tempo de OCR (`ocrFailure` no log) | "Tentar novamente"; se persistir, reduzir páginas ou enviar planilha |
| Pesquisa falha com `NO_VALID_ITEMS` | Arquivo sem tabela de itens reconhecível | Enviar arquivo com descrição/quantidade/unidade/valor |
| `UNSUPPORTED_MEDIA_TYPE` ao importar documento | `.doc`, CSV ou planilha como DFD/ETP/TR | Documentos aceitam só PDF com texto ou DOCX |
| "Usar como rascunho" retorna `CONFLICT` | Já existe rascunho do documento no processo | Usar "Substituir rascunho…" (confirmação + motivo); o anterior fica no histórico |
| Substituição retorna `CONFLICT` | O rascunho mudou desde que foi carregado | Recarregar e confirmar de novo |
| Promoção da pesquisa retorna `CONFLICT` "mesmo arquivo" | Checksum já promovido neste processo | Esperado — evita duplicar cotações |
| Promoção da pesquisa `PRECONDITION_FAILED` "valor ambíguo" | Preço como "1,234" | Corrigir o valor no staging ("1.234,00" ou "1,23") |
| Item Inteligente com `enrichment_status = failed` | Falha no enriquecimento pós-commit | Item/pesquisa válidos; sugestão CATMAT ausente — decidir manualmente |
| TR/ETP mostra "fontes mudaram" | DFD/ETP/itens alterados após a geração | Gerar novamente com base no processo |
