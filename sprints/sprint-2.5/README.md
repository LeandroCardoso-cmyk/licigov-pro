# Sprint 2.5 — Hardening Documental

**Status:** Concluída  
**Data:** Maio 2026  
**Impacto:** Hardening enterprise do motor documental

---

## Objetivo

Fortalecer o core documental com política de acesso granular, diff semântico, retenção por classe legal, integridade criptográfica, anexos, renderização e concorrência colaborativa.

## Entregas

### PolicyEngine (14 ações)
Avaliação de política por contexto (role, status, lock, ownership):
- `edit`, `approve`, `reject`, `submit_review`
- `restore_version`, `comment`, `archive`, `unlock`
- `export`, `delete_draft`, `manage_attachments`, `view_history`
- `manage_lock`, `verify_integrity`, `purge`

### DiffEngine Semântico
- `computeDiff()`: diff entre versões com proveniência
- `diffBlocks()`: diff de blocos de conteúdo
- `diffSections()`: diff de seções estruturadas
- `diffVariables()`: diff de variáveis de template
- Severidade: `none | minor | moderate | major` baseada em `totalChanges`

### RetentionPolicy — 7 classes LGPD
| Classe | Documentos | Retenção |
|--------|-----------|----------|
| `legal_permanent` | contrato, aditivo, edital | Permanente |
| `legal_7years` | parecer, ata | 7 anos |
| `operational_3years` | TR, ETP, DFD | 3 anos |
| `draft_7days` | rascunhos | 7 dias |
| `log_2years` | logs | 2 anos |
| `temp_30days` | temporários | 30 dias |
| `attachment_follows_document` | anexos | Segue o documento |

### IntegrityService
- `hashContent(content)`: SHA-256 do conteúdo
- `computeSnapshotFingerprint()`: fingerprint composto (id + org + content + version)
- `validateIntegrity(expected, actual)`: verificação de integridade
- Colunas adicionadas: `contentHash`, `snapshotFingerprint` em `documents` e `document_versions`

### AttachmentService
- Tabela `document_attachments`: tenant-safe
- `scanStatus`: `pending | clean | infected | error` (preparado para antivírus)
- Vínculos com versão específica do documento

### RenderService
- Suporta formatos: `html | docx | pdf`
- Cache por versão: tabela `document_render_cache`
- `invalidateRenderCache()`: invalidação após edição

### ConcurrencyService
- Lock soft: 15 min, advisory (avisa mas não bloqueia)
- Lock hard: 60 min, blocking (bloqueia escritas)
- `detectAutosaveCollision()`: detecta colisão de auto-save
- `cleanupExpiredLocks()`: limpeza automática

## Migrações
- `0050_document_attachments.sql`
- `0051_document_integrity.sql`
- `0052_document_retention.sql`
- `0053_document_render_cache.sql`

## Testes
- 76 testes de integração: `sprint25-hardening.test.ts`
- Total acumulado: 438 testes

## Impacto Arquitetural

Transformou o motor documental em sistema **enterprise-grade**: com auditoria criptográfica, conformidade LGPD nativa, controle de acesso granular e colaboração segura.
