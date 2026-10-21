/**
 * M8 (cobertura do provenance scan) — PDF sintético de TEXTO NATIVO com N páginas: tabela de cotações na página 1, texto
 * útil (não digitalizado) nas demais e, opcionalmente, a declaração global de dados fictícios numa página escolhida.
 * Leve (~350 KB para 501 páginas; parse ≈ 2 s): todas as páginas têm texto, então nenhuma vai para OCR.
 */
import PDFDocument from "pdfkit";

export const FICTITIOUS_TITLE = "PESQUISA DE PREÇOS — DADOS FICTÍCIOS PARA HOMOLOGAÇÃO";
const FILLER = "Anexo descritivo da pesquisa de preços com informações complementares sobre as especificações técnicas, condições de fornecimento, prazos de entrega e garantias exigidas pela administração municipal para os itens cotados.";

export function nativeTextPdf(pageCount: number, declarationOnPage: number | null): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.fontSize(10);
    doc.text("Descrição               Qtd      Unid     V.Unit       Total");
    doc.text("Caneta azul             100      UN       1,50         150,00");
    doc.text("Papel A4 resma          50       RESMA    18,90        945,00");
    for (let p = 2; p <= pageCount; p++) {
      doc.addPage();
      doc.text(p === declarationOnPage ? FICTITIOUS_TITLE : `Página ${p}. ${FILLER}`);
    }
    doc.end();
  });
}
