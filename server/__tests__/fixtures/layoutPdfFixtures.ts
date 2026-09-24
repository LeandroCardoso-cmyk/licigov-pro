/**
 * Fixtures de PDF com LAYOUT tabular real (geradas em tempo de teste com pdfkit — nenhum binário no Git).
 *
 * GOLDEN E — "mapa de apuração multiprovedor": reproduz a GEOMETRIA de um mapa de apuração de preços real
 * (título, identificação institucional, cabeçalhos verticais por fonte, linha "R$", descrições multilinha com
 * preços centralizados verticalmente, células "/////" descartadas, média aritmética, valor total, percentual,
 * linha de total, rodapé e página adicional de assinatura sem itens). TODO o conteúdo é FICTÍCIO/SANITIZADO:
 * nenhum nome de órgão, município, fornecedor, pessoa, CPF ou CNPJ real.
 *
 * Contrato: 5 itens · 30 cotações válidas · médias 950,31 / 67,23 / 1.134,28 / 145,29 / 1.052,82 ·
 * total 3.349,93.
 */
import PDFDocument from "pdfkit";

function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

export const PLACEHOLDER = "/////";

export interface MapItem { description: string; unit: string; quantity: string; quotes: string[]; average: string; total: string; diff: string }
export interface MapSpec {
  institution: string[];
  title: string;
  preamble: string[];
  groupHeader: string | null;
  sources: string[];
  items: MapItem[];
  totalLabel: string;
  total: string;
  footer: string[];
  /** Página adicional SEM itens (identificação, assinatura, rodapé). */
  signaturePage: string[] | null;
  /** Cabeçalhos das fontes em texto VERTICAL (rotacionado) como nos mapas reais. */
  verticalSources: boolean;
  /** "R$" em linha própria sob os cabeçalhos das colunas de valor. */
  currencyRow: boolean;
  /** Preço centralizado verticalmente na célula (descrição multilinha) — senão alinhado ao topo. */
  centerValues: boolean;
  /** Espaço interno das células (0 = tabela densa, sem respiro entre itens). */
  cellPadding: number;
  /** Largura da coluna de descrição (força a quebra em várias linhas). */
  descriptionWidth: number;
  /** Largura de cada coluna de fonte. */
  sourceWidth: number;
  drawGrid: boolean;
}

export const GOLDEN_E_ITEMS: MapItem[] = [
  {
    description: "ÓLEO LUBRIFICANTE PARA MOTOR DIESEL SAE 15W40, CLASSIFICAÇÃO API CI-4, EMBALAGEM TAMBOR COM 200 LITROS",
    unit: "Tambor", quantity: "1,00",
    quotes: ["920,00", "985,50", "948,90", PLACEHOLDER, "1.010,00", "899,77", "935,00", "953,00"],
    average: "950,31", total: "950,31", "diff": "12,25%",
  },
  {
    description: "GRAXA LUBRIFICANTE À BASE DE SABÃO DE LÍTIO, CONSISTÊNCIA NLGI 2, POTE COM 1 KG",
    unit: "Un", quantity: "1,00",
    quotes: ["65,90", "69,00", PLACEHOLDER, "66,50", "68,20", "64,03", "70,00", "67,00"],
    average: "67,23", total: "67,23", diff: "9,33%",
  },
  {
    description: "ÓLEO HIDRÁULICO ISO VG 68, ANTIDESGASTE, EMBALAGEM TAMBOR COM 200 LITROS",
    unit: "Tambor", quantity: "1,00",
    quotes: ["1.120,00", PLACEHOLDER, "1.150,00", PLACEHOLDER, "1.098,40", PLACEHOLDER, "1.163,00", "1.140,00"],
    average: "1.134,28", total: "1.134,28", diff: "5,88%",
  },
  {
    description: "PANO DE LIMPEZA INDUSTRIAL EM ALGODÃO, ALTA ABSORÇÃO, FARDO COM 10 KG",
    unit: "Fardo", quantity: "1,00",
    quotes: ["140,00", "150,46", PLACEHOLDER, "146,00", PLACEHOLDER, "142,00", "148,00", PLACEHOLDER],
    average: "145,29", total: "145,29", diff: "7,47%",
  },
  {
    description: "ÓLEO PARA TRANSMISSÃO E DIFERENCIAL SAE 80W90, API GL-5, EMBALAGEM TAMBOR COM 200 LITROS",
    unit: "Tambor", quantity: "1,00",
    quotes: ["1.040,00", "1.065,92", PLACEHOLDER, "1.050,00", "1.049,00", PLACEHOLDER, "1.062,00", "1.050,00"],
    average: "1.052,82", total: "1.052,82", diff: "2,49%",
  },
];

/** Especificação do Golden E (valores esperados documentados no cabeçalho deste arquivo). */
export const GOLDEN_E: MapSpec = {
  institution: ["ENTE PÚBLICO EXEMPLO", "Secretaria de Administração — Setor de Compras", "CNPJ 00.000.000/0000-00 · Rua Fictícia, 000 · Centro"],
  title: "MAPA DE APURAÇÃO DE PREÇOS",
  preamble: ["Processo Administrativo nº 0000/2026 — Objeto: aquisição de lubrificantes e materiais de limpeza para a frota"],
  groupHeader: "FONTES DE PESQUISA",
  sources: ["Fornecedor A", "Fornecedor B", "Fornecedor C", "Fornecedor D", "Fornecedor E", "Portal Público 1", "Portal Público 2", "Contratação Similar"],
  items: GOLDEN_E_ITEMS,
  totalLabel: "VALOR TOTAL ESTIMADO",
  total: "3.349,93",
  footer: [
    `Valores em reais (R$). Células com ${PLACEHOLDER} indicam cotação desconsiderada (fora dos critérios de aceitabilidade).`,
    "Página 1 de 2",
  ],
  signaturePage: [
    "ENTE PÚBLICO EXEMPLO",
    "Observações: a pesquisa observou os parâmetros do art. 23 da Lei nº 14.133/2021.",
    "Local e data: Município Exemplo, 01 de janeiro de 2026.",
    "______________________________________",
    "Servidor Responsável pela Pesquisa",
    "Matrícula nº 0000 — Agente de Contratação",
    "Página 2 de 2",
  ],
  verticalSources: true,
  currencyRow: true,
  centerValues: true,
  cellPadding: 5,
  descriptionWidth: 170,
  sourceWidth: 44,
  drawGrid: true,
};

/**
 * Desenha um mapa de apuração em A4 paisagem. A geometria (não o texto) é o que importa: mesmas estruturas de
 * um mapa real — sem copiar dados reais.
 */
export async function mapPdf(spec: MapSpec): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0 });
  const done = collect(doc);
  const fs = 7;
  const lineH = fs * 1.2;
  const x0 = 24;
  const widths = [22, spec.descriptionWidth, 38, 34, ...spec.sources.map(() => spec.sourceWidth), 52, 52, 40];
  const colX: number[] = [];
  widths.reduce((x, w) => { colX.push(x); return x + w; }, x0);
  const tableW = widths.reduce((a, b) => a + b, 0);
  const firstSource = 4;
  const statCol = firstSource + spec.sources.length;

  let y = 20;
  doc.font("Helvetica-Bold").fontSize(11);
  for (const line of spec.institution) { doc.text(line, x0, y, { width: tableW, align: "center", lineBreak: false }); y += 13; doc.font("Helvetica").fontSize(8); }
  y += 6;
  doc.font("Helvetica-Bold").fontSize(12).text(spec.title, x0, y, { width: tableW, align: "center", lineBreak: false });
  y += 18;
  doc.font("Helvetica").fontSize(8);
  for (const line of spec.preamble) { doc.text(line, x0, y, { width: tableW, lineBreak: false }); y += 12; }
  y += 6;

  // ── Cabeçalho da tabela ──
  const top = y;
  const groupH = spec.groupHeader ? 12 : 0;
  const headerH = spec.verticalSources ? 80 : 24;
  const currencyH = spec.currencyRow ? 11 : 0;
  doc.fontSize(fs).font("Helvetica-Bold");
  if (spec.groupHeader) {
    const gx = colX[firstSource], gw = spec.sources.length * spec.sourceWidth;
    doc.text(spec.groupHeader, gx, top + 3, { width: gw, align: "center", lineBreak: false });
    if (spec.drawGrid) doc.rect(gx, top, gw, groupH).stroke();
  }
  const hy = top + groupH;
  const centerText = (text: string, col: number, yy: number, h: number) => {
    const lines = text.split("\n");
    const start = yy + (h - lines.length * lineH) / 2;
    lines.forEach((l, i) => doc.text(l, colX[col], start + i * lineH, { width: widths[col], align: "center", lineBreak: false }));
  };
  centerText("Item", 0, hy, headerH);
  centerText("Descrição", 1, hy, headerH);
  centerText("Unid.", 2, hy, headerH);
  centerText("Qtde", 3, hy, headerH);
  spec.sources.forEach((s, i) => {
    const col = firstSource + i;
    if (spec.verticalSources) {
      const ox = colX[col] + widths[col] / 2 + fs / 2 - 1, oy = hy + headerH - 4;
      doc.save(); doc.rotate(-90, { origin: [ox, oy] }); doc.text(s, ox, oy, { lineBreak: false }); doc.restore();
    } else {
      centerText(s, col, hy, headerH);
    }
  });
  centerText("MÉDIA\nARITMÉTICA", statCol, hy, headerH);
  centerText("VALOR\nTOTAL", statCol + 1, hy, headerH);
  centerText("% DIF.", statCol + 2, hy, headerH);
  if (spec.drawGrid) widths.forEach((w, i) => doc.rect(colX[i], hy, w, headerH).stroke());
  let ry = hy + headerH;
  if (spec.currencyRow) {
    for (let c = firstSource; c < statCol + 2; c++) centerText("R$", c, ry, currencyH);
    if (spec.drawGrid) widths.forEach((w, i) => doc.rect(colX[i], ry, w, currencyH).stroke());
    ry += currencyH;
  }

  // ── Itens ──
  doc.font("Helvetica").fontSize(fs);
  spec.items.forEach((it, idx) => {
    const descH = doc.heightOfString(it.description, { width: widths[1] - 4 });
    const rowH = Math.max(lineH, descH) + spec.cellPadding * 2;
    const valueY = spec.centerValues ? ry + (rowH - lineH) / 2 : ry + spec.cellPadding;
    doc.text(it.description, colX[1] + 2, ry + spec.cellPadding, { width: widths[1] - 4 });
    doc.text(String(idx + 1), colX[0], valueY, { width: widths[0], align: "center", lineBreak: false });
    doc.text(it.unit, colX[2], valueY, { width: widths[2], align: "center", lineBreak: false });
    doc.text(it.quantity, colX[3], valueY, { width: widths[3], align: "center", lineBreak: false });
    it.quotes.forEach((q, i) => {
      const col = firstSource + i;
      doc.text(q, colX[col], valueY, { width: widths[col] - 3, align: q === PLACEHOLDER ? "center" : "right", lineBreak: false });
    });
    // Média/total: símbolo de moeda e valor como textos separados na MESMA célula (como nos mapas reais).
    for (const [col, v] of [[statCol, it.average], [statCol + 1, it.total]] as const) {
      doc.text("R$", colX[col] + 2, valueY, { lineBreak: false });
      doc.text(v, colX[col], valueY, { width: widths[col] - 3, align: "right", lineBreak: false });
    }
    doc.text(it.diff, colX[statCol + 2], valueY, { width: widths[statCol + 2] - 3, align: "right", lineBreak: false });
    if (spec.drawGrid) widths.forEach((w, i) => doc.rect(colX[i], ry, w, rowH).stroke());
    ry += rowH;
  });

  // ── Total (resumo) ──
  const totH = lineH + 6;
  doc.font("Helvetica-Bold");
  doc.text(spec.totalLabel, colX[0], ry + 3, { width: widths[0] + widths[1] + widths[2] + widths[3], align: "center", lineBreak: false });
  doc.text("R$", colX[statCol + 1] + 2, ry + 3, { lineBreak: false });
  doc.text(spec.total, colX[statCol + 1], ry + 3, { width: widths[statCol + 1] - 3, align: "right", lineBreak: false });
  if (spec.drawGrid) doc.rect(x0, ry, tableW, totH).stroke();
  ry += totH + 14;

  // ── Rodapé ──
  doc.font("Helvetica").fontSize(7);
  spec.footer.forEach((l, i) => {
    const last = i === spec.footer.length - 1;
    doc.text(l, last ? x0 + tableW - 60 : x0, last ? 570 : ry, { width: last ? 60 : tableW, align: last ? "right" : "left", lineBreak: false });
    ry += 10;
  });

  if (spec.signaturePage) {
    doc.addPage({ size: "A4", layout: "landscape", margin: 0 });
    let sy = 40;
    doc.font("Helvetica").fontSize(10);
    spec.signaturePage.forEach((l, i) => {
      const last = i === spec.signaturePage!.length - 1;
      doc.text(l, last ? 700 : 60, last ? 570 : sy, { width: last ? 120 : 700, align: last ? "right" : (i >= 3 ? "center" : "left"), lineBreak: false });
      sy += i === 2 ? 60 : 18;
    });
  }
  doc.end();
  return done;
}

export const goldenEPdf = () => mapPdf(GOLDEN_E);
