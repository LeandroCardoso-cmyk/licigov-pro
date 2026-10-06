/**
 * Institutional Templates — executor, transação e detecção de erros do MySQL.
 *
 * ESCRITAS exigem uma TRANSAÇÃO (`TemplatesTx`): a validação das referências a tabelas existentes (HD-26) e a escrita da
 * relação acontecem na MESMA transação — o tipo impede passar a conexão solta. LEITURAS aceitam conexão ou transação.
 */
import { getDb } from "../connection";
import { runTransactionWithDeadlockRetry } from "../../services/transactionDeadlockRetry";
import { TemplatePersistenceError } from "./errors";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type TemplatesTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type TemplatesReader = Db | TemplatesTx;

/** Contexto institucional AUTORITATIVO (vem da sessão/serviço, nunca de input livre do cliente). */
export interface TemplatesContext {
  readonly organizationId: number;
  readonly actorUserId: number;
  readonly correlationId: string;
}

/**
 * Abre UMA transação, repetida inteira em caso de deadlock (SEM084-A). Quem já é dono de uma transação (ex.: a promoção
 * oficial) NÃO usa isto: passa o seu `tx` diretamente às funções dos repositórios.
 */
export async function withTemplatesTransaction<T>(
  label: string,
  ctx: Pick<TemplatesContext, "organizationId" | "correlationId">,
  fn: (tx: TemplatesTx) => Promise<T>,
): Promise<T> {
  const db = await getDb();
  if (!db) throw new TemplatePersistenceError("DB_UNAVAILABLE", "banco indisponível: escrita de modelos institucionais recusada");
  return runTransactionWithDeadlockRetry(
    { label, organizationId: ctx.organizationId, correlationId: ctx.correlationId },
    () => db.transaction(async (tx) => fn(tx)),
  );
}

export async function requireReader(executor?: TemplatesReader): Promise<TemplatesReader> {
  if (executor) return executor;
  const db = await getDb();
  if (!db) throw new TemplatePersistenceError("DB_UNAVAILABLE", "banco indisponível");
  return db;
}

interface MysqlErrorLike { code?: unknown; errno?: unknown; sqlState?: unknown; message?: unknown; cause?: unknown }

function walk(err: unknown): MysqlErrorLike[] {
  const out: MysqlErrorLike[] = [];
  let x: unknown = err;
  for (let i = 0; i < 5 && x && typeof x === "object"; i++) {
    out.push(x as MysqlErrorLike);
    x = (x as MysqlErrorLike).cause;
  }
  return out;
}

/** ER_DUP_ENTRY (1062), inclusive encapsulado pelo driver/Drizzle. */
export function isDuplicateKey(err: unknown): boolean {
  return walk(err).some((e) => e.code === "ER_DUP_ENTRY" || e.errno === 1062);
}

/** Nome da chave violada em um ER_DUP_ENTRY ("<tabela>.<chave>" → "<chave>"); `null` se não identificável. */
export function duplicateKeyName(err: unknown): string | null {
  for (const e of walk(err)) {
    if (e.code !== "ER_DUP_ENTRY" && e.errno !== 1062) continue;
    const m = /for key '([^']+)'/.exec(String(e.message ?? ""));
    if (m) return m[1].split(".").pop() ?? null;
  }
  return null;
}

/** Violação de FK: filho sem pai (1452) ou pai referenciado por filho (1451). */
export function isForeignKeyViolation(err: unknown): boolean {
  return walk(err).some((e) => e.code === "ER_NO_REFERENCED_ROW_2" || e.code === "ER_ROW_IS_REFERENCED_2" || e.errno === 1452 || e.errno === 1451);
}

export function affectedRows(result: unknown): number {
  const header = (Array.isArray(result) ? result[0] : result) as { affectedRows?: number } | undefined;
  return header?.affectedRows ?? 0;
}
