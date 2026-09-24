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

// ─── GOLDEN E v2 — geometria de células EMPILHADAS (espelha o mapa real, 100% fictício) ─────────────────────
/**
 * Reproduz a geometria observada em mapas de apuração emitidos por sistemas de gestão (sem copiar dado real):
 *   A. caixa de metadados acima do título (ID, DATA, VALOR TOTAL com "R$") — números/datas/R$ FORA da tabela;
 *   B. cabeçalho com células empilhadas: ANEXO / LOTE / ITEM (3 linhas), UNIDADE / QTDE. (3 linhas com "/"),
 *      MÉDIA ARITMÉTICA / VALOR TOTAL (vertical), fontes em texto vertical (várias linhas), PERCENTUAL (vertical);
 *   C. descrição multilinha CENTRADA na linha do meio do item, quebrada no meio da palavra;
 *   D. identificação empilhada "I" / "001" / "00n"; E. unidade acima e quantidade abaixo na MESMA coluna;
 *   F. várias fontes; G. preços e percentual na linha do meio (centralizados); H. média acima e total abaixo;
 *   I. percentual; J. linhas finais de total por fonte com números VERTICAIS; K. página 2 administrativa.
 * Texto em fonte monoespaçada e emitido PALAVRA A PALAVRA (um item de texto por palavra, como no PDF real).
 */
export interface StackedMapSpec {
  sources: string[];
  items: MapItem[];
  total: string;
  signaturePage: boolean;
}

export const GOLDEN_E_V2: StackedMapSpec = {
  sources: ["Fonte Similar", "Portal Compras A", "Portal B", "Portal Nacional C", "Fornecedor Alfa Comercio ME", "Norte Suprimentos", "Gama Quimica", "Delta Limpeza"],
  items: GOLDEN_E_ITEMS,
  total: "3.349,93",
  signaturePage: true,
};

export async function stackedMapPdf(spec: StackedMapSpec = GOLDEN_E_V2): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0 });
  const done = collect(doc);
  const FS = 7.2, PITCH = 8.2;
  /** Emite palavra por palavra (monoespaçada: posição exata por caractere). */
  const words = (text: string, x: number, y: number, size = FS) => {
    doc.fontSize(size);
    const cw = size * 0.6;
    let col = 0;
    for (const part of text.split(/(\s+)/)) {
      if (part.trim()) doc.text(part, x + col * cw, y, { lineBreak: false });
      col += part.length;
    }
  };
  const width = (t: string, size = FS) => t.length * size * 0.6;
  const right = (t: string, xr: number, y: number) => words(t, xr - width(t), y);
  const center = (t: string, xc: number, y: number, size = FS) => words(t, xc - width(t, size) / 2, y, size);
  /** Texto vertical (−90°, lê de baixo para cima) em várias linhas lado a lado, centradas na coluna. */
  const vertical = (lines: string[], xc: number, yBottom: number, size = FS) => {
    doc.fontSize(size);
    const x0 = xc - ((lines.length - 1) * (size + 1)) / 2;
    lines.forEach((l, i) => {
      const ox = x0 + i * (size + 1) + size / 2, oy = yBottom;
      doc.save(); doc.rotate(-90, { origin: [ox, oy] }); doc.text(l, ox, oy, { lineBreak: false }); doc.restore();
    });
  };
  const wrapWords = (t: string, max: number) => {
    const out: string[] = [];
    for (const w of t.split(" ")) {
      const last = out[out.length - 1];
      if (last !== undefined && (last + " " + w).length <= max) out[out.length - 1] = `${last} ${w}`; else out.push(w);
    }
    return out;
  };
  doc.font("Courier");

  // Colunas (x em pt): identificação, descrição, unidade/qtde, fontes, média/total, percentual.
  const ID_C = 42, DESC_X = 59, DESC_CHARS = 70, UNIT_C = 385;
  const srcW = 40, SRC_X0 = 405;
  const srcRight = spec.sources.map((_, i) => SRC_X0 + (i + 1) * srcW - 3);
  const srcCenter = spec.sources.map((_, i) => SRC_X0 + i * srcW + srcW / 2);
  const AVG_R = SRC_X0 + spec.sources.length * srcW + 42, PCT_R = AVG_R + 40;

  // A. identificação institucional FICTÍCIA + caixa de metadados + título + objeto.
  words("ENTE PUBLICO EXEMPLO", 110, 40, 14.7);
  words("ESTADO FICTICIO", 110, 57, 11.1);
  words("CONFORME LEI 14.133/21", 711, 45, 7.4);
  words("ID", 37, 101, 6.4); words("DATA", 92, 101, 6.4); words("VALOR TOTAL", 711, 101, 6.4);
  words("900001", 34, 116, 9.9); words("01/01/2026", 89, 116, 9.9);
  words("R$", 708, 116, 9.9); words(spec.total, 726, 116, 9.9);
  center("MAPA DE APURAÇÃO DE PREÇOS", 428, 105, 19.8);
  words("OBJETO", 37, 138, 6.4);
  words("Aquisição de materiais de limpeza para a frota (fictício)", 34, 153, 9.9);

  // B. cabeçalho: empilhado horizontal (ANEXO/LOTE/ITEM, UNIDADE / QTDE.) e vertical (fontes, média/total, %).
  center("ANEXO", ID_C, 194.5); center("LOTE", ID_C, 202.7); center("ITEM", ID_C, 211);
  center("PRODUTO / SERVIÇO", 210, 202.7);
  center("UNIDADE", UNIT_C, 194.5); center("/", UNIT_C, 202.7); center("QTDE.", UNIT_C, 211);
  const HEAD_BOTTOM = 232;
  spec.sources.forEach((s, i) => vertical(wrapWords(s.toUpperCase(), 12), srcCenter[i], HEAD_BOTTOM));
  vertical(["MÉDIA", "ARITMÉTICA /", "VALOR TOTAL"], AVG_R - 17, HEAD_BOTTOM);
  vertical(["PERCENTUAL", "DE DIFERENÇA", "DO MENOR", "PREÇO"], PCT_R - 16, HEAD_BOTTOM);

  // Itens: 3 níveis (L0/L1/L2); descrição centrada em L1; unidade/média em L0+2,3; preços/% em L1;
  // quantidade/total em L1+5,2; identificação I / 001 / 00n em L0/L1/L2.
  let top = 240.2;
  const colTotals = spec.sources.map(() => 0);
  spec.items.forEach((it, n) => {
    const desc: string[] = [];
    for (let i = 0; i < it.description.length; i += DESC_CHARS) desc.push(it.description.slice(i, i + DESC_CHARS));
    const L0 = top + Math.max(0, (desc.length - 3) / 2) * PITCH, L1 = L0 + PITCH, L2 = L1 + PITCH;
    const d0 = L1 - ((desc.length - 1) / 2) * PITCH;
    desc.forEach((l, i) => words(l.trim(), DESC_X, d0 + i * PITCH));
    center("I", ID_C, L0); center("001", ID_C, L1); center(String(n + 1).padStart(3, "0"), ID_C, L2);
    center(it.unit, UNIT_C, L0 + 2.3); center(it.quantity, UNIT_C, L1 + 5.2);
    it.quotes.forEach((q, i) => {
      if (q === PLACEHOLDER) center(q, srcCenter[i], L1); else right(q, srcRight[i], L1);
      const c = parseBRLFixture(q); if (c !== null) colTotals[i] += c;
    });
    right(it.average, AVG_R, L0 + 2.3); right(it.total, AVG_R, L1 + 5.2);
    right(it.diff, PCT_R, L1);
    top = Math.max(L2, d0 + (desc.length - 1) * PITCH) + PITCH + 7;
  });

  // J. linhas de total por fonte (números VERTICAIS) + total geral na coluna de média/total.
  const t1 = top + 5;
  center("Valor total do anexo após análise", 210, t1 + 13);
  spec.sources.forEach((_, i) => vertical([fmtCents(colTotals[i])], srcCenter[i], t1 + 32));
  words("R$", AVG_R - 48, t1 + 37); right(spec.total, AVG_R + 26, t1 + 37);
  center("Valor total geral do anexo", 210, t1 + 59);
  spec.sources.forEach((_, i) => vertical([fmtCents(colTotals[i])], srcCenter[i], t1 + 79));

  // Rodapé.
  words("VALOR(ES) RETIRADO(S) POR INCOMPATIBILIDADE(S) DE PREÇO(S)", 305, 552, 7.4);
  words("Página 1/2", 765, 542, 7.4);
  words("MAPA DE APURAÇÃO DE PREÇOS 900001", 663, 550, 7.4);
  words("EMISSOR FICTICIO LTDA", 740, 557, 5.8);

  if (spec.signaturePage) {
    doc.addPage({ size: "A4", layout: "landscape", margin: 0 });
    words("ENTE PUBLICO EXEMPLO", 110, 40, 14.7);
    words("Observações: pesquisa conforme art. 23 da Lei nº 14.133/2021.", 60, 120, 9);
    words("Local e data: Município Exemplo, 01 de janeiro de 2026.", 60, 140, 9);
    words("______________________________", 300, 240, 9);
    words("Servidor Responsável pela Pesquisa", 300, 256, 9);
    words("Matrícula nº 0000", 300, 270, 9);
    words("Página 2/2", 765, 542, 7.4);
  }
  doc.end();
  return done;
}

function parseBRLFixture(v: string): number | null {
  if (v === PLACEHOLDER) return null;
  return Math.round(Number(v.replace(/\./g, "").replace(",", ".")) * 100);
}
function fmtCents(c: number): string {
  const s = (c / 100).toFixed(2).split(".");
  return `${s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${s[1]}`;
}

export const goldenEV2Pdf = () => stackedMapPdf(GOLDEN_E_V2);
