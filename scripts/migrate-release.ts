/**
 * V1 PRE-PILOT CLOSURE — Fase B — comando canônico de RELEASE de migrations.
 *
 * Uso:  pnpm db:migrate:release
 *
 * Aplica APENAS migrations versionadas (drizzle/*.sql) contra `MIGRATION_DATABASE_URL` (conta com DDL)
 * ou, se ausente, `DATABASE_URL`, sob advisory
 * lock (replay/concorrência-safe via server/db/releaseMigrate.ts). É o passo de RELEASE do
 * ciclo de deploy — projetado para rodar ANTES do start da aplicação (futuramente no Railway
 * Pre-Deploy Command; ver docs/ops/MIGRATION_RELEASE_RUNBOOK.md).
 *
 * Contrato:
 *   - só migrations versionadas (nunca `db:push`, nunca reconciliação mutável, nunca seed);
 *   - idempotente (ledger `__drizzle_migrations` do Drizzle);
 *   - NÃO inicia a aplicação;
 *   - falha (exit != 0) se qualquer migration falhar ou se o lock não for obtido — o erro
 *     nunca é engolido;
 *   - NÃO loga `DATABASE_URL`, senha, SQL sensível nem segredos.
 */
import mysql from "mysql2/promise";
import { migrateWithAdvisoryLock } from "../server/db/releaseMigrate";

function log(msg: string): void {
  console.info(`[RELEASE][migrate] ${msg}`);
}

/**
 * SEC-AUD-2026-10 — conta de banco SEPARADA para migrations. Só este passo precisa de DDL
 * (CREATE/ALTER/DROP/INDEX/REFERENCES/CREATE ROUTINE); o runtime e o reference data (DML) usam
 * `DATABASE_URL`. Se `MIGRATION_DATABASE_URL` estiver definida, as migrations usam ela; senão,
 * mantêm o comportamento anterior (`DATABASE_URL`). Retorna só o NOME da variável escolhida.
 */
export function resolveMigrationDatabaseUrl(
  env: Record<string, string | undefined>,
): { url: string; source: "MIGRATION_DATABASE_URL" | "DATABASE_URL" } | null {
  const dedicated = env.MIGRATION_DATABASE_URL?.trim();
  if (dedicated) return { url: dedicated, source: "MIGRATION_DATABASE_URL" };
  const shared = env.DATABASE_URL?.trim();
  if (shared) return { url: shared, source: "DATABASE_URL" };
  return null;
}

export async function main(): Promise<void> {
  const resolved = resolveMigrationDatabaseUrl(process.env);
  if (!resolved) {
    // Nunca imprime o valor — apenas a ausência.
    throw new Error("DATABASE_URL não definida — impossível aplicar migrations de release.");
  }
  const databaseUrl = resolved.url;

  const startedAt = Date.now();
  log(`Iniciando release de migrations (conexão: ${resolved.source})…`);
  const connection = await mysql.createConnection(databaseUrl);
  try {
    await migrateWithAdvisoryLock(connection, log);
  } finally {
    await connection.end();
  }
  log(`Release de migrations concluída em ${Date.now() - startedAt}ms.`);
}

// Só executa quando invocado como script (não quando importado por um teste).
const invokedDirectly =
  typeof process.argv[1] === "string" && /migrate-release(\.ts|\.js|\.mts)?$/.test(process.argv[1]);

if (invokedDirectly) {
  main()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[RELEASE][migrate] FALHA: ${message}`);
      process.exit(1);
    });
}
