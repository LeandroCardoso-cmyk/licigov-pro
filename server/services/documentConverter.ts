import PDFDocument from "pdfkit";
import { Lexer } from "marked";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx";

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
