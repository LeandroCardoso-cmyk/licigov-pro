# Sprint 2 — Decisões Arquiteturais

## ADR-004: StructuredContent como JSON tipado

**Contexto:** Documentos licitatórios possuem estrutura complexa (seções, blocos, variáveis, tabelas).

**Decisão:** `structuredContent` é um campo JSON tipado pela interface `StructuredDocumentContent` no TypeScript, sem schema enforcement no banco.

**Consequências:**
- Flexibilidade para evoluir o schema sem migração
- Risco de inconsistência se não validado na camada de serviço
- Sprint 3+ pode adicionar validação com Zod

---

## ADR-005: Timeline imutável por insert-only

**Contexto:** Auditoria documental requer registro inviolável de todas as mudanças.

**Decisão:** `document_timeline` só aceita INSERT. Nunca UPDATE ou DELETE de eventos de timeline.

**Consequências:**
- Auditoria confiável e não-repudiável
- Volume crescente de dados (aceitável para documentos)
- Não há "desfazer" de timeline (intencional)

---

## ADR-006: Drafts separados de versões

**Contexto:** Auto-save não deve criar versão oficial a cada keystroke.

**Decisão:** Drafts são entidades separadas (`document_drafts`) sem versionamento. A versão oficial só é criada por ação explícita do usuário.

**Consequências:**
- Draft pode ser descartado sem rastro de versão
- Múltiplos drafts por usuário/documento possíveis
- Promoção de draft → versão é operação explícita auditada
