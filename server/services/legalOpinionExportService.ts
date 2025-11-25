import { marked } from "marked";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx";
import puppeteer from "puppeteer";

interface LegalOpinion {
  id: number;
  title: string;
  legalQuestion: string;
  context: string | null;
  opinion: string | null;
  conclusion: string | null;
  createdAt: Date;
}

interface DocumentSettings {
  organizationName: string | null;
  organizationAddress: string | null;
  organizationCnpj: string | null;
  organizationPhone: string | null;
  organizationEmail: string | null;
  organizationWebsite: string | null;
  logoUrl: string | null;
}

/**
 * Gera PDF do parecer jurídico com formatação profissional
 */
export async function exportLegalOpinionToPDF(
  legalOpinion: LegalOpinion,
  settings: DocumentSettings,
  signatureBlock?: string
): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    
    const html = generateHTML(legalOpinion, settings, signatureBlock);
    
    await page.setContent(html, { waitUntil: "networkidle0" });
    
    const pdfBuffer = await page.pdf({
      format: "A4",
      margin: {
        top: "2cm",
        right: "2cm",
        bottom: "2cm",
        left: "2cm",
      },
      printBackground: true,
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}

/**
 * Gera DOCX do parecer jurídico com formatação profissional
 */
export async function exportLegalOpinionToDOCX(
  legalOpinion: LegalOpinion,
  settings: DocumentSettings,
  signatureBlock?: string
): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          // Cabeçalho
          new Paragraph({
            text: settings.organizationName || "Órgão Público",
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({
            text: settings.organizationAddress || "",
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({
            text: `CNPJ: ${settings.organizationCnpj || ""}`,
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({ text: "" }), // Espaço

          // Título do Parecer
          new Paragraph({
            text: "PARECER JURÍDICO",
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({
            text: legalOpinion.title,
            heading: HeadingLevel.HEADING_2,
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({ text: "" }),

          // Questão Jurídica
          new Paragraph({
            text: "QUESTÃO JURÍDICA",
            heading: HeadingLevel.HEADING_2,
          }),
          new Paragraph({
            text: legalOpinion.legalQuestion,
          }),
          new Paragraph({ text: "" }),

          // Contexto (se houver)
          ...(legalOpinion.context
            ? [
                new Paragraph({
                  text: "CONTEXTO",
                  heading: HeadingLevel.HEADING_2,
                }),
                new Paragraph({
                  text: legalOpinion.context,
                }),
                new Paragraph({ text: "" }),
              ]
            : []),

          // Parecer
          new Paragraph({
            text: "PARECER",
            heading: HeadingLevel.HEADING_2,
          }),
          ...(legalOpinion.opinion
            ? legalOpinion.opinion.split("\n\n").map(
                (para) =>
                  new Paragraph({
                    text: para,
                  })
              )
            : [new Paragraph({ text: "Parecer não gerado ainda." })]),
          new Paragraph({ text: "" }),

          // Conclusão
          new Paragraph({
            text: "CONCLUSÃO",
            heading: HeadingLevel.HEADING_2,
          }),
          ...(legalOpinion.conclusion
            ? legalOpinion.conclusion.split("\n\n").map(
                (para) =>
                  new Paragraph({
                    text: para,
                  })
              )
            : [new Paragraph({ text: "Conclusão não disponível." })]),
          new Paragraph({ text: "" }),

          // Assinatura Digital
          ...(signatureBlock
            ? signatureBlock.split("\n\n").map(
                (para) =>
                  new Paragraph({
                    text: para.replace(/[#*`]/g, ""), // Remove markdown
                  })
              )
            : []),
          new Paragraph({ text: "" }),

          // Rodapé
          new Paragraph({
            text: `Data: ${legalOpinion.createdAt.toLocaleDateString("pt-BR")}`,
            alignment: AlignmentType.RIGHT,
          }),
          new Paragraph({
            text: settings.organizationEmail || "",
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({
            text: settings.organizationPhone || "",
            alignment: AlignmentType.CENTER,
          }),
        ],
      },
    ],
  });

  return await Packer.toBuffer(doc);
}

/**
 * Gera HTML para renderização do PDF
 */
function generateHTML(legalOpinion: LegalOpinion, settings: DocumentSettings, signatureBlock?: string): string {
  const opinionHTML = legalOpinion.opinion ? marked(legalOpinion.opinion) : "<p>Parecer não gerado ainda.</p>";
  const conclusionHTML = legalOpinion.conclusion ? marked(legalOpinion.conclusion) : "<p>Conclusão não disponível.</p>";
  const signatureHTML = signatureBlock ? marked(signatureBlock) : "";

  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${legalOpinion.title}</title>
      <style>
        body {
          font-family: 'Times New Roman', serif;
          font-size: 12pt;
          line-height: 1.6;
          color: #000;
          margin: 0;
          padding: 0;
        }
        .header {
          text-align: center;
          margin-bottom: 30px;
          border-bottom: 2px solid #000;
          padding-bottom: 15px;
        }
        .header h1 {
          font-size: 16pt;
          margin: 5px 0;
        }
        .header p {
          margin: 3px 0;
          font-size: 10pt;
        }
        .title {
          text-align: center;
          margin: 30px 0;
        }
        .title h2 {
          font-size: 14pt;
          font-weight: bold;
          margin: 10px 0;
        }
        .section {
          margin: 20px 0;
        }
        .section h3 {
          font-size: 12pt;
          font-weight: bold;
          text-transform: uppercase;
          border-bottom: 1px solid #000;
          padding-bottom: 5px;
          margin-bottom: 10px;
        }
        .section p {
          text-align: justify;
          margin: 10px 0;
        }
        .footer {
          text-align: center;
          margin-top: 40px;
          padding-top: 15px;
          border-top: 1px solid #000;
          font-size: 10pt;
        }
        .date {
          text-align: right;
          margin-top: 30px;
          font-style: italic;
        }
      </style>
    </head>
    <body>
      <!-- Cabeçalho -->
      <div class="header">
        <h1>${settings.organizationName || "Órgão Público"}</h1>
        <p>${settings.organizationAddress || ""}</p>
        <p>CNPJ: ${settings.organizationCnpj || ""}</p>
      </div>

      <!-- Título -->
      <div class="title">
        <h2>PARECER JURÍDICO</h2>
        <h2>${legalOpinion.title}</h2>
      </div>

      <!-- Questão Jurídica -->
      <div class="section">
        <h3>Questão Jurídica</h3>
        <p>${legalOpinion.legalQuestion}</p>
      </div>

      ${
        legalOpinion.context
          ? `
      <!-- Contexto -->
      <div class="section">
        <h3>Contexto</h3>
        <p>${legalOpinion.context}</p>
      </div>
      `
          : ""
      }

      <!-- Parecer -->
      <div class="section">
        <h3>Parecer</h3>
        ${opinionHTML}
      </div>

      <!-- Conclusão -->
      <div class="section">
        <h3>Conclusão</h3>
        ${conclusionHTML}
      </div>

      <!-- Data -->
      <div class="date">
        <p><strong>Data:</strong> ${new Date(legalOpinion.createdAt).toLocaleDateString("pt-BR")}</p>
      </div>

      <!-- Assinatura Digital -->
      ${signatureHTML ? `<div class="section">${signatureHTML}</div>` : ""}

      <!-- Rodapé -->
      <div class="footer">
        <p>${settings.organizationPhone || ""} | ${settings.organizationEmail || ""} | ${settings.organizationWebsite || ""}</p>
      </div>
    </body>
    </html>
  `;
}
