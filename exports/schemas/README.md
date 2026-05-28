# Exports — Schemas

Schemas exportados do banco de dados para documentação e referência.

## Conteúdo

- Schema SQL completo em momentos de release
- Schema Drizzle tipado
- ERDs (Entity Relationship Diagrams)

## Geração

```bash
# Schema SQL completo
mysqldump -h HOST -u USER -p --no-data DBNAME > exports/schemas/schema-v0.8.0.sql

# Lista de tabelas e colunas
mysql -h HOST -u USER -p DBNAME -e "
  SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
  ORDER BY TABLE_NAME, ORDINAL_POSITION
" > exports/schemas/columns-v0.8.0.csv
```
