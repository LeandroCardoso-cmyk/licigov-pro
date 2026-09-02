/**
 * V1 — Bloco de ASSINATURA institucional no render comum (DOCX/PDF).
 *
 * O ato de assinatura do Parecer é METADADO institucional (representação do documento),
 * nunca alteração do conteúdo jurídico. Este teste prova, no PIPELINE COMUM
 * (buildInstitutionalModel + renderInstitutionalDOCX/PDF — sem renderer paralelo):
 *
 *  - `InstitutionalMeta.signature` presente ⇒ bloco "Assinatura" ao final com
 *    Responsável, Função/Papel, Método (Manual), Assinado em e o aviso institucional
 *    NÃO-ICP; os mesmos dados aparecem no DOCX real e no PDF real;
 *  - `signature` ausente ⇒ NENHUM bloco de assinatura (documento de outro domínio /
 *    rascunho não-assinado permanece inalterado);
 *  - nenhum wording que induza equivalência a ICP-Brasil/GOV.BR/certificado A1.
 */
import { describe, it, expect } from "vitest";
import { inflateRawSync } from "zlib";
import {
  buildInstitutionalModel, renderInstitutionalDOCX, renderInstitutionalPDF,
  type InstitutionalMeta, type InlineRun,
} from "../../services/documentConverter";

const allText = (runs: InlineRun[]) => runs.map((r) => r.text).join("");

/** Extrai o texto de um PDF usando a mesma biblioteca (PDFParse) do projeto. */
async function pdfText(buf: Buffer): Promise<string> {
  const { PDFParse } = (await import("pdf-parse")) as unknown as {
    PDFParse: new (o: { data: Uint8Array; verbosity?: number }) => { getText(): Promise<{ text?: string; pages: Array<{ text: string }> }> };
  };
  const parser = new PDFParse({ data: new Uint8Array(buf), verbosity: 0 });
  const res = await parser.getText();
  const joined = res.text ?? res.pages.map((p) => p.text).join("\n");
  return joined.replace(/\s+/g, " ");
}

/** Extrai o texto de `word/document.xml` de um DOCX (ZIP) sem dependência externa. */
function docxText(buf: Buffer): string {
  let i = 0;
  while (i < buf.length - 4) {
    if (buf.readUInt32LE(i) === 0x04034b50) { // local file header
      const method = buf.readUInt16LE(i + 8);
      const compSize = buf.readUInt32LE(i + 18);
      const nameLen = buf.readUInt16LE(i + 26);
      const extraLen = buf.readUInt16LE(i + 28);
      const name = buf.toString("utf8", i + 30, i + 30 + nameLen);
      const dataStart = i + 30 + nameLen + extraLen;
      if (name === "word/document.xml") {
        const data = buf.subarray(dataStart, dataStart + compSize);
        const xml = method === 0 ? data.toString("utf8") : inflateRawSync(data).toString("utf8");
        return xml.replace(/<[^>]+>/g, ""); // texto visível (sem tags)
      }
      i = dataStart + compSize;
    } else i++;
  }
  return "";
}

const BASE_CONTENT = [
  "# Parecer Jurídico",
  "## Relatório",
  "Relatório do parecer sobre a contratação.",
  "## Conclusão",
  "Conclusão: pela viabilidade jurídica.",
].join("\n");

const SIGNER = "Gestor Homologacao";
const ROLE = "manager";
const SIGNED_AT_LABEL = "31/08/2026 às 08:53";

const META_SIGNED: InstitutionalMeta = {
  organizationName: "Prefeitura Municipal de Moreira Sales",
  documentTitle: "Parecer Inicial",
  processNumber: "DL-2026/0001",
  statusLabel: "EMITIDO",
  isDraft: false,
  version: 2,
  exportedAtLabel: "31/08/2026 às 09:00",
  signature: {
    signed: true,
    signerName: SIGNER,
    signerRole: ROLE,
    methodLabel: "Manual",
    signedAtLabel: SIGNED_AT_LABEL,
  },
};

const META_UNSIGNED: InstitutionalMeta = {
  organizationName: "Prefeitura Municipal de Moreira Sales",
  documentTitle: "TR — Termo de Referência",
  statusLabel: "GERADO",
  isDraft: true,
  version: 1,
  exportedAtLabel: "31/08/2026 às 09:00",
  // sem signature
};

describe("V1 · bloco de assinatura no render institucional comum", () => {
  it("modelo: signature presente gera bloco 'Assinatura' com todos os campos (não-ICP)", () => {
    const model = buildInstitutionalModel(BASE_CONTENT, META_SIGNED);
    const flat = model.blocks.map((b) => (b.kind === "heading" || b.kind === "paragraph") ? allText(b.runs) : `[${b.kind}]`);
    const joined = flat.join("\n");
    expect(joined).toContain("Assinatura");
    expect(joined).toContain(`Responsável: ${SIGNER}`);
    expect(joined).toContain(`Função/Papel: ${ROLE}`);
    expect(joined).toContain("Método: Manual");
    expect(joined).toContain(`Assinado em: ${SIGNED_AT_LABEL}`);
    expect(joined).toContain("Assinatura registrada no LiciGov Pro — método manual.");
    // NÃO induzir equivalência jurídica com assinatura digital.
    expect(joined).not.toMatch(/ICP-?Brasil|GOV\.?BR|certificado A1|criptográfic/i);
    // A assinatura vem DEPOIS do conteúdo jurídico (ao final do documento).
    const idxConclusao = joined.indexOf("pela viabilidade");
    const idxAssinatura = joined.indexOf("Assinatura");
    expect(idxAssinatura).toBeGreaterThan(idxConclusao);
  });

  it("DOCX real contém signer/nome/papel/método/data (texto do word/document.xml)", async () => {
    const buf = await renderInstitutionalDOCX(buildInstitutionalModel(BASE_CONTENT, META_SIGNED));
    expect(Buffer.isBuffer(buf)).toBe(true);
    const text = docxText(buf);
    expect(text).toContain("Assinatura");
    expect(text).toContain(SIGNER);
    expect(text).toContain(ROLE);
    expect(text).toContain("Manual");
    expect(text).toContain(SIGNED_AT_LABEL);
    expect(text).toContain("Assinatura registrada no LiciGov Pro");
    expect(text).not.toMatch(/ICP-?Brasil|GOV\.?BR|certificado A1/i);
  }, 30_000);

  it("PDF real contém os mesmos dados de assinatura (texto extraído)", async () => {
    const buf = await renderInstitutionalPDF(buildInstitutionalModel(BASE_CONTENT, META_SIGNED));
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    const text = await pdfText(buf);
    expect(text).toContain("Assinatura");
    expect(text).toContain(SIGNER);
    expect(text).toContain(ROLE);
    expect(text).toContain("Manual");
    expect(text).toContain(SIGNED_AT_LABEL);
    expect(text).toContain("Assinatura registrada no LiciGov Pro");
    expect(text).not.toMatch(/ICP-?Brasil|GOV\.?BR|certificado A1/i);
  }, 30_000);

  it("sem signature: NENHUM bloco de assinatura (outro domínio/rascunho inalterado)", async () => {
    const model = buildInstitutionalModel(BASE_CONTENT, META_UNSIGNED);
    const joined = model.blocks.map((b) => (b.kind === "heading" || b.kind === "paragraph") ? allText(b.runs) : "").join("\n");
    expect(joined).not.toContain("Assinatura");
    expect(joined).not.toContain("Responsável:");
    expect(joined).not.toContain("Assinatura registrada no LiciGov Pro");
    const docx = docxText(await renderInstitutionalDOCX(model));
    expect(docx).not.toContain("Assinatura registrada no LiciGov Pro");
    const pdf = await pdfText(await renderInstitutionalPDF(model));
    expect(pdf).not.toContain("Assinatura registrada no LiciGov Pro");
  }, 30_000);

  it("signature sem papel: bloco omite 'Função/Papel' mas mantém demais campos", () => {
    const meta: InstitutionalMeta = { ...META_SIGNED, signature: { signed: true, signerName: SIGNER, methodLabel: "Manual", signedAtLabel: SIGNED_AT_LABEL } };
    const joined = buildInstitutionalModel(BASE_CONTENT, meta).blocks
      .map((b) => (b.kind === "heading" || b.kind === "paragraph") ? allText(b.runs) : "").join("\n");
    expect(joined).toContain(`Responsável: ${SIGNER}`);
    expect(joined).not.toContain("Função/Papel:");
    expect(joined).toContain("Método: Manual");
  });
});
