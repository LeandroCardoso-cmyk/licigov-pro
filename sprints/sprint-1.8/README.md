# Sprint 1.8 — Preparação Core Documental

**Status:** Concluída  
**Data:** Maio 2026  
**Impacto:** Fundação para concorrência otimista no core documental

---

## Objetivo

Preparar a infraestrutura de concorrência otimista necessária para o core documental da Sprint 2, evitando conflitos de edição simultânea em processos licitatórios.

## Entregas

### Optimistic Locking em Processes
- Campo `version INT NOT NULL DEFAULT 1` adicionado à tabela `processes`
- `assertVersion(currentVersion, expectedVersion)` — lança `OptimisticLockConflictError` se versão diverge
- Incremento automático de versão em cada atualização

### Padrão Estabelecido
```typescript
// Toda operação de escrita em entidade com version:
await assertVersion(process.version, params.expectedVersion);
await db.update(processes).set({ ...data, version: process.version + 1 });
```

## Migração
- `0043_optimistic_locking_processes.sql`

## Impacto Arquitetural

Estabeleceu o **padrão de optimistic locking** que seria replicado para documentos na Sprint 2. Previne lost updates em ambiente multi-usuário sem locks pessimistas no banco.
