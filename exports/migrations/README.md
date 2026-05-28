# Exports — Migrations

Arquivo de migrações aplicadas em produção.

## Migrações por Versão

| Versão | Migrações | Data |
|--------|-----------|------|
| v0.8.0 | 0054, 0055 | Maio 2026 |
| v0.5.0 | 0050–0053 | Maio 2026 |
| v0.2.0 | 0044–0049 | Maio 2026 |
| v0.1.8 | 0043 | Maio 2026 |
| v0.1.5 | 0039–0042 | Maio 2026 |
| v0.1.0 | 0033–0038 | Maio 2026 |

## Source de Verdade

O arquivo `drizzle/meta/_journal.json` é a fonte da verdade para migrações aplicadas.

## Rollback

Drizzle não suporta rollback automático de migrations. Rollbacks devem ser feitos manualmente com scripts de reversão.
