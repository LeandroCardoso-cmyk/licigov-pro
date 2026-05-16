const DATE_LOCALE = "pt-BR";
const CURRENCY_LOCALE = "pt-BR";

export function formatDate(
  date: Date | string | null | undefined,
  options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" }
): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString(DATE_LOCALE, options);
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleString(DATE_LOCALE, {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function formatCurrency(valueInCents: number | null | undefined): string {
  if (valueInCents == null) return "R$ 0,00";
  return (valueInCents / 100).toLocaleString(CURRENCY_LOCALE, {
    style: "currency",
    currency: "BRL",
  });
}

export function formatCurrencyRaw(value: number | null | undefined): string {
  if (value == null) return "R$ 0,00";
  return value.toLocaleString(CURRENCY_LOCALE, { style: "currency", currency: "BRL" });
}

export function formatRelativeDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0) return "Hoje";
  if (diffDays === 1) return "Ontem";
  if (diffDays < 7) return `${diffDays} dias atrás`;
  return formatDate(d);
}

export function formatMonthYear(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString(DATE_LOCALE, { month: "short", year: "numeric" });
}
