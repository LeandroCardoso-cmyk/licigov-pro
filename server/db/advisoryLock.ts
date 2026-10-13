/**
 * Advisory lock NOMEADO sobre uma conexão DEDICADA (fora do pool) — Database Layer.
 *
 * Por que conexão dedicada: o lock vale por sessão; segurá-lo numa conexão do pool faria N chamadores concorrentes esgotarem o pool esperando o lock
 * enquanto quem o detém precisa de outra conexão para trabalhar (inanição). A conexão dedicada só carrega o lock; o trabalho usa o pool normal.
 * Serializa em escopo EXATO (o nome do lock); nenhum lock global entre escopos independentes.
 */
import mysql from "mysql2/promise";
import { withAdvisoryLock } from "./migrationLock";

export async function withDedicatedAdvisoryLock<T>(name: string, timeoutSeconds: number, fn: () => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida — advisory lock indisponível (falha fechada)");
  if (name.length === 0 || name.length > 64) throw new Error("nome de lock inválido (1..64 caracteres)");
  const connection = await mysql.createConnection(url);
  try {
    return await withAdvisoryLock(connection, name, timeoutSeconds, fn);
  } finally {
    await connection.end().catch(() => undefined);
  }
}
