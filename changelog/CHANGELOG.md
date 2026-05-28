# Changelog — LiciGov Pro

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/).

---

## [Unreleased]

### Em desenvolvimento
- Sprint 3: Import avançado, CATMAT, interface de revisão humana

---

## [0.8.0] — Sprint 2.8 — Import Foundation Layer (Maio 2026)

### Adicionado
- Motor de importação: `ImportSession` aggregate com 10 status de lifecycle
- Parsers: `CsvParser`, `XlsxParser`, `PdfParser` (stub), `DocxParser` (stub)
- `ParserRegistry` com resolução por mime/extensão/hint
- `ConfidenceInfrastructure`: `ConfidenceMetadata`, `scoreToLevel`, `aggregateConfidence`
- `ExtractionProvenance`: rastreabilidade por célula/linha/página/sheet
- `RawExtractedItem` aggregate para staging isolation
- `CanonicalUnits` registry: 25 unidades PT-BR com normalização multi-estratégia
- `FileIngestionService`: validação, sessões, lifecycle
- `ImportStagingService`: persistência, revisão humana, bulk actions, TTL 30 dias
- `ImportQueueService`: fila assíncrona, retry com backoff exponencial, DLQ
- Tabelas: `import_sessions`, `import_staging_items` (migrações 0054-0055)
- Bootstrap safety nets Sprint 2.8

### Testes
- 99 novos testes de integração
- Total: 537 testes (100% passando)

---

## [0.5.0] — Sprint 2.5 — Hardening Documental (Maio 2026)

### Adicionado
- `PolicyEngine` com 14 ações e avaliação por contexto (role, status, ownership, lock)
- `DiffEngine` semântico: block/section/variable diff com severidade calculada
- `RetentionPolicy` com 7 classes de retenção LGPD/Lei 14.133/2021
- `IntegrityService`: SHA-256, `snapshotFingerprint`, validação de integridade
- `AttachmentService` com `scanStatus` para antivírus
- `RenderService`: HTML/DOCX/PDF com cache por versão
- `ConcurrencyService`: soft lock (15min) e hard lock (60min)
- Tabelas: `document_attachments`, `document_render_cache` (migrações 0050-0053)
- Colunas: `contentHash`, `snapshotFingerprint`, `retentionClass`, `legalHold`, `purgeAfter`

### Testes
- 76 novos testes de integração
- Total: 438 testes

---

## [0.2.0] — Sprint 2 — Core Documental (Maio 2026)

### Adicionado
- `DocumentoLicitatorio` aggregate com 11 tipos de documento
- Versionamento semântico: `document_versions` com `snapshotFingerprint`
- Drafts de edição: `document_drafts` separados de versões oficiais
- Timeline imutável: `document_timeline` append-only
- Workflow state machine: `draft → in_review → approved/rejected → archived`
- Comments com threading: `parentId`, `anchorSection`, `status`
- `DocumentTemplates` com variáveis para substituição de tokens
- Migrações 0044-0049

### Testes
- 55 novos testes de integração
- Total: ~382 testes

---

## [0.1.8] — Sprint 1.8 — Optimistic Locking (Maio 2026)

### Adicionado
- Campo `version` em `processes` para optimistic locking
- `assertVersion`, `OptimisticLockConflictError`
- Migração 0043

---

## [0.1.5] — Sprint 1.5 — Hardening Multi-tenant (Maio 2026)

### Adicionado
- `ActivityLog` hardening: campos imutáveis de snapshot
- `Outbox` envelope v2: `actorId`, `actorName`, `tenantContext`
- Idempotência: índice TTL para deduplicação
- Migrações 0039-0042

### Testes
- 22 novos testes de hardening

---

## [0.1.0] — Sprint 1 — Multi-tenant Foundation (Maio 2026)

### Adicionado
- `Organizations` aggregate com CNPJ, plano e configurações
- `OrganizationMembers` com RBAC: viewer/operator/manager/admin/owner
- Coluna `organizationId` em todas as tabelas de negócio
- `ActivityLogs` v2 com `correlationId`, `requestId`, `entityType`
- Outbox para eventos de domínio
- Feature flags por organização
- Migrações 0033-0038
- Bootstrap safety nets multi-tenant
