/**
 * Advisory lock NOMEADO sobre uma conexão DEDICADA (fora do pool) — Database Layer.
 *
 * Por que conexão dedicada: o lock vale por sessão; segurá-lo numa conexão do pool faria N chamadores concorrentes esgotarem o pool esperando o lock
 * enquanto quem o detém precisa de outra conexão para trabalhar (inanição). A conexão dedicada só carrega o lock; o trabalho usa o pool normal.
 * Serializa em escopo EXATO (o nome do lock); nenhum lock global entre escopos independentes.
 *
 * LIMITE HONESTO (o que este lock NÃO garante): o lock pertence à SESSÃO dedicada. Se essa sessão morrer (rede, failover, KILL, restart), o MySQL libera o
 * lock e o callback — que escreve por OUTRAS conexões — pode continuar enquanto outro executor o adquire. Não existe como o cliente provar, no instante de
 * uma escrita, que ainda é o dono (verificar e escrever não são atômicos). Por isso:
 *  1. o lock é otimização de serialização/ruído, NÃO a garantia de integridade; a garantia está na escrita transacional do chamador (ver
 *     `insertDraftRevisionUnique`: linha da identidade FOR UPDATE + checagem do hash na MESMA transação do INSERT);
 *  2. o callback recebe `held.assertHeld()` e DEVE chamá-lo antes de cada fase de escrita: sessão morta ou lock de outro dono ⇒ `AdvisoryLockLostError`
 *     (falha fechada, logada), reduzindo a janela — nunca a eliminando sozinho;
 *  3. o nome do lock inclui a identidade do BANCO (`DATABASE()`): bancos distintos no mesmo mysqld não disputam o mesmo lock;
 *  4. falha de RELEASE_LOCK depois de `fn` concluir NÃO mascara o resultado (o servidor libera com a sessão).
 */
import { createHash } from "node:crypto";
import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { withAdvisoryLock } from "./migrationLock";

/** O lock deixou de pertencer a esta sessão (sessão encerrada ou lock com outro dono) durante o trabalho do callback. */
export class AdvisoryLockLostError extends Error {
  constructor(readonly lockName: string, readonly reason: string) {
    super(`o advisory lock '${lockName}' foi perdido (${reason}); a operação foi interrompida antes de novas escritas`);
    this.name = "AdvisoryLockLostError";
  }
}

export interface HeldLock {
  /** Nome EFETIVO (namespaced) do lock no servidor. */
  readonly name: string;
  /** Falha com `AdvisoryLockLostError` se esta sessão não é mais a dona do lock (inclui sessão morta). */
  assertHeld(): Promise<void>;
}

export interface AdvisoryLockHooks {
  onLockLost?(info: { lockName: string; reason: string }): void;
  onReleaseFailed?(err: unknown): void;
}

/** Prefixo do namespace: 'lg' + 12 hex da identidade do banco + '_' (15 caracteres) ⇒ nomes lógicos de até 49 caracteres cabem nos 64 do MySQL. */
const NAMESPACE_LENGTH = 15;
export const MAX_LOGICAL_LOCK_NAME = 64 - NAMESPACE_LENGTH;

/** Nome efetivo do lock: identidade do banco + nome lógico (determinístico; ≤ 64). */
export function namespacedLockName(databaseName: string, logicalName: string): string {
  if (logicalName.length === 0 || logicalName.length > MAX_LOGICAL_LOCK_NAME) throw new Error(`nome de lock inválido (1..${MAX_LOGICAL_LOCK_NAME} caracteres)`);
  return `lg${createHash("sha256").update(databaseName).digest("hex").slice(0, 12)}_${logicalName}`;
}

/** Executa `fn` sob o lock numa conexão JÁ aberta (a conexão é só do lock). Exportada para testes com conexão controlada. */
export async function withHeldAdvisoryLock<T>(
  connection: mysql.Connection, logicalName: string, timeoutSeconds: number, fn: (held: HeldLock) => Promise<T>, hooks: AdvisoryLockHooks = {},
): Promise<T> {
  let sessionError: unknown = null;
  // um 'error' sem ouvinte derrubaria o processo quando o servidor mata a sessão; aqui ele vira estado verificável por `assertHeld`.
  connection.on("error", (err: unknown) => { sessionError = err; });
  const [dbRows] = await connection.query<RowDataPacket[]>("SELECT DATABASE() AS db");
  const lockName = namespacedLockName(String((dbRows[0] as { db: string | null }).db ?? ""), logicalName);
  const held: HeldLock = {
    name: lockName,
    async assertHeld() {
      const lost = (reason: string): never => { hooks.onLockLost?.({ lockName, reason }); throw new AdvisoryLockLostError(lockName, reason); };
      if (sessionError) lost("sessão do lock encerrada");
      let owns = false;
      try {
        const [rows] = await connection.query<RowDataPacket[]>("SELECT IS_USED_LOCK(?) = CONNECTION_ID() AS held", [lockName]);
        owns = Number((rows[0] as { held: number | null }).held) === 1;
      } catch {
        lost("sessão do lock indisponível");
      }
      if (!owns) lost("o lock não pertence mais a esta sessão");
    },
  };
  return withAdvisoryLock(connection, lockName, timeoutSeconds, () => fn(held), hooks.onReleaseFailed);
}

export async function withDedicatedAdvisoryLock<T>(name: string, timeoutSeconds: number, fn: (held: HeldLock) => Promise<T>, hooks: AdvisoryLockHooks = {}): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida — advisory lock indisponível (falha fechada)");
  if (name.length === 0 || name.length > MAX_LOGICAL_LOCK_NAME) throw new Error(`nome de lock inválido (1..${MAX_LOGICAL_LOCK_NAME} caracteres)`);
  const connection = await mysql.createConnection(url);
  try {
    return await withHeldAdvisoryLock(connection, name, timeoutSeconds, fn, hooks);
  } finally {
    await connection.end().catch(() => connection.destroy());
  }
}
