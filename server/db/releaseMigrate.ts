/**
 * V1 PRE-PILOT CLOSURE — Fase B (RUNTIME & RELEASE SAFETY).
 *
 * Aplicação de migrations VERSIONADAS com lock de exclusão mútua (replay/concorrência).
 * É o único mecanismo permitido de mudança de schema em staging/produção. NÃO faz seed,
 * NÃO faz `db:push`, NÃO reconcilia schema de forma mutável, NÃO inicia a aplicação.
 *
 * Concorrência: duas execuções simultâneas (dois deploys, duas réplicas subindo juntas)
 * não podem aplicar migrations ao mesmo tempo. Usamos o advisory lock nativo do MySQL
 * (`GET_LOCK`/`RELEASE_LOCK`) — por-sessão, com timeout limitado e liberação garantida no
 * `finally`. O próprio ledger do Drizzle (`__drizzle_migrations`) é a fonte de idempotência:
 * migrations já aplicadas não são reaplicadas. Não construímos um segundo ledger.
 */
import path from "path";
import type mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";

/** process.cwd() é a raiz do projeto no Railway e no dev local (independente do bundling). */
export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

/** Nome do advisory lock. Estável — a mesma string precisa ser usada por todos os executores. */
export const MIGRATION_LOCK_NAME = "licigov_pro_migrate_release";

/** Timeout de aquisição do lock (s). Curto o bastante para falhar rápido; longo o bastante para uma release real terminar. */
export const MIGRATION_LOCK_TIMEOUT_SECONDS = 120;

type LogFn = (msg: string) => void;
const noop: LogFn = () => {};

/**
 * Aplica todas as migrations pendentes sob advisory lock. Idempotente (ledger do Drizzle).
 * Lança se o lock não puder ser obtido no timeout ou se qualquer migration falhar — o erro
 * NÃO é engolido (o chamador decide o exit code). Nunca loga DATABASE_URL/segredos/SQL.
 */
export async function migrateWithAdvisoryLock(
  connection: mysql.Connection,
  log: LogFn = noop,
): Promise<void> {
  log(`Adquirindo lock de migração '${MIGRATION_LOCK_NAME}' (timeout ${MIGRATION_LOCK_TIMEOUT_SECONDS}s)…`);
  const [lockRows] = await connection.query<RowDataPacket[]>(
    "SELECT GET_LOCK(?, ?) AS ok",
    [MIGRATION_LOCK_NAME, MIGRATION_LOCK_TIMEOUT_SECONDS],
  );
  const acquired = Number((lockRows[0] as { ok: number | null }).ok);
  if (acquired !== 1) {
    throw new Error(
      `Não foi possível obter o lock de migração '${MIGRATION_LOCK_NAME}' em ${MIGRATION_LOCK_TIMEOUT_SECONDS}s ` +
        `(outra aplicação de migrations em andamento?). Nenhuma migration foi aplicada.`,
    );
  }
  try {
    log("Lock obtido. Aplicando migrations versionadas…");
    const db = drizzle(connection);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    log("Migrations aplicadas (ou já em dia).");
  } finally {
    // Liberação garantida — mesmo em erro. RELEASE_LOCK é seguro mesmo se o lock já caiu.
    await connection.query("SELECT RELEASE_LOCK(?) AS released", [MIGRATION_LOCK_NAME]);
    log("Lock de migração liberado.");
  }
}
