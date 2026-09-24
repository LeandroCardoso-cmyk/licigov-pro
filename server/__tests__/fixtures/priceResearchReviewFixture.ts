/**
 * Fixture SANITIZADA da revisão por item da Pesquisa de Preços — 100% fictícia.
 *
 * Reproduz o CONTRATO do mapa de apuração homologado (5 itens lógicos · 30 cotações, distribuição 7/7/5/5/6,
 * médias 950,31 / 67,23 / 1.134,28 / 145,29 / 1.052,82, total 3.349,93) com linhas de staging no formato que o
 * parser layout-aware grava (uma linha por COTAÇÃO + rawMetadata.layout com a reconciliação da linha).
 * Sem órgão, município, processo real, fornecedor real, CNPJ, CPF ou nome de pessoa.
 */
import type { ReviewStagingRow, QuoteReviewStatus } from "../../domain/priceResearchReviewGroups";

export interface FixtureItem { description: string; unit: string; averageCents: number; offsets: number[] }

export const REVIEW_FIXTURE_ITEMS: FixtureItem[] = [
  { description: "PRODUTO FICTÍCIO ALFA — EMBALAGEM 200 L", unit: "Tambor", averageCents: 95031,  offsets: [-20000, -10000, 0, 10000, 20000, -5000, 5000] },
  { description: "UTENSÍLIO FICTÍCIO BETA 30 CM",           unit: "Un",     averageCents: 6723,   offsets: [-1500, -800, 0, 800, 1500, -300, 300] },
  { description: "PRODUTO FICTÍCIO GAMA — EMBALAGEM 200 L", unit: "Tambor", averageCents: 113428, offsets: [-5000, -2500, 0, 2500, 5000] },
  { description: "MATERIAL FICTÍCIO DELTA — FARDO 12 UN",   unit: "Fardo",  averageCents: 14529,  offsets: [-2000, -1000, 0, 1000, 2000] },
  { description: "PRODUTO FICTÍCIO ÉPSILON — EMBALAGEM 200 L", unit: "Tambor", averageCents: 105282, offsets: [-4000, -2000, -1000, 1000, 2000, 4000] },
];

export const REVIEW_FIXTURE_EXPECTED = {
  logicalItems: 5,
  quotes: 30,
  quotesPerItem: [7, 7, 5, 5, 6],
  averagesCents: [95031, 6723, 113428, 14529, 105282],
  totalCents: 334993,
} as const;

/** Fontes fictícias (colunas do mapa). */
export const FIXTURE_SOURCES = ["Fonte A", "Fonte B", "Fonte C", "Fonte D", "Fonte E", "Fonte F", "Fonte G"];

export function formatBRLText(cents: number): string {
  const reais = Math.floor(cents / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${reais},${String(cents % 100).padStart(2, "0")}`;
}

/**
 * Linhas de staging (ids crescentes na ordem do documento). `status` permite montar cenários de revisão mista;
 * `firstId` permite simular sessões/tenants diferentes.
 */
export function buildReviewFixtureRows(opts: { firstId?: number; status?: (id: number) => QuoteReviewStatus } = {}): ReviewStagingRow[] {
  const rows: ReviewStagingRow[] = [];
  let id = opts.firstId ?? 101;
  REVIEW_FIXTURE_ITEMS.forEach((item, idx) => {
    const layoutRow = idx + 3; // linhas 1-2 = cabeçalho no documento fictício
    item.offsets.forEach((offset, col) => {
      const cents = item.averageCents + offset;
      rows.push({
        id,
        rawDescription: item.description,
        rawQuantity: "1,00",
        rawUnit: item.unit,
        rawUnitPrice: formatBRLText(cents),
        rawTotalPrice: null,
        rawSupplier: FIXTURE_SOURCES[col],
        rawSource: null,
        rawMetadata: {
          layout: {
            version: "3", page: 1, tableIndex: 0, row: layoutRow, identifier: `I / 001 / 00${idx + 1}`,
            reconciliation: { row: layoutRow, validQuotes: item.offsets.length, calculatedAverageCents: item.averageCents, documentAverageCents: item.averageCents, averageMatches: true, calculatedTotalCents: item.averageCents },
          },
        },
        sourceLocation: { location: { page: 1, row: layoutRow, column: col + 4 }, parserType: "pdf", parserVersion: "2.3.0" },
        confidenceMetadata: { overallScore: 0.92, overallLevel: "high", requiresReview: false },
        extractionWarnings: [{ code: "LAYOUT_STACKED_CELLS", severity: "info", message: "Célula empilhada lida como subcoluna." }],
        reviewStatus: opts.status ? opts.status(id) : "pending",
        correctionRevision: 0,
        correctedPayload: null,
      });
      id += 1;
    });
  });
  return rows;
}
