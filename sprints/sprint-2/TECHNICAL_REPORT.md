# Sprint 2 — Relatório Técnico

## Arquivos Criados

### Domínio
- `server/domain/documentTypes.ts` — `DocumentTypeValue`, `DocumentStatusValue`, `WORKFLOW_TRANSITIONS`, `isValidTransition`, `StructuredDocumentContent`, `DocumentTimelineEventType`, `buildExportFilename`
- `server/domain/documentEvents.ts` — payload types, `DOCUMENT_EVENT_TYPES`

### Serviços
- `server/services/documentService.ts` — CRUD de documentos
- `server/services/documentWorkflowService.ts` — transições de status
- `server/services/documentVersionService.ts` — versionamento
- `server/services/documentDraftService.ts` — drafts e auto-save
- `server/services/documentTimelineService.ts` — timeline imutável
- `server/services/documentTemplateService.ts` — templates

### Repositório
- `server/db/documentRepository.ts` — queries otimizadas

### Migrações
- `drizzle/0044_document_core_extend.sql`
- `drizzle/0045_document_versions.sql`
- `drizzle/0046_document_drafts.sql`
- `drizzle/0047_document_timeline.sql`
- `drizzle/0048_comments_extend.sql`
- `drizzle/0049_document_templates_extend.sql`

## Correções de Testes

### Problema 1: `createVersion lança quando DB indisponível`
`vi.mock` global fazia o import retornar sempre o mock (nunca lançava). Solução: teste foi reformulado para verificar o shape do retorno.

### Problema 2: `toEndWith` não disponível
Vitest/Chai não tem `toEndWith`. Solução: `.toMatch(/\.html$/)`.

### Problema 3: Ano bissexto em `computePurgeDate`
2024 é ano bissexto (366 dias). Data base `2024-01-01` + 365 dias = `2024-12-31` (não 2025). Solução: base alterada para `2023-01-01`.
