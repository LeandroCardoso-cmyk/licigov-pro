# Release Snapshots

Snapshots de estado do sistema em momentos de release importante.

## Formato de Snapshot

```
snapshot-v{versao}-{data}/
├── schema.sql          # dump do schema naquele momento
├── migrations-applied  # lista de migrações aplicadas
└── test-results.txt    # saída dos testes
```

## Snapshots Disponíveis

Esta pasta será populada a cada release aprovada para produção.

## Como Criar um Snapshot

```bash
# Schema
mysqldump -h HOST -u USER -p --no-data DBNAME > schema.sql

# Migrations aplicadas
cat drizzle/meta/_journal.json | jq '.entries[].tag'

# Testes
pnpm vitest run > test-results.txt 2>&1
```
