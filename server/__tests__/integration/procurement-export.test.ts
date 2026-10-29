/**
 * PR B — Adapter de exportação do Processo Licitatório (procurementProcess.exportDocument).
 * Mapeia (processId, kind) → conteúdo canônico e delega ao núcleo comum.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db/procurement");
vi.mock("../../db/organizations", () => ({
  getOrganizationById: vi.fn().mockResolvedValue({ id: 1, nome: "Prefeitura de Moreira Sales" }),
}));
vi.mock("../../services/documentExportService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/documentExportService")>();
  return {
    ...actual, // mantém formatBrazilianDateTime real
    exportDocument: vi.fn().mockResolvedValue({
      key: "exports/processo/1/1_ETP.pdf", url: "https://s3/signed", format: "pdf",
      mimeType: "application/pdf", fileName: "ETP_100-2026_rascunho_v1.pdf",
    }),
  };
});
vi.mock("../../db/officialDocumentPromotions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../db/officialDocumentPromotions")>()),
  getLatestOfficialPromotion: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../services/officialDocumentExportAdapter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/officialDocumentExportAdapter")>()),
  exportOfficialDocument: vi.fn().mockResolvedValue({ url: "https://s3/official", format: "pdf", fileName: "TR_100-2026_emitido_v2.pdf", artifactHash: "a", artifactId: null, artifactReused: false }),
}));
vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn().mockResolvedValue({
    organizationId: 1,
    membership: { id: 1, organizationId: 1, userId: 1, role: "owner", invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  }),
  getMembership: vi.fn().mockResolvedValue({ id: 1, organizationId: 1, userId: 1, role: "owner", invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() }),
  NO_ORGANIZATION_MEMBERSHIP: "NO_ORGANIZATION_MEMBERSHIP",
}));
vi.mock("../../_core/sdk", () => ({
  sdk: { signSession: vi.fn().mockResolvedValue("t"), authenticateRequest: vi.fn().mockResolvedValue(null) },
}));

import { procurementProcessRouter } from "../../routers/procurementProcessRouter";
import * as procDb from "../../db/procurement";
import { exportDocument as exportCore } from "../../services/documentExportService";
import { makeContext, mockUser } from "../helpers/fixtures";
import { getLatestOfficialPromotion } from "../../db/officialDocumentPromotions";
import { exportOfficialDocument } from "../../services/officialDocumentExportAdapter";
import { draftContentHash } from "../../domain/generatedDocument";

const PID = "proc-x";
const proc = { id: PID, organizationId: 1, processNumber: "100/2026", object: "Aquisição" };

describe("procurementProcess.exportDocument (adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(procDb.getProcess).mockResolvedValue(proc as never);
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(
      { id: "d1", kind: "etp", title: "ETP — X", content: "# ETP\nconteúdo", status: "rascunho", updatedAt: "2026-07-26T00:00:00.000Z" } as never,
    );
    vi.mocked(procDb.recordProcessEvent).mockResolvedValue(undefined as never);
    vi.mocked(procDb.listIntelligentItems).mockResolvedValue([] as never);
  });

  it("pós-M8: rascunho com item de cotação fictícia ⇒ aviso de VALORES DEMONSTRATIVOS no cabeçalho do arquivo; sem fictícia ⇒ nenhum", async () => {
    const caller = procurementProcessRouter.createCaller(makeContext(mockUser));
    await caller.exportDocument({ processId: PID, kind: "etp", format: "pdf" });
    expect(vi.mocked(exportCore).mock.calls[0][0].meta?.notices).toEqual([]);
    vi.mocked(procDb.listIntelligentItems).mockResolvedValue([{ status: "aprovado", fictitiousQuoteCount: 3 }] as never);
    await caller.exportDocument({ processId: PID, kind: "etp", format: "docx" });
    expect(vi.mocked(exportCore).mock.calls[1][0].meta?.notices?.[0]).toMatch(/^VALORES DEMONSTRATIVOS — 1 item\(ns\) deste processo com 3 cotação/);
  });

  it("exporta o documento canônico chamando o núcleo comum e retorna a URL", async () => {
    const caller = procurementProcessRouter.createCaller(makeContext(mockUser));
    const r = await caller.exportDocument({ processId: PID, kind: "etp", format: "pdf" });

    expect(r.url).toBe("https://s3/signed");
    expect(r.fileName).toBe("ETP_100-2026_rascunho_v1.pdf");
    // Delegou ao núcleo comum com o conteúdo do documento + metadados institucionais.
    const arg = vi.mocked(exportCore).mock.calls[0][0];
    expect(arg.content).toContain("conteúdo"); // conteúdo persistido, fiel
    expect(arg.baseName).toBe("ETP_100/2026");
    expect(arg.downloadBaseName).toBe("ETP_100-2026_rascunho_v1"); // determinístico, sem timestamp
    expect(arg.organizationId).toBe(1);
    expect(arg.meta?.statusLabel).toBe("RASCUNHO");
    expect(arg.meta?.isDraft).toBe(true);
    expect(arg.meta?.processNumber).toBe("100/2026");
    expect(arg.meta?.organizationName).toBe("Prefeitura de Moreira Sales");
    expect(arg.meta?.documentTitle).toContain("Estudo Técnico Preliminar");
    expect(procDb.recordProcessEvent).toHaveBeenCalledTimes(1); // auditoria
  });

  it("documento inexistente ou vazio → NOT_FOUND, sem chamar o núcleo", async () => {
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(null as never);
    const caller = procurementProcessRouter.createCaller(makeContext(mockUser));
    await expect(caller.exportDocument({ processId: PID, kind: "tr", format: "docx" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(exportCore).not.toHaveBeenCalled();
  });

  it("cross-tenant / processo inexistente → NOT_FOUND, sem exportar", async () => {
    vi.mocked(procDb.getProcess).mockResolvedValue(null as never);
    const caller = procurementProcessRouter.createCaller(makeContext(mockUser));
    await expect(caller.exportDocument({ processId: "outro", kind: "etp", format: "pdf" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(exportCore).not.toHaveBeenCalled();
  });

  describe("M8 P2.2 — TR emitido não sai com rótulo de rascunho", () => {
    const TR = "# Termo de Referência — Aquisição\n\n## Definição do objeto\nTexto.";
    const promotion = (contentHash: string) => ({ officialDocumentId: "odoc_tr_2", lineageId: "odln_tr", version: 2, contentHash, actorUserId: 2, createdAt: "2026-10-28 10:00:00" });
    beforeEach(() => {
      vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue({ id: "d-tr", kind: "tr", title: "TR — X", content: TR, status: "rascunho", updatedAt: "2026-10-28T00:00:00.000Z" } as never);
    });

    it("rascunho IDÊNTICO à versão emitida ⇒ exporta a versão oficial (adaptador oficial: EMITIDO), nunca 'RASCUNHO'", async () => {
      vi.mocked(getLatestOfficialPromotion).mockResolvedValue(promotion(draftContentHash(TR)));
      const r = await procurementProcessRouter.createCaller(makeContext(mockUser)).exportDocument({ processId: PID, kind: "tr", format: "pdf" });
      expect(r).toEqual({ url: "https://s3/official", format: "pdf", fileName: "TR_100-2026_emitido_v2.pdf" });
      expect(getLatestOfficialPromotion).toHaveBeenCalledWith(1, PID, "tr");                 // tenant-scoped
      expect(vi.mocked(exportOfficialDocument).mock.calls[0][0]).toMatchObject({ organizationId: 1, userId: mockUser.id, documentId: "odoc_tr_2", format: "pdf" });
      expect(exportCore).not.toHaveBeenCalled();                                              // sem cabeçalho de rascunho
      expect(vi.mocked(procDb.recordProcessEvent).mock.calls[0][0]).toMatchObject({ refId: "odoc_tr_2" });
    });

    it("rascunho ALTERADO depois da emissão ⇒ continua exportado como RASCUNHO (não finge ser a versão oficial)", async () => {
      vi.mocked(getLatestOfficialPromotion).mockResolvedValue(promotion(draftContentHash(`${TR}\nalteração`)));
      await procurementProcessRouter.createCaller(makeContext(mockUser)).exportDocument({ processId: PID, kind: "tr", format: "docx" });
      expect(exportOfficialDocument).not.toHaveBeenCalled();
      expect(vi.mocked(exportCore).mock.calls[0][0].meta).toMatchObject({ statusLabel: "RASCUNHO", isDraft: true });
    });

    it("sem emissão ⇒ rascunho; DFD (não promovível) nem consulta o ledger", async () => {
      vi.mocked(getLatestOfficialPromotion).mockResolvedValue(null);
      await procurementProcessRouter.createCaller(makeContext(mockUser)).exportDocument({ processId: PID, kind: "tr", format: "pdf" });
      expect(vi.mocked(exportCore).mock.calls[0][0].meta?.isDraft).toBe(true);
      vi.mocked(getLatestOfficialPromotion).mockClear();
      await procurementProcessRouter.createCaller(makeContext(mockUser)).exportDocument({ processId: PID, kind: "dfd", format: "pdf" });
      expect(getLatestOfficialPromotion).not.toHaveBeenCalled();
    });
  });

  describe("LICIGOV-FAST PR-1 — Visualizar/Imprimir na etapa (disposition inline)", () => {
    it("inline só muda o Content-Disposition: mesmo conteúdo salvo, mesma marcação de rascunho, mesmo evento", async () => {
      const caller = procurementProcessRouter.createCaller(makeContext(mockUser));
      await caller.exportDocument({ processId: PID, kind: "etp", format: "pdf", disposition: "inline" });
      const arg = vi.mocked(exportCore).mock.calls[0][0];
      expect(arg.disposition).toBe("inline");
      expect(arg.content).toBe("# ETP\nconteúdo");                       // conteúdo persistido — nada é gerado/regenerado
      expect(arg.meta).toMatchObject({ statusLabel: "RASCUNHO", isDraft: true });
      expect(procDb.recordProcessEvent).toHaveBeenCalledTimes(1);          // auditoria inalterada
    });

    it("sem disposition ⇒ comportamento anterior (o núcleo aplica attachment)", async () => {
      await procurementProcessRouter.createCaller(makeContext(mockUser)).exportDocument({ processId: PID, kind: "dfd", format: "docx" });
      expect(vi.mocked(exportCore).mock.calls[0][0].disposition).toBeUndefined();
    });

    it("versão emitida idêntica ⇒ o inline segue pelo adaptador oficial", async () => {
      vi.mocked(getLatestOfficialPromotion).mockResolvedValueOnce({ officialDocumentId: "odoc_etp", lineageId: "l", version: 2, contentHash: draftContentHash("# ETP\nconteúdo"), actorUserId: 2, createdAt: "2026-10-28 10:00:00" } as never);
      await procurementProcessRouter.createCaller(makeContext(mockUser)).exportDocument({ processId: PID, kind: "etp", format: "pdf", disposition: "inline" });
      expect(vi.mocked(exportOfficialDocument).mock.calls[0][0]).toMatchObject({ documentId: "odoc_etp", disposition: "inline" });
      expect(exportCore).not.toHaveBeenCalled();
    });

    it("disposition inválida é recusada pelo contrato; sem membership continua negado (nada exportado)", async () => {
      const caller = procurementProcessRouter.createCaller(makeContext(mockUser));
      await expect(caller.exportDocument({ processId: PID, kind: "etp", format: "pdf", disposition: "download" as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const { resolveTenantForUser } = await import("../../services/tenantService");
      vi.mocked(resolveTenantForUser).mockRejectedValueOnce(new Error("NO_ORGANIZATION_MEMBERSHIP"));
      await expect(caller.exportDocument({ processId: PID, kind: "etp", format: "pdf", disposition: "inline" })).rejects.toBeTruthy();
      expect(exportCore).not.toHaveBeenCalled();
      expect(exportOfficialDocument).not.toHaveBeenCalled();
    });
  });

  it("exige autenticação (UNAUTHORIZED)", async () => {
    await expect(
      procurementProcessRouter.createCaller(makeContext(null)).exportDocument({ processId: PID, kind: "etp", format: "pdf" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
