# Sprint 1.8 — Relatório Técnico

## Arquivos Modificados

### Migração
- `drizzle/0043_optimistic_locking_processes.sql` — campo `version INT NOT NULL DEFAULT 1`

### Schema
- `drizzle/schema.ts`: campo `version` em `processes`
- `server/bootstrap.ts`: safety net Sprint 1.8

### Domínio
- `server/domain/optimisticLock.ts` (ou similar): `assertVersion`, `OptimisticLockConflictError`

## Notas de Implementação

### assertVersion
```typescript
export function assertVersion(current: number, expected: number): void {
  if (current !== expected) {
    throw new OptimisticLockConflictError(current, expected);
  }
}
```

### Incremento automático
Todo `UPDATE` em `processes` deve incluir `version: current + 1`. O pattern foi documentado como padrão para todas as entidades futuras.
