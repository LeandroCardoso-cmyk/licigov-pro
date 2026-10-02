# Formatador monetário único e rótulo pelo significado (R6 / PR-14 · SEM-012 · INV-16)

> Estado: **IMPLEMENTED_LOCAL / TESTED_LOCAL**. Não mergeado, não implantado.

- **Única função**: `formatCentsBRL` em `shared/money.ts` (cliente via `@/lib/money`, servidor via `formatBRL`
  de `server/domain/money.ts`, que delega). Entrada sempre em **centavos inteiros**; determinístico, sem locale.
- **Rótulos** (`MONEY_MEANING`): Valor estimado · Valor de referência · Valor adjudicado · Valor contratado.
- Corrigido (antes exibiam centavos como reais, 100×): relatório de auditoria da Contratação Direta
  (`directContractAuditReport`), relatório de processo (`processReportService`, que também imprimia `doc.status`
  inexistente — agora `documentStatus`), analytics (`MetricsGrid`, `ChartsSection`, `RankingTables`).
- KPI do analytics: **"Valor estimado (em curso e concluídas)"** = `getEstimatedActiveValueCents`
  (`server/db/directContractsValueKpi.ts`), exclui `draft` e `cancelled`, tenant-scoped. `totalValue` bruto permanece
  no payload por compatibilidade, sem ser exibido como "contratado".
- Testes: `pr14-money-formatter-mysql-smoke` (formatador, guarda estática das superfícies, KPI no MySQL 8).
- Pendência humana/produção: **R2.3** (uso real de `direct_contracts` — leitura read-only não executada) decide se
  essas saídas legadas serão redirecionadas/retiradas (CUTOVER) além da correção aplicada.
