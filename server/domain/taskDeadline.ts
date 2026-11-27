/**
 * PROMPT 08 / D-1 — prazo de tarefa do departamento. A coluna `tasks.deadline` é TIMESTAMP (Drizzle modo `date`): gravar a
 * string do formulário (`"2026-12-10"`) quebrava o INSERT (`value.toISOString is not a function` ⇒ 500). Este parser é a
 * fronteira única: aceita `Date` (superjson), data local `AAAA-MM-DD` ou data-hora ISO; ausência ⇒ `null` (prazo opcional);
 * inválido ⇒ recusa controlada. Data local = fim do dia em Brasília (America/Sao_Paulo, UTC−03:00 sem horário de verão), para o
 * prazo não "voltar" um dia ao ser exibido no fuso do órgão.
 */
export const TASK_DEADLINE_INVALID = "Prazo inválido — informe uma data no formato AAAA-MM-DD (entre 2000 e 2100).";

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type TaskDeadlineParse = { readonly ok: true; readonly value: Date | null } | { readonly ok: false; readonly message: string };

export function parseTaskDeadline(raw: unknown): TaskDeadlineParse {
  if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) return { ok: true, value: null };
  let d: Date | null = null;
  if (raw instanceof Date) d = raw;
  else if (typeof raw === "string") {
    const s = raw.trim();
    const m = LOCAL_DATE.exec(s);
    if (m) {
      const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const probe = new Date(Date.UTC(y, mo - 1, da));
      if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== da) return { ok: false, message: TASK_DEADLINE_INVALID };
      if (y < 2000 || y > 2100) return { ok: false, message: TASK_DEADLINE_INVALID };
      d = new Date(`${s}T23:59:59.000-03:00`);
    } else if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
      d = new Date(s);
    }
  }
  if (!d || Number.isNaN(d.getTime())) return { ok: false, message: TASK_DEADLINE_INVALID };
  const year = d.getUTCFullYear();
  if (year < 2000 || year > 2100) return { ok: false, message: TASK_DEADLINE_INVALID };
  return { ok: true, value: d };
}
