/**
 * Data (AAAA-MM-DD, calendário de Brasília) do ATO OFICIAL de emissão. A `processo.dataEmissaoEdital` é materializada pelo ciclo de vida
 * NO MOMENTO da emissão (nunca na composição M1): instante oficial → data em America/Sao_Paulo. O M2 registra instante e data.
 */
const SP = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

export function issuanceDateOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`instante de emissão inválido: ${iso}`);
  return SP.format(d);
}
