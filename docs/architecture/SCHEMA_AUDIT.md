# Auditoria de schema — Drizzle × banco real

Ferramenta de leitura para detectar **drift de schema** entre o que o código declara (Drizzle,
`drizzle/schema.ts`) e o que existe de fato no banco (produção/staging). Motivada por uma sequência
de falhas em runtime causadas por divergências (migration `0284` ausente/malformada; colunas de
`organizations`/consultas divergentes).

## O que detecta

- **Tabelas** declaradas no Drizzle que **não existem** no banco → causa `Table doesn't exist`.
- **Colunas** declaradas no Drizzle que **não existem** na tabela → causa `Unknown column`.

Essas são exatamente as divergências que quebram queries em produção mesmo com os testes verdes
(a suíte usa repositórios in-memory).

## Como rodar

```bash
DATABASE_URL="mysql://usuario:senha@host:3306/licigov" pnpm db:audit
```

- **Somente leitura** (consulta `INFORMATION_SCHEMA`); não altera o banco.
- Código de saída: `0` alinhado · `1` divergências encontradas (útil como gate) · `2` erro de execução.
- Rode apontando para **produção** e para **staging** — o drift costuma estar em produção (bancos
  criados por versões antigas / `db:push` sem todas as migrations).

## Interpretando o resultado

- **Tabela ausente** → falta rodar a migration que a cria (ou o `ensureSchema` do bootstrap).
- **Coluna ausente** → falta a migration de `ALTER TABLE ADD COLUMN` correspondente, ou a tabela foi
  criada por uma versão anterior do schema.

**Ação recomendada:** alinhar o banco ao Drizzle rodando as migrations pendentes (`drizzle-kit`),
ou gerar a migration faltante. Nunca usar `db:push --force` em produção sem revisar o diff.

## Limitações (escopo atual)

- Compara **presença** de tabelas/colunas (a causa das falhas observadas). Não compara ainda tipo,
  nullability, defaults ou índices — evolução futura, se necessário.
- Colunas existentes no banco e **não** declaradas no Drizzle são ignoradas (informativas, não quebram).
