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
/* eslint-disable @typescript-eslint/no-explicit-any */
// `any` inevitável ao consumir a AST não-tipada do `marked` e as opções do PDFKit.
import PDFDocument from "pdfkit";
import { Lexer } from "marked";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, Table, TableRow, TableCell, WidthType, Footer, PageNumber, TableLayoutType, TableBorders } from "docx";

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
/** F3-D — até 4 níveis de título no corpo (antes: 3; "####" virava o mesmo nível de "###" e a hierarquia do TR se perdia). */
export type HeadingDepth = 1 | 2 | 3 | 4;
/** Alinhamento declarado na tabela Markdown (`---:` ⇒ direita); `null` = padrão (esquerda). */
export type CellAlign = "left" | "center" | "right" | null;
export type DocBlock =
  | { kind: "heading"; level: HeadingDepth; runs: InlineRun[] }
  // F3.1 — `keepWithNext`: o parágrafo fica na mesma página do bloco seguinte (encerramento/assinaturas; ver `markClosingBlocks`).
  | { kind: "paragraph"; runs: InlineRun[]; keepWithNext?: true }
  | { kind: "list"; ordered: boolean; items: InlineRun[][] }
  | { kind: "notice"; runs: InlineRun[] } // blockquote → bloco de aviso destacado
  | { kind: "table"; header: InlineRun[][]; rows: InlineRun[][][]; align?: CellAlign[] } // tabela Markdown (GFM) — nunca descartada
  | { kind: "hr" };

/**
 * Representação institucional da assinatura de um ato (metadado do documento, NÃO
 * conteúdo jurídico). Opcional: só documentos com assinatura registrada preenchem.
 * `manual` NÃO é assinatura digital ICP-Brasil/GOV.BR/A1 — o wording institucional
 * deixa isso explícito, sem induzir equivalência criptográfica.
 */
export interface SignatureMeta {
  signed: true;
  /** Nome institucional do signatário (snapshot histórico no momento da emissão). */
  signerName: string;
  /** Papel/função institucional disponível no momento da emissão (opcional). */
  signerRole?: string;
  /** Rótulo humano do método (ex.: "Manual"). */
  methodLabel: string;
  /** Data/hora da assinatura já formatada pt-BR. */
  signedAtLabel: string;
}

export interface InstitutionalMeta {
  organizationName?: string;
  documentTitle: string;
  processNumber?: string;
  object?: string;
  statusLabel: string; // "RASCUNHO" | "EM REVISÃO" | "APROVADO" | "REJEITADO"
  isDraft: boolean;
  version: number;
  /** Ordinal da emissão oficial (1 = primeira). Presente só para versão EMITIDA: o cabeçalho mostra "Emissão oficial: 1ª" e a
   *  revisão técnica da linhagem, em vez de um "Versão: 2" que parece a segunda emissão. */
  emissionNumber?: number;
  exportedAtLabel: string; // já formatado pt-BR pela camada de apresentação
  /** Palavra usada no aviso de não-finalizado (default "RASCUNHO"). Documentos
   *  oficiais usam o status real (ex.: "GERADO"/"REVISADO"). */
  draftNoticeLabel?: string;
  /** Marca integral de documento não emitido (ex.: "MINUTA — NÃO EMITIDA OFICIALMENTE"). Com `isDraft`, substitui o aviso padrão
   *  na 1ª página (mantendo o status interno ao lado) e abre o rodapé de todas as páginas. Ausente ⇒ comportamento anterior. */
  draftMarking?: string;
  /** Bloco de assinatura institucional (opcional). Presente apenas quando o ato tem
   *  assinatura registrada — ex.: Parecer Jurídico emitido/assinado. Ausente para os
   *  demais documentos/domínios, que permanecem inalterados. */
  signature?: SignatureMeta;
  /** Pós-M8 — avisos de APRESENTAÇÃO do arquivo (ex.: valores demonstrativos), no cabeçalho; fora do conteúdo do documento. */
  notices?: string[];
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
        blocks.push({ kind: "heading", level: Math.min(Math.max(token.depth, 1), 4) as HeadingDepth, runs: tokensToRuns(token.tokens) });
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
      case "table": {
        // Tabela GFM: antes era descartada em silêncio (perda de conteúdo no DOCX/PDF). Células preservam o texto
        // exatamente como composto (inclusive "R$" e "(R$)") — apenas apresentação.
        const cellRuns = (c: any): InlineRun[] => {
          const r = tokensToRuns(c.tokens);
          return r.length ? r : [{ text: (c.text ?? "").toString() }];
        };
        blocks.push({
          kind: "table",
          header: (token.header ?? []).map(cellRuns),
          rows: (token.rows ?? []).map((row: any[]) => row.map(cellRuns)),
          align: (token.align ?? []).map((a: unknown) => (a === "left" || a === "center" || a === "right" ? a : null)),
        });
        break;
      }
      default:
        break;
    }
  }
  // Bloco de ASSINATURA institucional (opcional) — anexado ao FINAL do documento como
  // blocos comuns (hr + heading + parágrafos), renderizados igualmente por DOCX e PDF.
  // É representação do ato assinado (metadado), nunca alteração do conteúdo jurídico.
  if (meta.signature?.signed) {
    blocks.push(...signatureBlocks(meta.signature));
  }
  return { meta, blocks: markClosingBlocks(blocks) };
}

/** Parágrafo "curto" de encerramento (≤ 2 linhas, sem quebra interna): local/data, nome — cargo, legenda do signatário. */
export const CLOSING_LINE_MAX_CHARS = 140;
/** Máximo de parágrafos mantidos juntos (o grupo nunca passa de meia página: sem vazio grande nem laço de paginação). */
export const CLOSING_BLOCK_MAX_PARAGRAPHS = 12;

/**
 * F3.1 — coesão do ENCERRAMENTO de cada parte do documento (minuta, anexo, documento avulso): a sequência final de parágrafos
 * CURTOS imediatamente antes de um título de nível ≤ 2 (ex.: "## ANEXO V") ou do fim do documento — fórmula de encerramento,
 * local/data, "nome — cargo" e legenda de cada signatário — fica numa mesma página. Antes, cada linha era um parágrafo
 * independente e 1–2 linhas ("a preencher — a preencher", "CONTRATADO") transbordavam sozinhas para uma página quase vazia,
 * seguida da página nova do anexo.
 * Critério ESTRUTURAL (posição + forma), sem palavras-chave: o conteúdo publicado não traz marca semântica de assinatura. Um falso
 * positivo só mantém juntas até 12 linhas curtas ao fim de uma parte. Apresentação apenas: texto, ordem e conteúdo intactos.
 */
export function markClosingBlocks(blocks: DocBlock[]): DocBlock[] {
  const out = blocks.slice();
  const short = (b: DocBlock): boolean => {
    if (b.kind !== "paragraph") return false;
    const t = b.runs.map((r) => r.text).join("").trim();
    return t.length > 0 && t.length <= CLOSING_LINE_MAX_CHARS && !t.includes("\n");
  };
  const partEnds: number[] = [];
  out.forEach((b, i) => { if (b.kind === "heading" && b.level <= 2) partEnds.push(i); });
  partEnds.push(out.length);
  for (const end of partEnds) {
    let start = end;
    while (start > 0 && end - start < CLOSING_BLOCK_MAX_PARAGRAPHS && short(out[start - 1])) start--;
    if (end - start < 2) continue;
    for (let i = start; i < end - 1; i++) {
      const b = out[i];
      if (b.kind === "paragraph") out[i] = { ...b, keepWithNext: true };
    }
  }
  return out;
}

/** Constrói os blocos do bloco institucional de assinatura (comum aos dois renderers). */
function signatureBlocks(sig: SignatureMeta): DocBlock[] {
  const line = (label: string, value: string): DocBlock => ({
    kind: "paragraph",
    runs: [{ text: `${label}: `, bold: true }, { text: value }],
  });
  const out: DocBlock[] = [
    { kind: "hr" },
    { kind: "heading", level: 2, runs: [{ text: "Assinatura" }] },
    line("Responsável", sig.signerName),
  ];
  if (sig.signerRole && sig.signerRole.trim().length > 0) {
    out.push(line("Função/Papel", sig.signerRole));
  }
  out.push(line("Método", sig.methodLabel));
  out.push(line("Assinado em", sig.signedAtLabel));
  // Wording institucional NÃO-ICP: deixa claro que é registro manual do sistema, sem
  // induzir equivalência a ICP-Brasil/GOV.BR/certificado A1/assinatura criptográfica.
  out.push({ kind: "paragraph", runs: [{ text: "Assinatura registrada no LiciGov Pro — método manual.", italic: true }] });
  return out;
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
  if (meta.emissionNumber && meta.emissionNumber > 0) {
    lines.push({ label: "Emissão oficial", value: `${meta.emissionNumber}ª` });
    lines.push({ label: "Revisão técnica", value: String(meta.version) });
  } else {
    lines.push({ label: "Versão", value: String(meta.version) });
  }
  lines.push({ label: "Exportado em", value: meta.exportedAtLabel });
  return lines;
}

function draftNotice(meta: InstitutionalMeta): string {
  if (meta.draftMarking) return `${meta.draftMarking} — situação interna: ${meta.statusLabel}. Revisão obrigatória; este arquivo não é documento oficial.`;
  const label = meta.draftNoticeLabel ?? "RASCUNHO";
  return `${label} — revisão obrigatória. Este arquivo ainda NÃO é uma versão oficial finalizada.`;
}

/**
 * Pós-M8 — RODAPÉ de TODAS as páginas: identificação do documento, estado de rascunho (quando for rascunho) e "Página N de M".
 * O cabeçalho completo continua só na 1ª página; documento emitido nunca recebe a marca de rascunho.
 */
function footerText(meta: InstitutionalMeta): string {
  // Partes LIMITADAS (títulos/números livres podem ser longos): o rodapé cabe numa linha e nunca empurra conteúdo/páginas.
  const clip = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t);
  // A marca de não emitido vem PRIMEIRO: título/processo longos podem ser cortados pela reticência, a marca nunca.
  if (meta.isDraft && meta.draftMarking) {
    return [meta.draftMarking, clip(meta.documentTitle, 70), meta.processNumber ? `Processo ${clip(meta.processNumber, 30)}` : null].filter(Boolean).join(" · ");
  }
  return [clip(meta.documentTitle, 70), meta.processNumber ? `Processo ${clip(meta.processNumber, 30)}` : null,
    meta.isDraft ? `${clip(meta.draftNoticeLabel ?? "RASCUNHO", 20)} — não é versão oficial` : null].filter(Boolean).join(" · ");
}

/** Renderiza o modelo institucional para DOCX. */
export async function renderInstitutionalDOCX(model: InstitutionalModel): Promise<Buffer> {
  const { meta } = model;
  const paras: (Paragraph | Table)[] = [];

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
  for (const n of meta.notices ?? []) {
    paras.push(new Paragraph({ children: [new TextRun({ text: n, bold: true, italics: true })], spacing: { after: 120 } }));
  }
  paras.push(new Paragraph({ text: "", border: { bottom: { color: "1e40af", size: 6, style: BorderStyle.SINGLE, space: 1 } } }));

  for (let bi = 0; bi < model.blocks.length; bi++) {
    const b = model.blocks[bi];
    if (b.kind === "paragraph" && b.keepWithNext) {
      // F3.1 — encerramento/assinaturas como UM bloco indivisível: tabela de uma célula, SEM bordas, com a linha marcada "não quebrar
      // entre páginas" (cantSplit) — respeitado pelo Word e pelo LibreOffice. A cadeia de "manter com o próximo" sozinha NÃO basta: o
      // LibreOffice a ignora quando só a última linha transborda (reproduzido: "CONTRATADO" isolado). Texto e ordem inalterados.
      const end = closingGroupEnd(model.blocks, bi);
      const cellParas = model.blocks.slice(bi, end).map((g) => new Paragraph({ spacing: { after: 120 }, children: runsToDocx(g.kind === "paragraph" ? g.runs : []) }));
      const width = Math.floor(CONTENT_WIDTH_PT * 20);
      paras.push(new Table({
        width: { size: width, type: WidthType.DXA }, columnWidths: [width], layout: TableLayoutType.FIXED, borders: TableBorders.NONE,
        margins: { left: 0, right: 0, top: 0, bottom: 0 },
        rows: [new TableRow({ cantSplit: true, children: [new TableCell({ width: { size: width, type: WidthType.DXA }, children: cellParas })] })],
      }));
      bi = end - 1;
      continue;
    }
    if (b.kind === "hr") { paras.push(new Paragraph({ text: "", border: { bottom: { color: "888888", size: 3, style: BorderStyle.SINGLE, space: 1 } } })); continue; }
    if (b.kind === "heading") {
      const level = [HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5][b.level - 1];
      // F3-C/D — tamanho/negrito/"manter com o próximo" vêm do ESTILO do título (styles abaixo); o anexo começa em página nova.
      // Negrito forçado nos runs: `tokensToRuns` grava bold=false explícito, que anularia o negrito do estilo.
      paras.push(new Paragraph({
        heading: level, ...(isAnnexHeading(b) ? { pageBreakBefore: true } : {}),
        children: runsToDocx(b.runs.map((r) => ({ ...r, bold: true })), b.level === 4),
      }));
    } else if (b.kind === "paragraph") {
      paras.push(new Paragraph({ spacing: { after: 120 }, children: runsToDocx(b.runs) }));
    } else if (b.kind === "list") {
      for (const item of b.items) paras.push(new Paragraph({ bullet: { level: 0 }, children: runsToDocx(item) }));
    } else if (b.kind === "notice") {
      paras.push(new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: "⚠ ", bold: true }), ...runsToDocx(b.runs, true)] }));
    } else if (b.kind === "table") {
      // Qualidade documental F1 — célula de tabela no MESMO corpo do PDF (9 pt) e linha nunca partida entre páginas.
      // F3-A — larguras PROPORCIONAIS ao conteúdo (mesmo cálculo do PDF): antes as colunas eram iguais e a descrição de uma tabela de
      // 8 colunas partia palavras ("HOMOLO/GAÇÃO"). Grade fixa em twips; a fonte só diminui (8/7,5 pt) se as palavras não couberem.
      const plan = planTableColumns(tableGrid(b.header, b.rows), CONTENT_WIDTH_PT, measureHelvetica, TABLE_CELL_PAD_PT);
      const halfPoints = Math.round(plan.fontSize * 2);
      const twips = plan.widths.map((w) => Math.floor(w * 20));
      const cell = (runs: InlineRun[], header: boolean, i: number): TableCell => new TableCell({
        width: { size: twips[i] ?? 0, type: WidthType.DXA },
        children: [new Paragraph({ alignment: docxAlign(b.align?.[i]), children: runsToDocx(header ? runs.map((r) => ({ ...r, bold: true })) : runs, false, halfPoints) })],
      });
      const rows = [new TableRow({ tableHeader: true, cantSplit: true, children: b.header.map((c, i) => cell(c, true, i)) }),
        ...b.rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, false, i)) }))];
      const pad = TABLE_CELL_PAD_PT * 20;
      paras.push(new Table({
        width: { size: twips.reduce((a, w) => a + w, 0), type: WidthType.DXA }, columnWidths: twips, layout: TableLayoutType.FIXED,
        margins: { left: pad, right: pad, top: 40, bottom: 40 }, rows,
      }));
      paras.push(new Paragraph({ text: "", spacing: { after: 120 } }));
    }
  }

  const footer = new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
    new TextRun({ text: `${footerText(meta)} · `, size: 16 }),
    new TextRun({ children: ["Página ", PageNumber.CURRENT, " de ", PageNumber.TOTAL_PAGES], size: 16 }),
  ] })] });
  const doc = new Document({
    styles: DOCX_INSTITUTIONAL_STYLES,
    // F3 — mesma área útil do PDF (A4, margens de 56 pt): a largura das tabelas é calculada uma vez para os dois formatos.
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: PAGE_MARGIN_TWIPS, right: PAGE_MARGIN_TWIPS, bottom: PAGE_MARGIN_TWIPS, left: PAGE_MARGIN_TWIPS } } },
      children: paras, footers: { default: footer } }],
  });
  return Packer.toBuffer(doc);
}

/**
 * F3-D — hierarquia ÚNICA de títulos (pt), igual no DOCX e no PDF: o título de seção/anexo do Edital (nível 2) é sempre maior que os
 * títulos do TR incorporado (níveis 3 e 4). Cabeçalho do arquivo: órgão 14 pt, título do documento 13 pt.
 */
export const HEADING_SIZES_PT: Record<HeadingDepth, number> = { 1: 13, 2: 12, 3: 11.5, 4: 11 };
const PAGE_MARGIN_PT = 56;
const PAGE_MARGIN_TWIPS = PAGE_MARGIN_PT * 20;
/** Largura útil da página A4 (595,28 pt − margens), comum aos dois renderizadores. */
const CONTENT_WIDTH_PT = 595.28 - PAGE_MARGIN_PT * 2;
const TABLE_CELL_PAD_PT = 3;

/** Estilos canônicos do DOCX institucional: Arial (métrica da Helvetica do PDF), corpo 11 pt, títulos com "manter com o próximo". */
const DOCX_INSTITUTIONAL_STYLES = (() => {
  const heading = (sizePt: number, opts: { italics?: boolean; before: number; after: number }) => ({
    run: { font: "Arial", size: Math.round(sizePt * 2), bold: true, italics: !!opts.italics, color: "000000" },
    // keepNext/keepLines: o título nunca fica isolado no fim da página (fica com o primeiro bloco do conteúdo).
    paragraph: { keepNext: true, keepLines: true, spacing: { before: opts.before, after: opts.after } },
  });
  return {
    default: {
      document: { run: { font: "Arial", size: 22 } },
      heading1: heading(14, { before: 0, after: 60 }),
      heading2: heading(HEADING_SIZES_PT[1], { before: 200, after: 100 }),
      heading3: heading(HEADING_SIZES_PT[2], { before: 200, after: 100 }),
      heading4: heading(HEADING_SIZES_PT[3], { before: 160, after: 80 }),
      heading5: heading(HEADING_SIZES_PT[4], { italics: true, before: 120, after: 60 }),
    },
  };
})();

/** F3-C — título de ANEXO do documento ("## ANEXO II — …"): começa em página nova nos dois formatos. */
export function isAnnexHeading(b: DocBlock): boolean {
  // Numeral romano ou letra única seguido de separador ("—", "–", "-", ":", ".") ou fim: "ANEXO II — …", "ANEXO B: …", "ANEXO III".
  return b.kind === "heading" && b.level <= 2 && /^ANEXO\s+(?:[IVXLCDM]+|[A-Z])(?=\s*(?:[—–:.-]|$))/i.test(b.runs.map((r) => r.text).join("").trim());
}

function docxAlign(a: CellAlign | undefined): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  return a === "right" ? AlignmentType.RIGHT : a === "center" ? AlignmentType.CENTER : undefined;
}

type MeasureText = (text: string, bold: boolean, sizePt: number) => number;
interface GridCell { readonly text: string; readonly bold: boolean }

function tableGrid(header: InlineRun[][], rows: InlineRun[][][]): GridCell[][] {
  const plain = (runs: InlineRun[]): string => runs.map((r) => r.text).join("");
  return [header.map((c) => ({ text: plain(c), bold: true })), ...rows.map((r) => r.map((c) => ({ text: plain(c), bold: c.some((x) => x.bold) })))];
}

/** Fontes candidatas da tabela (pt): 9 é o corpo de tabela da F1; só diminui se as palavras inteiras não couberem nas colunas. */
export const TABLE_FONT_SIZES_PT = [9, 8, 7.5] as const;

/**
 * F3-A — larguras das colunas proporcionais ao conteúdo (layout automático clássico), em pt. PURA (a medição é injetada):
 *  - mínimo de cada coluna = a maior PALAVRA da coluna (nenhuma palavra partida enquanto a soma dos mínimos couber);
 *  - preferido = o maior texto da coluna em uma linha; o espaço livre vai às colunas que mais precisam (ex.: Descrição);
 *  - se nem as palavras couberem na menor fonte, os mínimos são reduzidos proporcionalmente (a palavra quebra, o texto nunca se perde).
 * Uma palavra excepcionalmente longa (hash, URL) tem o mínimo limitado a 40% da largura para não esmagar as demais colunas.
 */
export function planTableColumns(grid: readonly (readonly GridCell[])[], totalWidth: number, measure: MeasureText, pad: number): { widths: number[]; fontSize: number } {
  const cols = Math.max(1, ...grid.map((r) => r.length));
  const extra = pad * 2 + 1.5; // folga para diferenças de arredondamento entre Word/LibreOffice/PDFKit
  let fontSize: number = TABLE_FONT_SIZES_PT[0];
  let min: number[] = [];
  let pref: number[] = [];
  for (const size of TABLE_FONT_SIZES_PT) {
    fontSize = size;
    min = new Array<number>(cols).fill(extra);
    pref = new Array<number>(cols).fill(extra);
    for (const row of grid) {
      row.forEach((c, i) => {
        const words = c.text.split(/\s+/).filter(Boolean);
        const longest = words.reduce((m, w) => Math.max(m, measure(w, c.bold, size)), 0);
        min[i] = Math.max(min[i], Math.min(longest + extra, totalWidth * 0.4));
        pref[i] = Math.max(pref[i], Math.min(measure(words.join(" "), c.bold, size) + extra, totalWidth));
      });
    }
    if (min.reduce((a, b) => a + b, 0) <= totalWidth) break;
  }
  const sumMin = min.reduce((a, b) => a + b, 0);
  const sumPref = pref.reduce((a, b) => a + b, 0);
  let widths: number[];
  if (sumMin >= totalWidth) widths = min.map((m) => (m * totalWidth) / sumMin);
  else if (sumPref <= totalWidth) widths = pref.map((p) => p + ((totalWidth - sumPref) * p) / sumPref);
  else {
    const k = (totalWidth - sumMin) / (sumPref - sumMin);
    widths = min.map((m, i) => m + (pref[i] - m) * k);
  }
  return { widths, fontSize };
}

let measuringDoc: PDFKit.PDFDocument | null = null;
/** Medição com as métricas da Helvetica do PDFKit (o DOCX usa Arial, de métrica compatível). Documento só de medição, nunca emitido. */
function measureHelvetica(text: string, bold: boolean, sizePt: number): number {
  measuringDoc ??= new PDFDocument({ size: "A4", autoFirstPage: false });
  return measuringDoc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(sizePt).widthOfString(text);
}

/** Corpo das células de tabela no DOCX (meios-pontos: 18 = 9 pt, o mesmo do PDF). */
export const DOCX_TABLE_FONT_HALF_POINTS = 18;

function runsToDocx(runs: InlineRun[], forceItalic = false, size?: number): TextRun[] {
  const list = runs.length ? runs : [{ text: "" }];
  return list.map((r) => new TextRun({ text: r.text, bold: r.bold, italics: forceItalic || r.italic, ...(size ? { size } : {}) }));
}

/** Renderiza o modelo institucional para PDF. */
export async function renderInstitutionalPDF(model: InstitutionalModel): Promise<Buffer> {
  const { meta } = model;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 56, size: "A4", bufferPages: true });
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
    for (const n of meta.notices ?? []) {
      doc.moveDown(0.3).fontSize(10).font("Helvetica-BoldOblique").fillColor("#92400e").text(n).fillColor("black");
    }
    doc.moveDown(0.4).moveTo(56, doc.y).lineTo(56 + pageWidth, doc.y).strokeColor("#1e40af").lineWidth(1.5).stroke().strokeColor("black").lineWidth(1).moveDown(0.6);

    model.blocks.forEach((b, bi) => {
      // F3.1 — início de um grupo de encerramento/assinaturas: reserva a altura MEDIDA do grupo inteiro (o grupo vai para a página
      // seguinte se não couber; nunca é partido). Grupo maior que meia página não é reservado (sem vazio grande).
      if (b.kind === "paragraph" && b.keepWithNext && !(bi > 0 && isKeptParagraph(model.blocks[bi - 1]))) {
        const group = model.blocks.slice(bi, closingGroupEnd(model.blocks, bi));
        const h = group.reduce((acc, g) => acc + (g.kind === "paragraph" ? paragraphHeightPDF(doc, g.runs, pageWidth) + 6 : 0), 0) + 4;
        if (h <= (doc.page.height - doc.page.margins.top - doc.page.margins.bottom) / 2) ensureSpacePDF(doc, h);
      }
      if (b.kind === "hr") { doc.moveDown(0.4).moveTo(56, doc.y).lineTo(56 + pageWidth, doc.y).strokeColor("#888").lineWidth(0.5).stroke().strokeColor("black").lineWidth(1).moveDown(0.4); return; }
      if (b.kind === "heading") {
        const size = HEADING_SIZES_PT[b.level];
        // F3-C — anexo em página nova (sem página em branco se já estiver no topo); demais títulos nunca isolados no fim da página.
        if (isAnnexHeading(b)) { if (doc.y > doc.page.margins.top + 1) doc.addPage(); }
        else { doc.moveDown(0.3); ensureSpacePDF(doc, size * 1.4 + 11 * 1.2 * 3); }
        writeRunsPDF(doc, b.runs, size, true, { paragraphGap: 3 }, b.level === 4);
      }
      else if (b.kind === "paragraph") { writeRunsPDF(doc, b.runs, 11, false, { align: "justify", paragraphGap: 6 }); }
      else if (b.kind === "list") { for (const item of b.items) { doc.fontSize(11).font("Helvetica").text("• ", { continued: true }); writeRunsPDF(doc, item, 11, false, { paragraphGap: 3 }); } doc.moveDown(0.2); }
      else if (b.kind === "notice") { writeNoticePDF(doc, b.runs, pageWidth); }
      else if (b.kind === "table") { writeTablePDF(doc, b.header, b.rows, pageWidth, b.align); }
    });
    // Pós-M8 — rodapé em todas as páginas (páginas bufferizadas), escrito na margem inferior com a margem zerada só durante a escrita
    // (nunca dispara página nova).
    const range = doc.bufferedPageRange();
    const label = footerText(meta);
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      // Duas caixas de UMA linha (height + ellipsis): o texto nunca quebra/transborda (com `width`, o PDFKit quebraria linhas e,
      // com páginas bufferizadas, criaria página nova); o número de página fica numa caixa própria e nunca é cortado.
      const y = doc.page.height - 36;
      doc.fontSize(8).font("Helvetica").fillColor("#555555")
        .text(label, 56, y, { width: pageWidth - 90, height: 10, ellipsis: true, lineBreak: false })
        .text(`Página ${i - range.start + 1} de ${range.count}`, 56 + pageWidth - 85, y, { width: 85, height: 10, align: "right", lineBreak: false });
      doc.page.margins.bottom = bottom;
    }
    doc.fillColor("black");
    doc.end();
  });
}

/** Fim (exclusivo) do grupo de encerramento que começa em `start`: os parágrafos `keepWithNext` + o parágrafo que os encerra. */
function closingGroupEnd(blocks: readonly DocBlock[], start: number): number {
  let j = start;
  while (j < blocks.length) {
    const g = blocks[j];
    if (g.kind !== "paragraph") return j;
    j++;
    if (!g.keepWithNext) return j;
  }
  return j;
}

function isKeptParagraph(b: DocBlock | undefined): boolean {
  return !!b && b.kind === "paragraph" && !!b.keepWithNext;
}

/** Altura de um parágrafo do corpo (11 pt, justificado) medida com a métrica do PDFKit; negrito medido pela fonte do trecho. */
function paragraphHeightPDF(doc: PDFKit.PDFDocument, runs: InlineRun[], pageWidth: number): number {
  const bold = runs.some((r) => r.bold);
  doc.fontSize(11).font(bold ? "Helvetica-Bold" : "Helvetica");
  return doc.heightOfString(runs.map((r) => r.text).join("") || " ", { width: pageWidth, align: "justify" });
}

/** Página nova quando o espaço restante não comporta `needed` pt (título + início do conteúdo, início de aviso). */
function ensureSpacePDF(doc: PDFKit.PDFDocument, needed: number): void {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom && doc.y > doc.page.margins.top + 1) doc.addPage();
}

/**
 * Tabela em grade (quebra de página por linha; cabeçalho repetido na página seguinte). Apresentação apenas.
 * F3-A — larguras proporcionais ao conteúdo (`planTableColumns`, o mesmo cálculo do DOCX) e alinhamento declarado na tabela.
 */
function writeTablePDF(doc: PDFKit.PDFDocument, header: InlineRun[][], rows: InlineRun[][][], pageWidth: number, align?: CellAlign[]): void {
  const pad = TABLE_CELL_PAD_PT;
  const grid = tableGrid(header, rows);
  const { widths, fontSize } = planTableColumns(grid, pageWidth, measureHelvetica, pad);
  const xs = widths.map((_, i) => 56 + widths.slice(0, i).reduce((a, w) => a + w, 0));
  const rowHeight = (cells: readonly GridCell[], bold: boolean): number => {
    doc.fontSize(fontSize).font(bold ? "Helvetica-Bold" : "Helvetica");
    const heights = cells.map((c, i) => doc.heightOfString(c.text, { width: (widths[i] ?? 0) - pad * 2 }));
    return Math.max(...heights, 10) + pad * 2;
  };
  const bottom = (): number => doc.page.height - doc.page.margins.bottom;
  const headerH = rowHeight(grid[0], true);
  const drawRow = (cells: readonly GridCell[], bold: boolean, repeatHeader: boolean): void => {
    const h = rowHeight(cells, bold);
    if (doc.y + h > bottom() && doc.y > doc.page.margins.top + 1) {
      doc.addPage();
      // Cabeçalho repetido só quando ele e a linha cabem juntos (uma linha quase do tamanho da página não é empurrada para fora).
      if (repeatHeader && doc.y + headerH + h <= bottom()) drawRow(grid[0], true, false);
    }
    const y = doc.y;
    cells.forEach((c, i) => {
      const w = widths[i] ?? 0;
      doc.rect(xs[i] ?? 56, y, w, h).strokeColor("#888").lineWidth(0.5).stroke().strokeColor("black");
      doc.fontSize(fontSize).font(bold ? "Helvetica-Bold" : "Helvetica")
        .text(c.text, (xs[i] ?? 56) + pad, y + pad, { width: w - pad * 2, align: align?.[i] === "right" ? "right" : align?.[i] === "center" ? "center" : "left" });
    });
    doc.x = 56;
    doc.y = y + h;
  };
  doc.moveDown(0.3);
  // Cabeçalho nunca órfão no fim da página: começa onde couberem o cabeçalho e a 1ª linha.
  ensureSpacePDF(doc, headerH + (grid.length > 1 ? rowHeight(grid[1], false) : 0));
  drawRow(grid[0], true, false);
  for (const r of grid.slice(1)) drawRow(r, false, true);
  doc.moveDown(0.5);
}

/**
 * F3-B — aviso (blockquote). O "⚠" (U+26A0) não existe na Helvetica do PDF (codificação WinAnsi): saía um glifo errado, desenhado
 * POR CIMA da primeira letra ("⚠Tabela"). Agora o símbolo é um triângulo VETORIAL (sem fonte nova nem imagem) e o texto vem recuado,
 * numa caixa própria, com a ordem e as quebras internas preservadas. A quebra final do bloco vira espaçamento controlado (nunca um
 * segmento `continued` pendente: o bloco seguinte sempre começa abaixo do aviso). O DOCX mantém o "⚠" (fontes do Word o têm).
 */
function writeNoticePDF(doc: PDFKit.PDFDocument, runs: InlineRun[], pageWidth: number): void {
  const icon = 16;
  const body = trimTrailingBreaks(runs);
  doc.moveDown(0.2).fontSize(10);
  ensureSpacePDF(doc, 10 * 1.2 * 2 + 4);
  const x = 56;
  const y = doc.y;
  drawWarningIcon(doc, x + 1, y + 0.5);
  doc.fillColor("#1e3a8a");
  writeRunsPDF(doc, body, 10, false, { width: pageWidth - icon, paragraphGap: 4 }, true, { x: x + icon, y });
  doc.fillColor("black");
  doc.x = 56;
  doc.moveDown(0.2);
}

/** Triângulo de alerta vetorial (âmbar) com "!" — não depende de glifo da fonte. */
function drawWarningIcon(doc: PDFKit.PDFDocument, x: number, y: number): void {
  doc.save();
  doc.polygon([x + 5.5, y], [x + 11, y + 9.6], [x, y + 9.6]).fill("#b45309");
  doc.rect(x + 4.85, y + 3.2, 1.3, 3.6).fill("#ffffff");
  doc.rect(x + 4.85, y + 7.5, 1.3, 1.2).fill("#ffffff");
  doc.restore();
  doc.fillColor("black");
}

/** Remove a(s) quebra(s) de linha/espaços FINAIS do aviso (as internas, entre parágrafos do aviso, ficam). */
export function trimTrailingBreaks(runs: readonly InlineRun[]): InlineRun[] {
  const out = runs.map((r) => ({ ...r }));
  while (out.length && /^\s*$/.test(out[out.length - 1].text)) out.pop();
  if (out.length) out[out.length - 1] = { ...out[out.length - 1], text: out[out.length - 1].text.replace(/\s+$/, "") };
  return out.length ? out : [{ text: "" }];
}

function pdfFont(bold: boolean, italic: boolean): string {
  if (bold && italic) return "Helvetica-BoldOblique";
  if (bold) return "Helvetica-Bold";
  if (italic) return "Helvetica-Oblique";
  return "Helvetica";
}

/**
 * Qualidade documental F1 — no PDFKit, um segmento `continued` com justificação DESCARTA o espaço inicial do segmento seguinte
 * (ex.: "**licitar e contratar** no âmbito" saía "contratarno âmbito"). O espaço em branco inicial de cada segmento passa para o FIM
 * do segmento anterior (mesmo texto, mesma ordem; só a fronteira do espaço muda). Pura; não afeta o DOCX nem o conteúdo emitido.
 */
export function pdfRunSpacing(runs: readonly InlineRun[]): InlineRun[] {
  const out: InlineRun[] = runs.map((r) => ({ ...r }));
  for (let i = 1; i < out.length; i++) {
    // Só espaço/tab: quebras de linha ("\n" que encerra avisos e citações) ficam onde estão.
    const lead = /^[ \t]+/.exec(out[i].text)?.[0];
    if (!lead) continue;
    out[i - 1] = { ...out[i - 1], text: out[i - 1].text + lead };
    out[i] = { ...out[i], text: out[i].text.slice(lead.length) };
  }
  // Segmento que ficou vazio não é desenhado (no PDFKit um "" `continued` não avança e distorce o espaçamento).
  const kept = out.filter((r) => r.text.length > 0);
  return kept.length ? kept : [{ text: "" }];
}

function writeRunsPDF(doc: PDFKit.PDFDocument, runs: InlineRun[], size: number, headingBold: boolean, opts: any = {}, forceItalic = false,
  at?: { x: number; y: number }): void {
  const list = runs.length ? pdfRunSpacing(runs) : [{ text: "" }];
  list.forEach((r, i) => {
    const last = i === list.length - 1;
    doc.fontSize(size).font(pdfFont(r.bold || headingBold, (r.italic || forceItalic) as boolean));
    // `at` posiciona só o 1º segmento (caixa do aviso); os seguintes continuam na mesma linha/caixa (`continued`).
    if (i === 0 && at) doc.text(r.text, at.x, at.y, { continued: !last, ...opts });
    else doc.text(r.text, { continued: !last, ...opts });
  });
}
