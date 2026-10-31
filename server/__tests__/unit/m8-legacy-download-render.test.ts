/**
 * Pós-M8 — rota legada `documentEngine.download` (renderOfficialDocument): COMPORTAMENTO com o renderizador institucional.
 * Emitido ⇒ sem marca de rascunho; não emitido ⇒ marcado pelo próprio status; tabelas preservadas; marcadores internos fora;
 * ledger de artefatos chamado como antes (contrato e permissões inalterados).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PDFParse } from "pdf-parse";

vi.mock("../../db/officialDocuments", async (importOriginal) => ({ ...(await importOriginal<object>()), getOfficialDocument: vi.fn() }));
vi.mock("../../services/officialDocumentLifecycleService", async (importOriginal) => ({ ...(await importOriginal<object>()), storeRenderedArtifact: vi.fn() }));
vi.mock("../../services/kernelAccessService", () => ({ assertKernelAccess: vi.fn() }));

import { getOfficialDocument } from "../../db/officialDocuments";
import { storeRenderedArtifact } from "../../services/officialDocumentLifecycleService";
import { renderOfficialDocument } from "../../services/documentEngineService";

const CONTENT = ["# TR", "", "<!-- licigov:itens-autoritativos:inicio -->", "| Item | Valor |", "|---:|---:|", "| 1 | 10,00 |", "<!-- licigov:itens-autoritativos:fim -->"].join("\n");
const doc = (status: string) => ({ id: "d1", organizationId: 2, businessDomain: "processo_licitatorio", documentType: "tr", title: "TR — objeto", content: CONTENT, status, version: 2 });
async function textOf(buf: Buffer): Promise<string> {
  const p = new PDFParse({ data: new Uint8Array(buf), verbosity: 0 });
  try { return (await p.getText()).text; } finally { await p.destroy?.(); }
}

describe("documentEngine.download — renderizador institucional", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(storeRenderedArtifact).mockImplementation(async (a: { buffer: Buffer }) => ({ artifactHash: "h", bytes: a.buffer.length }) as never); });
  it("emitido: sem RASCUNHO; tabela preservada; marcadores fora; ledger chamado com o buffer renderizado (tenant da chamada)", async () => {
    vi.mocked(getOfficialDocument).mockResolvedValue(doc("emitido") as never);
    await renderOfficialDocument({ organizationId: 2, documentId: "d1", format: "pdf", actorUserId: 5 });
    expect(getOfficialDocument).toHaveBeenCalledWith("d1", 2);
    const arg = vi.mocked(storeRenderedArtifact).mock.calls[0][0] as unknown as { buffer: Buffer; format: string; actorUserId: number };
    expect(arg.format).toBe("pdf"); expect(arg.actorUserId).toBe(5);
    const t = await textOf(arg.buffer);
    expect(t).not.toMatch(/RASCUNHO|não é versão oficial/);
    expect(t).toContain("10,00"); expect(t).not.toContain("licigov:");
    expect(t).toContain("Página 1 de 1");
  });
  it("não emitido ('gerado'): marcado como não final pelo próprio status", async () => {
    vi.mocked(getOfficialDocument).mockResolvedValue(doc("gerado") as never);
    await renderOfficialDocument({ organizationId: 2, documentId: "d1", format: "pdf", actorUserId: 5 });
    const t = await textOf((vi.mocked(storeRenderedArtifact).mock.calls[0][0] as never).buffer);
    expect(t).toContain("GERADO — não é versão oficial");
  });
  it("documento de outro tenant/inexistente ⇒ erro, nada renderizado nem gravado", async () => {
    vi.mocked(getOfficialDocument).mockResolvedValue(null as never);
    await expect(renderOfficialDocument({ organizationId: 2, documentId: "x", format: "docx", actorUserId: 5 })).rejects.toThrow();
    expect(storeRenderedArtifact).not.toHaveBeenCalled();
  });
});
