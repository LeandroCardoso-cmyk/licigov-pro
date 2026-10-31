/**
 * Formatação SEGURA do erro tRPC devolvido ao cliente (pós-homologação, Frente B).
 *
 * Causa raiz: o `initTRPC` não definia `isDev`, e o tRPC usa `NODE_ENV !== "production"` como padrão — em staging (que usa
 * `APP_ENV`, sem `NODE_ENV=production`) a resposta trazia `data.stack`. Além disso, um erro NÃO-tRPC (driver SQL, I/O, bug)
 * é embrulhado pelo tRPC como `INTERNAL_SERVER_ERROR` com a MENSAGEM CRUA da causa (ex.: "Failed query: … params: …").
 *
 * Contrato (fora de development):
 *  - nunca `data.stack`;
 *  - erro interno NÃO intencional (embrulhado de uma exceção qualquer) ⇒ mensagem genérica com o correlationId;
 *  - preservados: `code`, `data.code`, `data.httpStatus`, `data.path` e as mensagens de TRPCError lançadas de propósito
 *    pelo servidor (validação, FORBIDDEN, CONFLICT, PRECONDITION_FAILED, tokens estáveis que o cliente interpreta);
 *  - `data.correlationId` sempre presente quando conhecido — é o elo com o log interno (que mantém o detalhe técnico).
 */
import { TRPCError } from "@trpc/server";

export const INTERNAL_ERROR_PUBLIC_MESSAGE = "Erro interno ao processar a solicitação.";

/** Exceção qualquer embrulhada pelo tRPC (não é um TRPCError lançado de propósito pelo servidor). */
export function isUnexpectedInternalError(error: TRPCError): boolean {
  if (error.code !== "INTERNAL_SERVER_ERROR") return false;
  const cause = error.cause;
  return cause instanceof Error && !(cause instanceof TRPCError) && error.message === cause.message;
}

export function publicInternalMessage(correlationId: string | null | undefined): string {
  return correlationId
    ? `${INTERNAL_ERROR_PUBLIC_MESSAGE} Informe ao suporte o código de correlação ${correlationId}.`
    : INTERNAL_ERROR_PUBLIC_MESSAGE;
}

interface ErrorShapeLike {
  message: string;
  code: number;
  data: Record<string, unknown>;
}

export function formatClientErrorShape<S extends ErrorShapeLike>(
  shape: S,
  error: TRPCError,
  opts: { correlationId?: string | null; exposeDiagnostics: boolean },
): S {
  const data: Record<string, unknown> = { ...shape.data };
  if (opts.correlationId) data.correlationId = opts.correlationId;
  if (opts.exposeDiagnostics) return { ...shape, data };
  delete data.stack;
  // Achado da auditoria: alguns `catch` de router convertem QUALQUER erro em 4xx repassando `e.message` — texto de banco é cortado aqui
  // também (código/status preservados; o cliente decide pelo `code`).
  const message = isUnexpectedInternalError(error) || carriesInternalDetail(error)
    ? publicInternalMessage(opts.correlationId) : shape.message;
  return { ...shape, message, data };
}

/**
 * Detalhe técnico para o LOG interno: sem parâmetros de consulta SQL, valores de chave duplicada nem e-mails (podem conter dados
 * pessoais) e com tamanho limitado.
 */
export function redactForLog(text: string | undefined, max = 2000): string | undefined {
  if (!text) return text;
  return text
    .replace(/(\bparams?\s*:)[^\n]*/gi, "$1 [redacted]")
    .replace(/(Duplicate entry )'[^'\n]*'/gi, "$1'[redacted]'")
    .replace(/(value: )'[^'\n]*'/gi, "$1'[redacted]'")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .slice(0, max);
}

/**
 * Mensagem que carrega texto de banco/driver (SQL, mensagens do servidor MySQL, códigos mysql2, conexão) — nunca vai ao cliente,
 * qualquer que seja o código tRPC. Catálogo das mensagens do servidor MySQL mais comuns em escrita/leitura (Revisão pré-merge #336).
 */
const DRIVER_LEAK = new RegExp([
  "Failed query:", "\\bER_[A-Z_]{3,}\\b", "\\b(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE)\\b", "\\bPROTOCOL_[A-Z_]+\\b",
  "Duplicate entry '", "You have an error in your SQL syntax",
  "Data too long for column", "a foreign key constraint fails", "Lock wait timeout exceeded", "Deadlock found when trying to get lock",
  "Column '[^']*' cannot be null", "Field '[^']*' doesn't have a default value", "Incorrect [a-z ]+ value:", "Out of range value for column",
  "Truncated incorrect", "Unknown column '", "Table '[^']*' doesn't exist", "Too many connections", "Access denied for user",
  "connection is in closed state", "Connection lost", "Packets out of order", "sqlMessage", "sqlState",
].join("|"));
export function looksLikeDriverLeak(message: string): boolean {
  return DRIVER_LEAK.test(message);
}

/** Erro do driver/ORM: mysql2 (`errno`/`sqlState`/`sqlMessage`) ou consulta do Drizzle ("Failed query:"). */
function isDriverError(e: unknown): e is Error & { sqlMessage?: string } {
  if (!(e instanceof Error)) return false;
  const d = e as Error & { errno?: unknown; sqlState?: unknown; sqlMessage?: unknown };
  return typeof d.errno === "number" || typeof d.sqlState === "string" || typeof d.sqlMessage === "string" || e.message.startsWith("Failed query:");
}

/** Erro do driver na cadeia de causa (até 5 níveis), se houver. */
export function driverErrorInChain(error: TRPCError): (Error & { sqlMessage?: string; code?: unknown }) | undefined {
  let current: unknown = error.cause;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (isDriverError(current)) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * A mensagem pública carrega detalhe interno de banco? Texto do catálogo acima OU o texto de um erro do driver da cadeia de causa
 * repassado na mensagem (`catch` que converte em 4xx com `e.message`). Mensagem de domínio que só TEM um erro de banco como causa,
 * sem repetir o texto dele, segue intacta (é funcional).
 */
export function carriesInternalDetail(error: TRPCError): boolean {
  if (looksLikeDriverLeak(error.message)) return true;
  const driver = driverErrorInChain(error);
  if (!driver) return false;
  return [driver.message, driver.sqlMessage].some((t) => typeof t === "string" && t.length > 0 && error.message.includes(t));
}
