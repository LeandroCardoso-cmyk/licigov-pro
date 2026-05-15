import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx";

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

function stripInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1");
}

/**
 * Gera PDF do parecer jurídico com pdfkit (pure-JS, compatível Railway).
 */
export async function exportLegalOpinionToPDF(
  legalOpinion: LegalOpinion,
  settings: DocumentSettings,
  signatureBlock?: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 56, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - 112;
    const orgName = settings.organizationName || "Órgão Público";

    // Cabeçalho
    doc.fontSize(14).font("Helvetica-Bold").text(orgName, { align: "center" });
    if (settings.organizationAddress)
      doc.fontSize(9).font("Helvetica").text(settings.organizationAddress, { align: "center" });
    if (settings.organizationCnpj)
      doc.fontSize(9).font("Helvetica").text(`CNPJ: ${settings.organizationCnpj}`, { align: "center" });
    doc.moveDown(0.5)
      .moveTo(56, doc.y).lineTo(56 + pageWidth, doc.y)
      .strokeColor("black").lineWidth(1.5).stroke().lineWidth(1)
      .moveDown(0.8);

    // Título
    doc.fontSize(13).font("Helvetica-Bold").text("PARECER JURÍDICO", { align: "center" });
    doc.fontSize(11).font("Helvetica-Bold").text(legalOpinion.title, { align: "center" });
    doc.moveDown(1);

    const section = (title: string, body: string) => {
      doc.fontSize(11).font("Helvetica-Bold").text(title.toUpperCase());
      doc.moveDown(0.2)
        .moveTo(56, doc.y).lineTo(56 + pageWidth, doc.y)
        .strokeColor("#666").lineWidth(0.5).stroke().strokeColor("black").lineWidth(1)
        .moveDown(0.4);
      doc.fontSize(11).font("Helvetica").text(stripInline(body), { align: "justify", lineGap: 1 });
      doc.moveDown(0.8);
    };

    section("Questão Jurídica", legalOpinion.legalQuestion);
    if (legalOpinion.context) section("Contexto", legalOpinion.context);
    section("Parecer", legalOpinion.opinion || "Parecer não gerado ainda.");
    section("Conclusão", legalOpinion.conclusion || "Conclusão não disponível.");

    // Data
    doc.moveDown(0.5).fontSize(10).font("Helvetica-Oblique")
      .text(`Data: ${new Date(legalOpinion.createdAt).toLocaleDateString("pt-BR")}`, { align: "right" });

    // Assinatura
    if (signatureBlock) {
      doc.moveDown(1).fontSize(10).font("Helvetica")
        .text(stripInline(signatureBlock), { align: "center" });
    }

    // Rodapé
    const footerParts = [
      settings.organizationPhone,
      settings.organizationEmail,
      settings.organizationWebsite,
    ].filter(Boolean).join(" | ");
    if (footerParts) {
      doc.moveDown(1)
        .moveTo(56, doc.y).lineTo(56 + pageWidth, doc.y)
        .strokeColor("black").lineWidth(0.5).stroke().lineWidth(1)
        .moveDown(0.4);
      doc.fontSize(9).font("Helvetica").text(footerParts, { align: "center" });
    }

    doc.end();
  });
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

