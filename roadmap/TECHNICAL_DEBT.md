# Technical Debt Register

**Atualizado:** Maio 2026

---

## Dívidas Conhecidas

### TD-001: organizationId nullable em tabelas core
**Severidade:** Média  
**Sprint de origem:** Sprint 1  
**Descrição:** `organizationId` adicionado como nullable para migração gradual. Deveria ser NOT NULL.  
**Plano:** Sprint 3 ou 4: backfill + `ALTER TABLE ... MODIFY organizationId INT NOT NULL`  
**Risco de manter:** Queries sem filtro de tenant retornam dados de todas as orgs

---

### TD-002: ImportQueueService em memória
**Severidade:** Alta  
**Sprint de origem:** Sprint 2.8  
**Descrição:** Fila de importação em memória. Jobs perdidos em restart do servidor.  
**Plano:** Sprint 3: migrar para BullMQ + Redis  
**Risco de manter:** Deploy causa perda de jobs em processamento

---

### TD-003: PdfParser e DocxParser em modo stub
**Severidade:** Alta  
**Sprint de origem:** Sprint 2.8  
**Descrição:** Parsers retornam warning "modo stub" sem extração real.  
**Plano:** Sprint 3: integrar `pdf-parse` e `mammoth`  
**Risco de manter:** Upload de PDF/DOCX não extrai nenhum item

---

### TD-004: RenderService sem biblioteca real de DOCX
**Severidade:** Baixa  
**Sprint de origem:** Sprint 2.5  
**Descrição:** Renderização DOCX é placeholder. PDF usa PDFKit básico.  
**Plano:** Sprint 4: integrar `docx` ou `officegen` para DOCX rico  
**Risco de manter:** Exportações DOCX de baixa qualidade visual

---

### TD-005: cleanupExpiredLocks sem cron job
**Severidade:** Baixa  
**Sprint de origem:** Sprint 2.5  
**Descrição:** `cleanupExpiredLocks()` implementado mas não há cron que o chame.  
**Plano:** Sprint 3: adicionar cron job ou scheduler  
**Risco de manter:** Locks expirados acumulam no banco sem limpeza automática

---

### TD-006: Schema sem índices completos
**Severidade:** Baixa  
**Sprint de origem:** Sprint 1  
**Descrição:** Algumas tabelas têm apenas índice de PK + organizationId. Queries de filtro por status/data podem ser lentas com volume.  
**Plano:** Sprint 5 (após analytics): adicionar índices baseados em query profile  
**Risco de manter:** Performance degradada com >10k registros por organização

---

## Dívidas Endereçadas

| TD | Descrição | Sprint | Resolução |
|----|-----------|--------|-----------|
| — | Fila síncrona de parse | 2.8 | Implementada fila assíncrona com setImmediate |
| — | Sem proveniência de extração | 2.8 | ExtractionProvenance completo |
| — | Sem controle de retenção | 2.5 | RetentionPolicy com 7 classes LGPD |
| — | Sem auditoria imutável | 2 | document_timeline append-only |
