# Sprint 2.5 — Relatório Técnico

## Arquivos Criados

### Domínio
- `server/domain/documentPolicy.ts` — PolicyEngine com 14 ações
- `server/domain/documentDiff.ts` — DiffEngine semântico
- `server/domain/documentRetention.ts` — RetentionPolicy com 7 classes
- `server/domain/documentIntegrity.ts` — IntegrityService SHA-256

### Serviços
- `server/services/documentConcurrencyService.ts` — soft/hard locks
- `server/services/documentRenderService.ts` — HTML/DOCX/PDF
- `server/services/documentIntegrityService.ts` — verificação de integridade
- `server/services/documentAttachmentService.ts` — gerenciamento de anexos
- `server/services/documentDiffService.ts` — exposição de diff

### Migrações
- `drizzle/0050_document_attachments.sql`
- `drizzle/0051_document_integrity.sql`
- `drizzle/0052_document_retention.sql`
- `drizzle/0053_document_render_cache.sql`

## Notas de Implementação

### PolicyEngine
Avalia uma `PolicyAction` contra `PolicyEvaluationContext` (role, status, ownership, lock state). Retorna `PolicyResult` com `{ allowed, reason }`. `assertPolicy()` lança `TRPCError` se negado.

### DiffEngine
Usa diff de linhas (LCS) para conteúdo textual e diff estrutural para `structuredContent`. Severidade calculada por `totalChanges`: none=0, minor≤5, moderate≤20, major>20.

### ConcurrencyService
Soft lock: registra lock no banco, avisa se outro usuário tem lock ativo, mas permite escrita. Hard lock: bloqueia escritas de outros usuários. Ambos expiram automaticamente.

### RenderService
HTML: injeção de CSS inline. DOCX: geração via template. PDF: via PDFKit (geração, não parsing). Cache por `renderHash` = SHA-256 do conteúdo + versão.
