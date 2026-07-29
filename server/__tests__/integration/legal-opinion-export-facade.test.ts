/**
 * PR B.1 — Façade de exportação do Parecer Jurídico (legado `legal_opinions`).
 * Deve delegar ao Document Engine comum (renderInstitutionalContent), sem renderer
 * próprio, mapeando status real; contrato público (Buffer) preservado.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../services/documentEngineService", () => ({
  renderInstitutionalContent: vi.fn().mockResolvedValue(Buffer.from("%PDF-bin")),
}));

import { exportLegalOpinionToPDF, exportLegalOpinionToDOCX } from "../../services/legalOpinionExportService";
import { renderInstitutionalContent } from "../../services/documentEngineService";

const OP = {
  id: 7, title: "Consulta X", legalQuestion: "É obrigatório o ETP?",
  context: "Contexto do caso", opinion: "**Parecer** favorável nos termos...",
  conclusion: "favorable", createdAt: new Date("2026-07-26T00:00:00Z"), status: "in_review",
};
const SETTINGS = {
  organizationName: "Prefeitura de Moreira Sales", organizationAddress: null, organizationCnpj: null,
  organizationPhone: null, organizationEmail: null, organizationWebsite: null, logoUrl: null,
};

describe("PR B.1 · legalOpinionExportService (façade)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("PDF: delega ao Document Engine comum e retorna Buffer", async () => {
    const buf = await exportLegalOpinionToPDF(OP as any, SETTINGS as any);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(renderInstitutionalContent).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(renderInstitutionalContent).mock.calls[0][0];
    expect(arg.format).toBe("pdf");
    // conteúdo montado a partir das seções persistidas (sem renderer próprio)
    expect(arg.content).toContain("Questão Jurídica");
    expect(arg.content).toContain("É obrigatório o ETP?");
    expect(arg.content).toContain("Parecer");
    expect(arg.content).toContain("Conclusão");
    // status real mapeado
    expect(arg.meta.statusLabel).toBe("EM REVISÃO");
    expect(arg.meta.isDraft).toBe(true);
    expect(arg.meta.documentTitle).toBe("Parecer Jurídico — Consulta X");
    expect(arg.meta.organizationName).toBe("Prefeitura de Moreira Sales");
  });

  it("DOCX: delega ao mesmo modelo (composição idêntica)", async () => {
    await exportLegalOpinionToDOCX(OP as any, SETTINGS as any);
    expect(vi.mocked(renderInstitutionalContent).mock.calls[0][0].format).toBe("docx");
  });

  it("status 'approved' → APROVADO, não rascunho", async () => {
    await exportLegalOpinionToPDF({ ...OP, status: "approved" } as any, SETTINGS as any);
    const arg = vi.mocked(renderInstitutionalContent).mock.calls[0][0];
    expect(arg.meta.statusLabel).toBe("APROVADO");
    expect(arg.meta.isDraft).toBe(false);
  });

  it("inclui bloco de assinatura quando fornecido", async () => {
    await exportLegalOpinionToPDF(OP as any, SETTINGS as any, "Assinado por Fulano");
    expect(vi.mocked(renderInstitutionalContent).mock.calls[0][0].content).toContain("Assinado por Fulano");
  });
});
