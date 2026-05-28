# Sprint 2 — Core Documental

**Status:** Concluída  
**Data:** Maio 2026  
**Impacto:** Motor documental completo com versionamento e workflow

---

## Objetivo

Implementar o core documental do LiciGov Pro: aggregate DocumentoLicitatorio com versionamento semântico, drafts de edição, timeline de auditoria, workflow state machine e templates.

## Entregas

### DocumentoLicitatorio Aggregate
- Tipos de documento: `edital | contrato | ata | parecer | tr | etp | dfd | aditivo | nota_tecnica | relatorio | outros`
- Status: `draft | in_review | approved | rejected | archived`
- Campos: `title`, `structuredContent` (JSON), `currentVersionId`, `metadata`
- Locking: `isLocked`, `lockedBy`, `lockReason`, `lockExpiresAt`

### Versionamento Semântico
- Tabela `document_versions`: `versionNumber`, `content`, `structuredContent`, `changeDescription`
- `snapshotFingerprint`: hash SHA-256 do conteúdo em cada versão
- Restauração para versão anterior

### Drafts de Edição
- Tabela `document_drafts`: rascunhos não versionados por usuário
- Auto-save sem criar versão formal
- Descarte ou promoção para versão oficial

### Timeline de Auditoria
- Tabela `document_timeline`: eventos imutáveis
- `DocumentTimelineEventType`: criação, edição, transição de status, versionamento, comentário, lock, unlock, exportação

### Workflow State Machine
- `WORKFLOW_TRANSITIONS`: transições válidas entre status
- `isValidTransition(from, to)`: validação de transição
- Fluxo: `draft → in_review → approved/rejected → archived`

### Comments com Threading
- `parentId` para threads aninhadas
- `anchorSection` para ancoragem em seção específica do documento
- Status: `open | resolved | dismissed`

### Document Templates
- Templates reutilizáveis por organização
- `variables` JSON para substituição de tokens
- `structuredContent` como base do documento

## Migrações
- `0044_document_core_extend.sql`
- `0045_document_versions.sql`
- `0046_document_drafts.sql`
- `0047_document_timeline.sql`
- `0048_comments_extend.sql`
- `0049_document_templates_extend.sql`

## Testes
- 55 testes de integração: `sprint2-core-documental.test.ts`
- Cobertura: criação, versionamento, drafts, timeline, workflow, templates

## Impacto Arquitetural

Estabeleceu o **aggregate raiz** da governança documental. Todo documento licitatório passa por este motor, garantindo rastreabilidade, integridade e conformidade com Lei 14.133/2021.
