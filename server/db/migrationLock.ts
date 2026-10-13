/**
 * Exclusão mútua das migrations versionadas via advisory lock NATIVO do MySQL (`GET_LOCK`, por sessão, válido entre processos).
 *
 * Mesmo lock do passo de RELEASE (`releaseMigrate.ts`): o nome precisa ser idêntico para que release e `runMigrations` (usada pelos smokes
 * MySQL, que constroem o schema num banco real) se excluam mutuamente. Arquivo próprio para que `bootstrap.ts` NÃO importe o runner de release
 * (o boot só valida schema; migrações são o passo de release — guarda em `pr-b-runtime-release-safety.test.ts`).
 *
 * Causa-raiz que motivou o lock em `runMigrations`: arquivos de teste concorrentes (workers do vitest) sobre um banco AINDA NÃO migrado
 * executavam `migrate()` ao mesmo tempo ⇒ `CREATE TABLE` duplicado (`ER_TABLE_EXISTS_ERROR`). Na CI o banco é migrado antes pelo release
 * (`db:migrate:release`), por isso a corrida nunca aparecia lá.
 */
import type mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";

export const MIGRATION_LOCK_NAME = "licigov_pro_migrate_release";
export const MIGRATION_LOCK_TIMEOUT_SECONDS = 120;

/** Executa `fn` sob o advisory lock de migração (liberação garantida). Lança se o lock não for obtido no prazo. */
export async function withMigrationLock<T>(connection: mysql.Connection, fn: () => Promise<T>): Promise<T> {
  const [rows] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK(?, ?) AS ok", [MIGRATION_LOCK_NAME, MIGRATION_LOCK_TIMEOUT_SECONDS]);
  if (Number((rows[0] as { ok: number | null }).ok) !== 1) {
    throw new Error(`Não foi possível obter o lock de migração '${MIGRATION_LOCK_NAME}' em ${MIGRATION_LOCK_TIMEOUT_SECONDS}s. Nenhuma migration foi aplicada.`);
  }
  try {
    return await fn();
  } finally {
    await connection.query("SELECT RELEASE_LOCK(?) AS released", [MIGRATION_LOCK_NAME]);
  }
}
