# Exports — Snapshots

Snapshots de estado do sistema em momentos críticos.

## Quando Criar Snapshots

- Antes de migração de grande impacto
- Em cada release de produção
- Antes de operação de manutenção

## Formato de Snapshot

```
snapshot-YYYY-MM-DD-vX.Y.Z/
├── schema.sql              # Schema completo
├── journal.json            # Cópia do drizzle/meta/_journal.json
└── test-summary.txt        # Resumo dos testes
```

## Como Criar

```bash
SNAPSHOT_DATE=$(date +%Y-%m-%d)
SNAPSHOT_DIR="exports/snapshots/snapshot-${SNAPSHOT_DATE}-v0.8.0"
mkdir -p $SNAPSHOT_DIR

# Schema
mysqldump --no-data $DB > $SNAPSHOT_DIR/schema.sql

# Journal
cp drizzle/meta/_journal.json $SNAPSHOT_DIR/journal.json

# Testes
pnpm vitest run --reporter=verbose 2>&1 | tail -20 > $SNAPSHOT_DIR/test-summary.txt
```
