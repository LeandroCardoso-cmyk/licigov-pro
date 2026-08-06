# LiciGov Pro — Motor de Importação

> Documentação do sistema de importação de dados externos: lifecycle, parsers, staging e canonicalização.
> Atualizado em: 2026-05-27

---

## Princípio Fundamental

> **Raw extraction NUNCA persiste diretamente no domínio.**

O fluxo de importação é rigorosamente controlado:
```
Upload → Ingestão → Parsing → Staging → Validação → Revisão Humana → Aprovação → Domínio
```

Este princípio garante:
- Rastreabilidade completa de origem de cada dado
- Revisão humana antes de qualquer persistência no domínio
- Reversibilidade total: staging pode ser rejeitado sem impacto
- Conformidade com a obrigatoriedade de pesquisa de preços documentada

---

## Ciclo de Vida da ImportSession

### 10 Status do Ciclo de Vida

```
uploaded → queued → parsing → extracted → normalized → awaiting_review
                                                           ↙         ↘
                                                       approved    rejected
                                                          ↓
                                                       archived
                                            (+ failed a qualquer ponto)
```

| Status | Descrição | Ação do Usuário |
|---|---|---|
| `uploaded` | Arquivo recebido, aguardando enfileiramento | — |
| `queued` | Na fila de processamento | Pode cancelar |
| `parsing` | Parser ativo, extraindo dados | Pode cancelar |
| `extracted` | Dados brutos extraídos, aguardando normalização | — |
| `normalized` | Dados normalizados, confiança calculada | — |
| `awaiting_review` | Aguardando revisão humana | Revisar itens |
| `approved` | Aprovado pelo usuário, pronto para promoção | Promover ao domínio |
| `rejected` | Rejeitado pelo usuário | — |
| `failed` | Falha técnica no processamento | Ver logs de erro |
| `archived` | Arquivado após processamento completo | — |

---

## Tipos de Importação

### `price_research` — Pesquisa de Preços
- **Finalidade**: Importar resultados de cotações de mercado
- **Formato típico**: XLSX ou CSV com colunas: fornecedor, item, unidade, valor
- **Destino no domínio**: `PesquisaPrecos` vinculada ao processo licitatório
- **Validações específicas**: CNPJ de fornecedor, unidade canônica, valor > 0

### `tr_items` — Itens do Termo de Referência
- **Finalidade**: Importar lista de itens para o TR a partir de planilha
- **Formato típico**: XLSX com: código, descrição, unidade, quantidade, valor unitário
- **Destino no domínio**: Itens do `DocumentoLicitatorio` tipo TR
- **Validações específicas**: Match CATMAT obrigatório a partir da Sprint 3

### `catmat` — Catálogo de Materiais
- **Finalidade**: Importar dados do CATMAT para uso interno
- **Formato típico**: CSV oficial do ComprasNet
- **Destino no domínio**: `CatmatItem` (tabela de referência)
- **Validações específicas**: Código CATMAT válido

### `generic` — Genérico
- **Finalidade**: Qualquer planilha estruturada sem tipo específico
- **Formato típico**: CSV ou XLSX
- **Destino no domínio**: A definir pelo operador
- **Validações específicas**: Apenas validações estruturais básicas

---

## Parsers

### CSV Parser
- **MIME types**: `text/csv`, `application/csv`
- **Extensões**: `.csv`
- **Detecção automática de delimitador**: `,`, `;`, `\t`, `|`
- **Encoding suportado**: UTF-8, Latin1 (auto-detect)
- **Limite**: 50MB, 100k linhas

### XLSX Parser (SheetJS)
- **MIME types**: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- **Extensões**: `.xlsx`, `.xls`
- **Suporte a múltiplas planilhas**: Sim (hint de sheet name ou índice)
- **Detecção de cabeçalho**: Automática (primeira linha) ou linha configurável
- **Limite**: 50MB, 100k linhas

### PDF Parser (stub — Sprint 3)
- **MIME types**: `application/pdf`
- **Extensões**: `.pdf`
- **Status**: Interface definida, implementação na Sprint 3
- **Estratégia**: pdfjs + análise estrutural de tabelas

### DOCX Parser (stub — Sprint 3)
- **MIME types**: `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- **Extensões**: `.docx`
- **Status**: Interface definida, implementação na Sprint 3
- **Estratégia**: Extração de tabelas e listas estruturadas

### ParserRegistry
O `ParserRegistry` resolve o parser correto para cada arquivo:
1. Por MIME type explícito
2. Por extensão de arquivo
3. Por hint explícito do usuário
4. Fallback: generic parser

---

## Canonicalização de Unidades

### CanonicalUnits Registry — 25 Unidades PT-BR

| Código Canônico | Sinônimos Aceitos | Descrição |
|---|---|---|
| `UN` | un, unid, unidade, und | Unidade |
| `KG` | kg, kilo, quilograma | Quilograma |
| `G` | g, grama, gr | Grama |
| `L` | l, litro, lt | Litro |
| `ML` | ml, mililitro | Mililitro |
| `M` | m, metro, mt | Metro linear |
| `M2` | m², m2, metro quadrado | Metro quadrado |
| `M3` | m³, m3, metro cúbico | Metro cúbico |
| `CX` | cx, caixa | Caixa |
| `PCT` | pct, pacote, pk | Pacote |
| `RL` | rl, rolo | Rolo |
| `RS` | rs, resma | Resma |
| `PC` | pc, peça | Peça |
| `JG` | jg, jogo | Jogo |
| `KIT` | kit | Kit |
| `PAR` | par, pares | Par |
| `FD` | fd, fardo | Fardo |
| `SC` | sc, saco | Saco |
| `TB` | tb, tubo | Tubo |
| `FR` | fr, frasco | Frasco |
| `AMP` | amp, ampola | Ampola |
| `COM` | com, comprimido | Comprimido |
| `H` | h, hr, hora | Hora |
| `DIA` | dia, d | Dia |
| `MES` | mês, mes, m | Mês |

---

## Sistema de Confiança (Confidence)

### Níveis de Confiança
| Nível | Score | Significado | Ação Recomendada |
|---|---|---|---|
| `high` | ≥ 0.85 | Alta certeza | Aprovação em lote permitida |
| `medium` | ≥ 0.60 | Confiança moderada | Revisão opcional |
| `low` | ≥ 0.35 | Baixa certeza | Revisão manual recomendada |
| `uncertain` | < 0.35 | Incerteza alta | Revisão manual obrigatória |

### Fatores que Impactam o Score
- Match de unidade canônica: +0.20 se exato, -0.30 se não encontrado
- Formato de valor numérico: +0.15 se válido
- Completude de campos obrigatórios: +0.10 por campo
- Match com dados históricos: +0.20 se encontrado
- Inconsistência de dados: -0.40 se detectada

---

## ExtractionProvenance

Cada item extraído tem proveniência completa registrada:

```typescript
interface ExtractionProvenance {
  sourceFile: string;          // Nome do arquivo original
  sheet?: string;              // Nome da planilha (XLSX)
  row?: number;                // Número da linha
  column?: string;             // Identificador da coluna (A, B, etc.)
  page?: number;               // Número da página (PDF)
  rawValue: string;            // Valor bruto antes da normalização
  normalizedValue: unknown;    // Valor após normalização
  normalizationSteps: string[]; // Passos de transformação aplicados
}
```

---

## Serviços

### FileIngestionService
- Valida MIME type e tamanho do arquivo
- Persiste no storage (Railway Volume ou S3-compatible)
- Cria `ImportSession` com status `uploaded`
- Enfileira para processamento

### ImportStagingService
- Recebe dados extraídos do parser
- Normaliza unidades com `CanonicalUnits`
- Calcula scores de confiança
- Persiste em `import_staging` com proveniência completa

### ImportQueueService
- Fila in-process com retry exponential backoff (3 tentativas)
- Dead Letter Queue para itens que falham após retries
- Concorrência configurável (padrão: 3 sessões simultâneas)
- Logs de cada tentativa para diagnóstico

---

---

## API Canônica de Ingestão (PR B.2.1)

> **Superfície tRPC `ingestion.*`** que expõe o motor acima. Tenant-safe, gated por feature flag
> `FF_CANONICAL_INGESTION` (tenant-aware, **desabilitada por padrão** / fail-closed). **Não** promove
> ao domínio, **não** implementa parser PDF/DOCX real e **não** substitui o caminho legado.

Fluxo canônico:
```
createSession (tRPC)                → cria sessão `uploaded` + chave S3 gerada no servidor
POST /api/ingestion/upload/:id      → byte-upload (Express, binário cru, NUNCA base64/tRPC)
enqueueProcessing (tRPC)            → parse → staging (replay-safe)
listStagingItems / reviewItem(Bulk) → revisão humana
approveSession (tRPC)               → aprova após revisão (NÃO promove ao domínio nesta etapa)
```

| Contrato | Tipo | Descrição |
|---|---|---|
| `ingestion.createSession` | mutation | Cria a sessão (tenant, usuário, `processId?`, `importType`, `importPurpose?`, `checksum`, `correlationId?`, `idempotencyKey`). Idempotente por chave; dedup por checksum; chave de storage gerada no servidor. Não recebe bytes. |
| *(byte-upload)* `POST /api/ingestion/upload/:sessionId` | Express | **multipart/form-data em streaming** (busboy). Auth/tenant/flag resolvidos ANTES de consumir o corpo; limite aplicado DURANTE o stream com abort imediato; SHA-256 incremental; validação de *magic bytes*; chave gerada no servidor; **streaming direto ao S3** (`@aws-sdk/lib-storage`) — sem Buffer completo, sem base64; cleanup de parcial em falha. |
| `ingestion.enqueueProcessing` | mutation | Enfileira o processamento (parse→staging). Replay-safe por status (não re-enfileira em voo; conflito em estado terminal). O **job carrega só metadados** (`storageKey`+correlationId, nunca Buffer); o worker baixa os bytes do storage. |
| `ingestion.getSessionStatus` | query | Status, progresso, parser+versão, warnings, erro **sanitizado**, tentativas, timestamps + resumo de staging. |
| `ingestion.listStagingItems` | query | Itens de staging paginados, tenant-safe, com confiança/proveniência/avisos. |
| `ingestion.reviewItem` / `reviewBulk` | mutation | Revisão humana (aceitar/rejeitar/pular) com ator, justificativa e transição auditados. Idempotente. |
| `ingestion.approveSession` | mutation | Aprova **após** revisão completa (bloqueia se há itens pendentes). **Não promove** ao domínio. |

**Garantias de segurança:** isolamento multi-tenant em todas as queries; autorização por processo
(quando informado) e organização; idempotência (chave + payloadHash); replay-safety; correlationId
propagado; audit log persistido; validação de conteúdo (magic bytes, não só extensão); proteção
contra path traversal (nome de objeto gerado pelo servidor); nenhuma URL/credencial/conteúdo em logs;
nenhuma gravação direta de extração no domínio; nenhuma aprovação automática.

**Recuperação após restart:** a fila é in-memory; no boot, `recoverStuckImportSessions` reidrata
sessões presas (`queued`/`parsing`) de forma determinística — claim atômico no banco (impede
execução concorrente duplicada), respeita o limite de tentativas, encaminha à DLQ quando esgota,
preserva correlationId/lineage e é **fail-closed por tenant** (só reprocessa orgs com a flag ligada).

**Schema:** `checksum`/`processId`/`importPurpose` são criados pela migration **formal** e versionada
[`drizzle/0288`](../../drizzle/0288_import_session_canonical_fields.sql) (aditiva, nullable, índice
tenant-aware não-único). O `ensureSchema` **não** cria essas colunas — apenas verifica e falha de
forma acionável em produção/staging se ausentes (nunca muta o schema silenciosamente).

**Ainda NÃO implementado (fora do escopo da B.2.1):** promoção ao domínio (DFD/ETP/Pesquisa de
Preços/TR), parser real de PDF/DOCX, alterações nos workspaces, remoção do caminho legado.

---

## Interface Canônica de Ingestão (PR B.2.2)

> **B.2.2 conecta as INTERFACES** à fundação da B.2.1. Não implementa parser PDF/DOCX (B.2.3) nem
> promoção transacional ao domínio (B.2.4). **Nenhum documento oficial é criado nesta etapa.**

### Roadmap dos blocos
- **B.2.1** — fundação canônica (API, upload streaming, fila, staging, migration 0288). ✅
- **B.2.2** — conecta as interfaces (esta etapa): Pesquisa de Preços, DFD e ETP. ✅
- **B.2.3** — parsers reais de PDF/DOCX (habilita a extração desses formatos).
- **B.2.4** — promoção transacional ao domínio (incorporação ao processo).

### Camada de frontend
- **Lib pura e testável** (`client/src/lib/ingestion/`): `status` (fases institucionais + `derivePhase`),
  `capabilities` (accept/validação), `staging` (confidence/provenance), `sha256` (checksum do cliente).
- **Hooks** (`client/src/hooks/ingestion/`, TanStack Query): `useIngestionCapabilities`,
  `useSupervisedIngestion` (create → upload multipart via `fetch`/`FormData` → enqueue → polling;
  guarda de duplo-clique; idempotência; cancel; retry), `useStagingReview` (lista paginada +
  reviewItem/bulk + approve).
- **Componentes** (`client/src/components/ingestion/`, shadcn + dark mode + a11y): `DocumentIngestionLauncher`,
  `FileDropzone` (`<input type="file">` real), `IngestionSessionProgress`, `IngestionStatusBadge`,
  `StagingReviewTable`, `StagingReviewDrawer`, `IngestionWarningsPanel`, `IngestionErrorState`,
  `IngestionAuditSummary`.

### Query de capacidades — `ingestion.getCapabilities`
Read-only, tenant-aware. A UI gateia por `enabled` (flag existente; sem flag → superfície não
exposta) e reflete a capacidade REAL: `supported` de cada formato é **derivado do parserRegistry**
(stub ⇒ `false`). O backend continua autorizando cada operação (não confia no frontend).

### Matriz de capacidades real (formato × parser × estado)
| Formato | MIME / extensão | Parser | Estado |
|---|---|---|---|
| CSV | `text/csv`, `application/csv`, `text/plain`, `.csv`/`.txt` | `csvParser 1.0.0` | ✅ **suportado** |
| XLSX | OOXML spreadsheet, `.xlsx` | `xlsxParser 1.0.0` (SheetJS) | ✅ **suportado** |
| XLS | `application/vnd.ms-excel`, `.xls` | `xlsxParser 1.0.0` (OLE via SheetJS) | ✅ **suportado** |
| PDF | `application/pdf`, `.pdf` | `pdfParser 1.0.0-stub` | ❌ **stub (B.2.3)** |
| DOCX/DOC | OOXML word / `application/msword`, `.docx`/`.doc` | `docxParser 1.0.0-stub` | ❌ **stub (B.2.3)** |
| Conteúdo colado | enviado como `text/csv` (bytes UTF-8) | `csvParser 1.0.0` | ✅ **suportado** |

> Formatos com parser **stub NÃO são apresentados como funcionais**. Um upload de PDF/DOCX é
> rejeitado no cliente (mensagem objetiva) e no servidor.

### Pesquisa de Preços (fim a fim)
Com a flag LIGADA, o `DocumentIngestionLauncher` (importType `price_research`) oferece três entradas:
**Inserir manualmente** (caminho legado `procurementProcess.importPriceResearch`, preservado/congelado),
**Colar conteúdo** (enviado como CSV) e **Enviar arquivo** (dropzone real, CSV/XLSX/XLS). O fluxo é
`createSession → upload multipart → fila → staging → revisão humana (aceitar/rejeitar/pular + nota) →
aprovação da revisão`. Com a flag DESLIGADA (padrão de produção), a superfície canônica não é exposta
e o comportamento legado permanece idêntico.

### DFD e ETP (capability-aware)
- **DFD**: preserva "Criar DFD do zero"; "Importar DFD existente" usa a fundação canônica
  (`relevantFormatKeys=[pdf,docx]`). Como PDF/DOCX são stub, a importação aparece **indisponível** de
  forma objetiva (sem ofertar formatos alheios nem fluxo sem resultado). Legado congelado quando a
  flag está desligada.
- **ETP**: preserva "Gerar ETP a partir do processo"; adiciona "Importar ETP existente" (canônico,
  capability-aware). Sem geração jurídica autônoma; sem promoção; revisão humana obrigatória.

### Estados de sessão visíveis (institucionais, pt-BR)
`Preparando → Enviando → Enviado → Na fila → Processando → Aguardando revisão → Parcialmente revisado
→ Revisado → Revisão aprovada`; além de `Falhou`, `Enviado para DLQ` e `Arquivado`. O progresso reflete
o estado **persistido** (nunca progresso simulado).

### Feature flag
`FF_CANONICAL_INGESTION` — tenant-aware, **fail-closed**, **desabilitada em produção** (esta etapa não
a habilita). Sem registro para o tenant → superfície não exposta e cada operação retorna `FORBIDDEN`.

### Segurança / observabilidade (frontend + backend)
Isolamento por organização; **nenhum binário/base64 em tRPC** (upload só por `fetch`/`FormData` com
`credentials`); nenhum caminho de storage exposto; checksum do cliente é só expectativa (servidor é a
autoridade); `correlationId` disponível para suporte (sem PII); mensagens de erro sanitizadas; guarda
de duplo-clique e submissão duplicada; cancelamento sem corromper o estado persistido; retry idempotente.

### Acessibilidade
Dropzone com `role="button"`, `tabIndex`, `aria-label`/`aria-describedby`, ativação por Enter/Espaço e
foco visível (`focus-visible:ring`); estados anunciados via `role="status"`/`role="alert"`; dark mode
via tokens semânticos + variantes `dark:`.

### Vínculo com o processo canônico (B.2.2 — correções)
As sessões de ingestão são vinculadas ao **processo canônico** (`procurement_processes.id`, `varchar(20)`)
via `import_sessions.procurementProcessId` (migration aditiva **0289**, índice tenant-aware
`(organizationId, procurementProcessId)`). Semanticamente **separado** do `processId` legado (int).
Garantias: `createSession` valida que o processo pertence à organização; toda operação
(`status`/`staging`/`reviewItem`/`reviewBulk`/`approveSession`) valida **tenant e processo** — uma
sessão de um processo **não** é operável em outro processo do mesmo tenant; dedup por checksum e
retomada (`getActiveSession`) são **escopados por processo**; o reload retoma somente a sessão daquele
processo. Capacidade explícita: `capabilityStatus` (supported/stub/disabled) declarado por cada parser
é a fonte da verdade do gating (não a convenção de versão).

### Correção humana de itens — IMPLEMENTADA (migration 0290)
Correção auditável de item de staging, com **original imutável + projeção atual + histórico**:

- **Schema (migration 0290):** `import_staging_items` ganha `correctionRevision INT NOT NULL DEFAULT
  0`, `correctedPayload JSON NULL` (overlay validado), `correctedAt`, `correctedByUserId`. Os `raw*`
  permanecem **imutáveis** (provenance preservada). Tabela de histórico **imutável e consultável**
  `import_item_corrections` (org, procurementProcessId, importSessionId, stagingItemId, fromRevision,
  toRevision, beforePayload, afterPayload, changedFields, justification, actorUserId, idempotencyKey,
  correlationId, createdAt) com unicidade `(org, item, toRevision)` e `(org, idempotencyKey)`.
- **Conteúdo efetivo** = `raw*` + `correctedPayload` (overlay vence). Nunca sobrescreve o raw.
- **Contrato `ingestion.correctItem`** (sessionId, procurementProcessId, itemId, expectedRevision,
  corrections, justification, idempotencyKey): valida tenant + processo canônico + sessão + item;
  valida campos permitidos por importType (allowlist explícita; rejeita desconhecidos e raw);
  exige justificativa; **concorrência otimista** (UPDATE só avança se `correctionRevision =
  expectedRevision`; senão `CONFLICT` acionável, sem histórico parcial); **idempotência** por
  `idempotencyKey`; grava histórico e projeção na **mesma transação**; incrementa a revisão uma vez.
- **Optimistic locking / idempotência:** conflito real (outro revisor) → `CONFLICT`; replay da mesma
  chave → no-op de sucesso (idempotente).
- **Allowlist price_research:** `description`, `quantity`, `unit`, `unitPrice`, `totalPrice`, com
  tipo/limite/normalização (decimais pt-BR/en-US). importTypes sem contrato → capacidade indisponível.
- **Semântica de revisão:** corrigir **não aprova** o item — ele segue pendente até aceitar/rejeitar/
  pular; `approveSession` continua exigindo zero pendentes. **Nenhuma promoção ao domínio.**
- **Fluxo visual (StagingReviewDrawer):** Original × Atual por campo, justificativa obrigatória,
  revisão atual, selo "Conteúdo corrigido", autor/hora; conflito exibe "Este item foi alterado por
  outro revisor. Atualize os dados antes de continuar." com refetch e preservação do rascunho local.
- **Observabilidade:** eventos auditáveis (correção criada/replay) só com identificadores seguros —
  nunca overlay/conteúdo, storageKey, URL, credenciais.

### Limitações remanescentes (registradas)
- PDF/DOCX permanecem **stub** — importação de DFD/ETP indisponível até a **B.2.3** (parsers reais).
- Não há contrato de "criar ETP manualmente" nem persistência de ETP (só `generateETP`) — para B.2.4.
- Promoção transacional ao domínio oficial — **B.2.4**.

### Troubleshooting
| Sintoma | Causa provável | Ação |
|---|---|---|
| Superfície canônica não aparece | Flag desligada para o tenant | Comportamento esperado (fail-closed); habilitar a flag por tenant fora de produção |
| "Formato não suportado" ao enviar PDF/DOCX | Parser stub (B.2.3) | Esperado; usar CSV/XLSX ou aguardar B.2.3 |
| Upload 413 | Arquivo acima de 50 MB | Reduzir o arquivo |
| Upload 400 "conteúdo não corresponde" | *magic bytes* × extensão divergentes | Reenviar o arquivo correto |
| Aprovação bloqueada | Itens pendentes de revisão | Revisar todos os itens antes de aprovar |

### Evidência Graphify
Grafo canônico atualizado **após** código + testes + build verdes (regra Graphify 6). Superfícies
confirmadas no código: `ProcessoLicitatorio` (abas `dfd`/`price`/`etp`) e os workspaces em
`client/src/components/procurement/`. Estado das divergências: **resolvido** — vínculo canônico
(migration 0289) e correção humana auditável (migration 0290) implementados; capacidade de parser
explícita. Permanecem para etapas futuras: PDF/DOCX stub (B.2.3) e persistência/criação manual de
ETP + promoção ao domínio (B.2.4).

---

*Para motor documental: [architecture/DOCUMENT_ENGINE_OFFICIAL.md](../architecture/DOCUMENT_ENGINE_OFFICIAL.md)*
*Para arquitetura de importação: [architecture/IMPORT_ENGINE.md](../architecture/IMPORT_ENGINE.md)*
*Troubleshooting da ingestão: [ops/INGESTION_RUNBOOK.md](../ops/INGESTION_RUNBOOK.md)*
