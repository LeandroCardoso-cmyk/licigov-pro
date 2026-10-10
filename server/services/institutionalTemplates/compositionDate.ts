/**
 * Data (AAAA-MM-DD, calendário de Brasília) do EVENTO de composição governada. A `dataEmissaoEdital` é atribuída pelo sistema a
 * partir dela — a MESMA data na geração (M1), na revalidação e na emissão (M2): derivar de "hoje" faria a emissão em outro dia
 * parecer SOURCE_CHANGED. Nunca é digitada.
 */
const SP = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

export function compositionDateOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`instante de composição inválido: ${iso}`);
  return SP.format(d);
}
