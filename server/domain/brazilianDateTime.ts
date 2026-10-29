/** Rótulo de data/hora institucional pt-BR — puro (sem I/O). Usado pelos exportadores e pelo Document Engine. */
/**
 * Formata um instante UTC no padrão institucional brasileiro
 * ("26/07/2026 às 21:45"), convertendo APENAS na apresentação (timezone
 * America/Sao_Paulo). Não altera o armazenamento interno (UTC).
 */
export function formatBrazilianDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} às ${get("hour")}:${get("minute")}`;
}
