# Motor Documental — Document Engine

## Visão Geral

O motor documental do LiciGov Pro é responsável pela gestão completa do ciclo de vida de documentos licitatórios em conformidade com a Lei 14.133/2021.

## Aggregate: DocumentoLicitatorio

```
documents
  ├── document_versions      (imutáveis, append-only)
  ├── document_drafts        (mutáveis, descartáveis)
  ├── document_timeline      (imutável, append-only)
  ├── document_attachments   (tenant-safe)
  └── document_render_cache  (TTL, invalidável)
```

## Workflow State Machine

```
draft ──────────────────────────────────────────► archived
  │                                                   ▲
  ▼                                                   │
in_review ──────────────────────────────────────────→ │
  │              │                                    │
  ▼              ▼                                    │
approved      rejected ──────────────────────────────→ │
  │                                                   │
  └───────────────────────────────────────────────────┘
```

## PolicyEngine — 14 Ações

| Ação | viewer | operator | manager | admin | owner |
|------|--------|----------|---------|-------|-------|
| view_history | ✓ | ✓ | ✓ | ✓ | ✓ |
| comment | ✓ | ✓ | ✓ | ✓ | ✓ |
| edit | — | ✓* | ✓ | ✓ | ✓ |
| delete_draft | — | ✓* | ✓ | ✓ | ✓ |
| manage_attachments | — | ✓ | ✓ | ✓ | ✓ |
| submit_review | — | ✓ | ✓ | ✓ | ✓ |
| export | — | ✓ | ✓ | ✓ | ✓ |
| restore_version | — | — | ✓ | ✓ | ✓ |
| approve | — | — | ✓ | ✓ | ✓ |
| reject | — | — | ✓ | ✓ | ✓ |
| archive | — | — | ✓ | ✓ | ✓ |
| manage_lock | — | — | ✓ | ✓ | ✓ |
| verify_integrity | — | — | ✓ | ✓ | ✓ |
| unlock | — | — | — | ✓ | ✓ |
| purge | — | — | — | — | ✓ |

*Somente próprio draft/documento

## RetentionPolicy por Tipo

| Tipo | Classe | Retenção |
|------|--------|----------|
| contrato, aditivo, edital | legal_permanent | Permanente |
| parecer, ata | legal_7years | 7 anos |
| tr, etp, dfd | operational_3years | 3 anos |
| rascunhos | draft_7days | 7 dias |
| logs | log_2years | 2 anos |
| temporários | temp_30days | 30 dias |
| anexos | attachment_follows_document | Segue o doc pai |

## Integridade Criptográfica

Cada documento e versão carrega:
- `contentHash`: SHA-256 do conteúdo bruto
- `snapshotFingerprint`: SHA-256 de `documentId + orgId + content + versionNumber`

Verificação: `validateIntegrity(expectedFingerprint, computedFingerprint)`

## Concorrência Colaborativa

- **Soft lock** (15 min): advisory — notifica mas não bloqueia
- **Hard lock** (60 min): blocking — bloqueia escritas de outros usuários
- `detectAutosaveCollision()`: verifica se auto-save vai sobrescrever trabalho de outro

## Render Pipeline

```
document + version
    │
    ▼
RenderService.renderDocument(format)
    │
    ├── format="html"  → template HTML + CSS inline
    ├── format="docx"  → geração DOCX via template
    └── format="pdf"   → PDFKit (geração, não parsing)
    │
    ▼
document_render_cache (TTL, hash-keyed)
```
