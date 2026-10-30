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
  const message = isUnexpectedInternalError(error) || looksLikeDriverLeak(shape.message)
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
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .slice(0, max);
}

/** Mensagem que carrega texto de banco/driver (SQL, código mysql2, conexão) — nunca vai ao cliente, qualquer que seja o código tRPC. */
const DRIVER_LEAK = /Failed query:|\bER_[A-Z_]{3,}\b|\bECONNREFUSED\b|\bETIMEDOUT\b|\bPROTOCOL_[A-Z_]+\b|Duplicate entry '|You have an error in your SQL syntax/;
export function looksLikeDriverLeak(message: string): boolean {
  return DRIVER_LEAK.test(message);
}
