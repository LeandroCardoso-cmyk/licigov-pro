# Versioning Policy — LiciGov Pro

## Schema de Versão

`MAJOR.MINOR.PATCH`

| Componente | Quando incrementar |
|------------|-------------------|
| MAJOR | Breaking change de API, migração destrutiva, mudança de contrato |
| MINOR | Nova sprint com novas funcionalidades (Sprint 1=0.1, Sprint 2=0.2...) |
| PATCH | Hotfix, correção de bug, ajuste de configuração |

## Mapeamento Sprint → Versão

| Sprint | Versão |
|--------|--------|
| Sprint 1 | 0.1.0 |
| Sprint 1.5 | 0.1.5 |
| Sprint 1.8 | 0.1.8 |
| Sprint 2 | 0.2.0 |
| Sprint 2.5 | 0.5.0 |
| Sprint 2.8 | 0.8.0 |
| Sprint 3 | 0.3.0 → 1.0.0 (candidato a release público) |

## Database Migrations

- Migrações são incrementais e **irreversíveis** por design
- `drizzle/meta/_journal.json` é a fonte da verdade
- Numeração: `0054_descricao_snake_case.sql`
- Nunca modificar migração já aplicada em produção

## Tags de Release

```bash
git tag v0.8.0 -m "feat: Sprint 2.8 — Import Foundation Layer"
git push origin v0.8.0
```

Tags criadas após merge em main.
