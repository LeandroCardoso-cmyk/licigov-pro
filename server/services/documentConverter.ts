/**
 * RC-3.5.2 — Classificação: **INTERNAL RENDERER** (implementação interna).
 *
 * Conversor Markdown → DOCX/PDF (binário real, sem Chromium). NÃO é API pública:
 * é a implementação interna de renderização do Document Engine. Toda chamada DEVE
 * passar pelo `documentEngineService` (única fachada pública de geração documental).
 * Chamadas diretas só são permitidas para os LEGACY exporters registrados na
 * allowlist central (`server/kernel/architecture/legacyBoundaries.ts`) — nenhum novo
 * componente pode chamá-lo diretamente (garantido por teste de fronteira).
 * Não conhece storage nem S3 — apenas produz o binário.
 */
import PDFDocument from "pdfkit";
import { Lexer } from "marked";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } from "docx";

// Strip inline markdown (bold, italic, links, code) to plain text
function stripInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1");
}

/**
 * Converte Markdown para PDF usando pdfkit (pure-JS, sem Chromium).
 * Compatível com Railway e qualquer ambiente Node.js.
 */
export async function convertToPDF(
  content: string,
  _fileName: string,
  organizationName?: string,
  address?: string,
  cnpj?: string,
  phone?: string,
  email?: string,
  website?: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 56, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - 112; // subtract both margins

    // ── Cabeçalho da organização ────────────────────────────────────────────
    if (organizationName) {
      doc.fontSize(14).font("Helvetica-Bold").text(organizationName, { align: "center" });
      if (address) doc.fontSize(9).font("Helvetica").text(address, { align: "center" });
      if (cnpj) doc.fontSize(9).font("Helvetica").text(`CNPJ: ${cnpj}`, { align: "center" });
      doc.moveDown(0.5)
        .moveTo(56, doc.y).lineTo(56 + pageWidth, doc.y)
        .strokeColor("#1e40af").lineWidth(1.5).stroke()
        .strokeColor("black").lineWidth(1)
        .moveDown(0.8);
    }

    // ── Conteúdo Markdown → pdfkit ──────────────────────────────────────────
    const tokens = Lexer.lex(content);

    for (const token of tokens) {
      switch (token.type) {
        case "heading": {
          const sizes: Record<number, number> = { 1: 16, 2: 13, 3: 11 };
          const size = sizes[token.depth] ?? 11;
          doc.moveDown(0.4)
            .fontSize(size).font("Helvetica-Bold")
            .text(stripInline(token.text), { paragraphGap: 4 });
          break;
        }
        case "paragraph":
          doc.fontSize(11).font("Helvetica")
            .text(stripInline(token.text), { align: "justify", paragraphGap: 6, lineGap: 1 });
          break;
        case "list":
          for (const item of token.items) {
            const bullet = token.ordered ? `${item}. ` : "• ";
            doc.fontSize(11).font("Helvetica")
              .text(`${bullet}${stripInline(item.text)}`, { indent: 16, paragraphGap: 3 });
          }
          doc.moveDown(0.2);
          break;
        case "blockquote":
          doc.fontSize(10).font("Helvetica-Oblique")
            .text(stripInline(token.text), { indent: 24, paragraphGap: 4 });
          break;
        case "hr":
          doc.moveDown(0.5)
            .moveTo(56, doc.y).lineTo(56 + pageWidth, doc.y)
            .strokeColor("#888").lineWidth(0.5).stroke()
            .strokeColor("black").lineWidth(1)
            .moveDown(0.5);
          break;
        case "space":
          doc.moveDown(0.4);
          break;
      }
    }

    // ── Rodapé de contato ───────────────────────────────────────────────────
    if (phone || email || website) {
      doc.moveDown(1.5)
        .moveTo(56, doc.y).lineTo(56 + pageWidth, doc.y)
        .strokeColor("#1e40af").lineWidth(1.5).stroke()
        .strokeColor("black").lineWidth(1)
        .moveDown(0.5);
      doc.fontSize(9).font("Helvetica-Bold").text("Contato:", { align: "center" });
      if (phone) doc.fontSize(9).font("Helvetica").text(`Telefone: ${phone}`, { align: "center" });
      if (email) doc.fontSize(9).font("Helvetica").text(`E-mail: ${email}`, { align: "center" });
      if (website) doc.fontSize(9).font("Helvetica").text(`Website: ${website}`, { align: "center" });
    }

    doc.end();
  });
}

/**
 * Converte Markdown para DOCX com cabeçalho e rodapé personalizados
 */
export async function convertToDOCX(
  content: string,
  fileName: string,
  organizationName?: string,
  address?: string,
  cnpj?: string,
  phone?: string,
  email?: string,
  website?: string
): Promise<Buffer> {
  // Construir parágrafos do cabeçalho
  const headerParagraphs: Paragraph[] = [];
  if (organizationName) {
    headerParagraphs.push(
      new Paragraph({
        text: organizationName,
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
      })
    );
    if (address) {
      headerParagraphs.push(
        new Paragraph({
          text: address,
          alignment: AlignmentType.CENTER,
        })
      );
    }
    if (cnpj) {
      headerParagraphs.push(
        new Paragraph({
          text: `CNPJ: ${cnpj}`,
          alignment: AlignmentType.CENTER,
        })
      );
    }
    headerParagraphs.push(new Paragraph({ text: "" })); // Espaço
  }

  // Converter Markdown para parágrafos
  const lines = content.split("\n");
  const contentParagraphs: Paragraph[] = [];

  for (const line of lines) {
    if (!line.trim()) {
      contentParagraphs.push(new Paragraph({ text: "" }));
      continue;
    }

    // Detectar headings
    if (line.startsWith("# ")) {
      contentParagraphs.push(
        new Paragraph({
          text: line.replace(/^# /, ""),
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 240, after: 120 },
        })
      );
    } else if (line.startsWith("## ")) {
      contentParagraphs.push(
        new Paragraph({
          text: line.replace(/^## /, ""),
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 100 },
        })
      );
    } else if (line.startsWith("### ")) {
      contentParagraphs.push(
        new Paragraph({
          text: line.replace(/^### /, ""),
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 160, after: 80 },
        })
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      contentParagraphs.push(
        new Paragraph({
          text: line.replace(/^[*-] /, ""),
          bullet: { level: 0 },
        })
      );
    } else {
      // Parágrafo normal - processar **bold**
      const children: TextRun[] = [];
      const boldRegex = /\*\*(.+?)\*\*/g;
      let lastIndex = 0;
      let match;

      while ((match = boldRegex.exec(line)) !== null) {
        if (match.index > lastIndex) {
          children.push(new TextRun({ text: line.substring(lastIndex, match.index) }));
        }
        children.push(new TextRun({ text: match[1], bold: true }));
        lastIndex = match.index + match[0].length;
      }

      if (lastIndex < line.length) {
        children.push(new TextRun({ text: line.substring(lastIndex) }));
      }

      contentParagraphs.push(
        new Paragraph({
          children: children.length > 0 ? children : [new TextRun({ text: line })],
          spacing: { after: 120 },
        })
      );
    }
  }

  // Construir parágrafos do rodapé
  const footerParagraphs: Paragraph[] = [];
  if (phone || email || website) {
    footerParagraphs.push(new Paragraph({ text: "" })); // Espaço
    footerParagraphs.push(
      new Paragraph({
        children: [new TextRun({ text: "Contato:", bold: true })],
        alignment: AlignmentType.CENTER,
      })
    );
    if (phone) {
      footerParagraphs.push(
        new Paragraph({
          text: `Telefone: ${phone}`,
          alignment: AlignmentType.CENTER,
        })
      );
    }
    if (email) {
      footerParagraphs.push(
        new Paragraph({
          text: `E-mail: ${email}`,
          alignment: AlignmentType.CENTER,
        })
      );
    }
    if (website) {
      footerParagraphs.push(
        new Paragraph({
          text: `Website: ${website}`,
          alignment: AlignmentType.CENTER,
        })
      );
    }
  }

  // Criar documento
  const doc = new Document({
    sections: [
      {
        children: [...headerParagraphs, ...contentParagraphs, ...footerParagraphs],
      },
    ],
  });

  // Gerar buffer
  return await Packer.toBuffer(doc);
}

// ─────────────────────────────────────────────────────────────────────────────
// PR #188 — Renderização INSTITUCIONAL comum (DFD/ETP/TR/Edital)
//
// Modelo intermediário estruturado ÚNICO, consumido pelos dois renderers (DOCX e
// PDF) — mesmos metadados, mesmas seções, mesmo status. O corpo é interpretado via
// `marked` (parser já aprovado no projeto) usando os tokens inline (negrito/itálico)
// — nada de regex frágil e nenhum marcador Markdown vaza como texto literal.
// APENAS apresentação: não modifica o conteúdo persistido.
// ─────────────────────────────────────────────────────────────────────────────

export interface InlineRun { text: string; bold?: boolean; italic?: boolean }
export type DocBlock =
  | { kind: "heading"; level: 1 | 2 | 3; runs: InlineRun[] }
  | { kind: "paragraph"; runs: InlineRun[] }
  | { kind: "list"; ordered: boolean; items: InlineRun[][] }
  | { kind: "notice"; runs: InlineRun[] } // blockquote → bloco de aviso destacado
  | { kind: "hr" };

export interface InstitutionalMeta {
  organizationName?: string;
  documentTitle: string;
  processNumber?: string;
  object?: string;
  statusLabel: string; // "RASCUNHO" | "EM REVISÃO" | "APROVADO" | "REJEITADO"
  isDraft: boolean;
  version: number;
  exportedAtLabel: string; // já formatado pt-BR pela camada de apresentação
  /** Palavra usada no aviso de não-finalizado (default "RASCUNHO"). Documentos
   *  oficiais usam o status real (ex.: "GERADO"/"REVISADO"). */
  draftNoticeLabel?: string;
}

export interface InstitutionalModel {
  meta: InstitutionalMeta;
  blocks: DocBlock[];
}

/** Converte tokens inline do `marked` em runs com negrito/itálico (recursivo). */
function tokensToRuns(tokens: any[] | undefined, bold = false, italic = false): InlineRun[] {
  const runs: InlineRun[] = [];
  for (const t of tokens ?? []) {
    if (t.type === "strong") runs.push(...tokensToRuns(t.tokens, true, italic));
    else if (t.type === "em") runs.push(...tokensToRuns(t.tokens, bold, true));
    else if (t.type === "del" || t.type === "link") runs.push(...tokensToRuns(t.tokens ?? [{ type: "text", text: t.text }], bold, italic));
    else if (t.type === "br") runs.push({ text: "\n", bold, italic });
    else runs.push({ text: (t.text ?? t.raw ?? "").toString(), bold, italic });
  }
  return runs.filter((r) => r.text.length > 0);
}

function runsFromText(text: string): InlineRun[] {
  const inline = Lexer.lexInline(text) as any[];
  const runs = tokensToRuns(inline);
  return runs.length ? runs : [{ text }];
}

/**
 * Constrói o modelo institucional a partir do conteúdo (Markdown) + metadados.
 * PURO e testável — os renderers apenas o consomem.
 */
export function buildInstitutionalModel(content: string, meta: InstitutionalMeta): InstitutionalModel {
  const tokens = Lexer.lex(content ?? "") as any[];
  const blocks: DocBlock[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case "heading":
        blocks.push({ kind: "heading", level: Math.min(Math.max(token.depth, 1), 3) as 1 | 2 | 3, runs: tokensToRuns(token.tokens) });
        break;
      case "paragraph":
        blocks.push({ kind: "paragraph", runs: tokensToRuns(token.tokens) });
        break;
      case "list":
        blocks.push({
          kind: "list",
          ordered: !!token.ordered,
          items: (token.items ?? []).map((it: any) => runsFromText((it.text ?? "").trim())),
        });
        break;
      case "blockquote": {
        // blockquote agrupa blocos internos → concatena em um bloco de aviso.
        const inner = flattenInline(token.tokens ?? []);
        blocks.push({ kind: "notice", runs: tokensToRuns(inner) });
        break;
      }
      case "hr":
        blocks.push({ kind: "hr" });
        break;
      default:
        break;
    }
  }
  return { meta, blocks };
}

/** Achata tokens de bloco (ex.: parágrafos dentro de blockquote/list item) em inline. */
function flattenInline(blockTokens: any[]): any[] {
  const out: any[] = [];
  for (const t of blockTokens) {
    if (t.tokens && (t.type === "paragraph" || t.type === "text")) {
      out.push(...t.tokens);
      out.push({ type: "br" });
    } else if (t.type === "text") {
      out.push({ type: "text", text: t.text ?? "" });
    }
  }
  return out;
}

function metaLines(meta: InstitutionalMeta): { label: string; value: string; strong?: boolean }[] {
  const lines: { label: string; value: string; strong?: boolean }[] = [];
  if (meta.processNumber) lines.push({ label: "Processo", value: meta.processNumber });
  if (meta.object) lines.push({ label: "Objeto", value: meta.object });
  lines.push({ label: "Status", value: meta.statusLabel, strong: true });
  lines.push({ label: "Versão", value: String(meta.version) });
  lines.push({ label: "Exportado em", value: meta.exportedAtLabel });
  return lines;
}

function draftNotice(meta: InstitutionalMeta): string {
  const label = meta.draftNoticeLabel ?? "RASCUNHO";
  return `${label} — revisão obrigatória. Este arquivo ainda NÃO é uma versão oficial finalizada.`;
}

/** Renderiza o modelo institucional para DOCX. */
export async function renderInstitutionalDOCX(model: InstitutionalModel): Promise<Buffer> {
  const { meta } = model;
  const paras: Paragraph[] = [];

  if (meta.organizationName) {
    paras.push(new Paragraph({ text: meta.organizationName, heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER }));
  }
  paras.push(new Paragraph({ text: meta.documentTitle, heading: HeadingLevel.HEADING_2, alignment: AlignmentType.CENTER }));
  for (const ln of metaLines(meta)) {
    paras.push(new Paragraph({
      children: [new TextRun({ text: `${ln.label}: `, bold: true }), new TextRun({ text: ln.value, bold: !!ln.strong })],
      spacing: { after: 40 },
    }));
  }
  if (meta.isDraft) {
    paras.push(new Paragraph({ children: [new TextRun({ text: draftNotice(meta), bold: true, italics: true })], spacing: { before: 120, after: 120 } }));
  }
  paras.push(new Paragraph({ text: "", border: { bottom: { color: "1e40af", size: 6, style: BorderStyle.SINGLE, space: 1 } } }));

  for (const b of model.blocks) {
    if (b.kind === "hr") { paras.push(new Paragraph({ text: "", border: { bottom: { color: "888888", size: 3, style: BorderStyle.SINGLE, space: 1 } } })); continue; }
    if (b.kind === "heading") {
      const level = b.level === 1 ? HeadingLevel.HEADING_2 : b.level === 2 ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_4;
      paras.push(new Paragraph({ heading: level, spacing: { before: 160, after: 80 }, children: runsToDocx(b.runs) }));
    } else if (b.kind === "paragraph") {
      paras.push(new Paragraph({ spacing: { after: 120 }, children: runsToDocx(b.runs) }));
    } else if (b.kind === "list") {
      for (const item of b.items) paras.push(new Paragraph({ bullet: { level: 0 }, children: runsToDocx(item) }));
    } else if (b.kind === "notice") {
      paras.push(new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: "⚠ ", bold: true }), ...runsToDocx(b.runs, true)] }));
    }
  }

  const doc = new Document({ sections: [{ children: paras }] });
  return Packer.toBuffer(doc);
}

function runsToDocx(runs: InlineRun[], forceItalic = false): TextRun[] {
  const list = runs.length ? runs : [{ text: "" }];
  return list.map((r) => new TextRun({ text: r.text, bold: r.bold, italics: forceItalic || r.italic }));
}

/** Renderiza o modelo institucional para PDF. */
export async function renderInstitutionalPDF(model: InstitutionalModel): Promise<Buffer> {
  const { meta } = model;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 56, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const pageWidth = doc.page.width - 112;

    if (meta.organizationName) doc.fontSize(14).font("Helvetica-Bold").text(meta.organizationName, { align: "center" });
    doc.fontSize(13).font("Helvetica-Bold").text(meta.documentTitle, { align: "center" }).moveDown(0.4);
    for (const ln of metaLines(meta)) {
      doc.fontSize(10).font("Helvetica-Bold").text(`${ln.label}: `, { continued: true })
        .font(ln.strong ? "Helvetica-Bold" : "Helvetica").text(ln.value);
    }
    if (meta.isDraft) {
      doc.moveDown(0.3).fontSize(10).font("Helvetica-BoldOblique").fillColor("#b91c1c").text(draftNotice(meta)).fillColor("black");
    }
    doc.moveDown(0.4).moveTo(56, doc.y).lineTo(56 + pageWidth, doc.y).strokeColor("#1e40af").lineWidth(1.5).stroke().strokeColor("black").lineWidth(1).moveDown(0.6);

    for (const b of model.blocks) {
      if (b.kind === "hr") { doc.moveDown(0.4).moveTo(56, doc.y).lineTo(56 + pageWidth, doc.y).strokeColor("#888").lineWidth(0.5).stroke().strokeColor("black").lineWidth(1).moveDown(0.4); continue; }
      if (b.kind === "heading") { const size = b.level === 1 ? 15 : b.level === 2 ? 12 : 11; doc.moveDown(0.3); writeRunsPDF(doc, b.runs, size, true); }
      else if (b.kind === "paragraph") { writeRunsPDF(doc, b.runs, 11, false, { align: "justify", paragraphGap: 6 }); }
      else if (b.kind === "list") { for (const item of b.items) { doc.fontSize(11).font("Helvetica").text("• ", { continued: true }); writeRunsPDF(doc, item, 11, false, { paragraphGap: 3 }); } doc.moveDown(0.2); }
      else if (b.kind === "notice") { doc.moveDown(0.2).fontSize(10).font("Helvetica-Oblique").fillColor("#1e3a8a").text("⚠ ", { continued: true }); writeRunsPDF(doc, b.runs, 10, false, { paragraphGap: 4 }, true); doc.fillColor("black"); }
    }
    doc.end();
  });
}

function pdfFont(bold: boolean, italic: boolean): string {
  if (bold && italic) return "Helvetica-BoldOblique";
  if (bold) return "Helvetica-Bold";
  if (italic) return "Helvetica-Oblique";
  return "Helvetica";
}

function writeRunsPDF(doc: PDFKit.PDFDocument, runs: InlineRun[], size: number, headingBold: boolean, opts: any = {}, forceItalic = false): void {
  const list = runs.length ? runs : [{ text: "" }];
  list.forEach((r, i) => {
    const last = i === list.length - 1;
    doc.fontSize(size).font(pdfFont(r.bold || headingBold, (r.italic || forceItalic) as boolean))
      .text(r.text, { continued: !last, ...opts });
  });
}
