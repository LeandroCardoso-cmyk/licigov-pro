/**
 * Homologação visual M8 — lacunas factuais listadas fora do texto.
 *
 * Extrai os marcadores `[REVISAR: …]` do rascunho e os associa à seção (último título acima), para o servidor
 * resolver as pendências sem caçá-las no texto. Puro e só de leitura: não altera o conteúdo nem a contagem
 * oficial (a emissão continua revalidada no backend).
 */
export type FactualGap = { section: string | null; text: string };

const HEADING = /^\s*(?:#{1,6}\s+(.+?)|\*\*(.+?)\*\*)\s*$/;
const MARKER = /\[REVISAR:\s*([^\]]+)\]/g;

export function listFactualGaps(content: string | null | undefined): FactualGap[] {
  if (!content) return [];
  const gaps: FactualGap[] = [];
  let section: string | null = null;
  for (const line of content.split(/\r?\n/)) {
    const h = HEADING.exec(line);
    if (h) section = (h[1] ?? h[2] ?? "").replace(MARKER, "").trim() || section;
    for (const m of Array.from(line.matchAll(MARKER))) gaps.push({ section, text: m[1].trim() });
  }
  return gaps;
}
