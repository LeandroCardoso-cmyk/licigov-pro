import { marked } from "marked";
import puppeteer from "puppeteer";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx";

/**
 * Converte Markdown para PDF com cabeçalho e rodapé personalizados
 */
export async function convertToPDF(
  content: string,
  fileName: string,
  organizationName?: string,
  address?: string,
  cnpj?: string,
  phone?: string,
  email?: string,
  website?: string
): Promise<Buffer> {
  // Converter Markdown para HTML
  const htmlContent = await marked(content);

  // Construir cabeçalho HTML
  let headerHTML = "";
  if (organizationName) {
    headerHTML = `
      <div style="text-align: center; border-bottom: 2px solid #1e40af; padding-bottom: 10px; margin-bottom: 20px;">
        <h2 style="color: #1e40af; margin: 0;">${organizationName}</h2>
        ${address ? `<p style="margin: 5px 0;">${address}</p>` : ""}
        ${cnpj ? `<p style="margin: 5px 0;">CNPJ: ${cnpj}</p>` : ""}
      </div>
    `;
  }

  // Construir rodapé HTML
  let footerHTML = "";
  if (phone || email || website) {
    footerHTML = `
      <div style="text-align: center; border-top: 2px solid #1e40af; padding-top: 10px; margin-top: 20px; font-size: 12px;">
        <p style="margin: 5px 0;"><strong>Contato:</strong></p>
        ${phone ? `<p style="margin: 5px 0;">Telefone: ${phone}</p>` : ""}
        ${email ? `<p style="margin: 5px 0;">E-mail: ${email}</p>` : ""}
        ${website ? `<p style="margin: 5px 0;">Website: ${website}</p>` : ""}
      </div>
    `;
  }

  // HTML completo
  const fullHTML = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body {
            font-family: 'Times New Roman', Times, serif;
            line-height: 1.6;
            max-width: 800px;
            margin: 0 auto;
            padding: 40px;
          }
          h1, h2, h3 { color: #1e40af; }
          h1 { font-size: 24px; }
          h2 { font-size: 20px; }
          h3 { font-size: 16px; }
          p { text-align: justify; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #f3f4f6; }
        </style>
      </head>
      <body>
        ${headerHTML}
        ${htmlContent}
        ${footerHTML}
      </body>
    </html>
  `;

  // Gerar PDF usando Puppeteer
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(fullHTML, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "A4",
      margin: {
        top: "20mm",
        right: "20mm",
        bottom: "20mm",
        left: "20mm",
      },
      printBackground: true,
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
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
