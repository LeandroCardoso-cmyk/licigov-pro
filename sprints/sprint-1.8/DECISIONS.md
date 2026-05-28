# Sprint 1.8 — Decisões Arquiteturais

## ADR-S18-001: Optimistic locking sobre pessimistic locking

**Decisão:** Usar optimistic locking (version field) em vez de SELECT FOR UPDATE.

**Motivação:** 
- SELECT FOR UPDATE bloqueia conexões no MySQL, reduz throughput
- Conflitos de edição simultânea são raros em contexto de licitações (documentos têm donos bem definidos)
- Optimistic locking não bloqueia leitores
- Compatible com connection pooling

**Consequências:**
- Cliente precisa lidar com `OptimisticLockConflictError` e fazer retry
- O `expectedVersion` deve ser passado em todas as operações de escrita
