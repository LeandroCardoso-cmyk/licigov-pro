# Architectural Decisions

Esta pasta documenta decisões arquiteturais importantes (ADRs — Architecture Decision Records).

## ADRs Registrados

Ver [../ARCHITECTURAL_DECISIONS.md](../ARCHITECTURAL_DECISIONS.md) para o registro completo.

## Template de ADR

```markdown
## ADR-NNN: [Título]

**Status:** Accepted | Deprecated | Superseded by ADR-XXX

**Contexto:** [Por que esta decisão foi necessária]

**Decisão:** [O que foi decidido]

**Consequências:**
- [consequência positiva]
- [consequência negativa ou tradeoff]
```

## Lista Resumida

| ADR | Decisão | Sprint |
|-----|---------|--------|
| ADR-001 | organizationId obrigatório em toda operação | Sprint 1 |
| ADR-002 | Row-level isolation via WHERE (não RLS) | Sprint 1 |
| ADR-003 | RBAC hierárquico por nível numérico | Sprint 1 |
| ADR-004 | StructuredContent como JSON tipado | Sprint 2 |
| ADR-005 | Timeline imutável por insert-only | Sprint 2 |
| ADR-006 | Drafts separados de versões | Sprint 2 |
| ADR-007 | PolicyEngine centralizado | Sprint 2.5 |
| ADR-008 | RetentionPolicy por tipo de documento | Sprint 2.5 |
| ADR-009 | Locks com expiração automática | Sprint 2.5 |
| ADR-010 | Staging como barreira obrigatória | Sprint 2.8 |
| ADR-011 | Confidence como metadado explícito | Sprint 2.8 |
| ADR-012 | Fila em memória com API compatível BullMQ | Sprint 2.8 |
| ADR-013 | ParseOptions com sourceChecksum | Sprint 2.8 |
