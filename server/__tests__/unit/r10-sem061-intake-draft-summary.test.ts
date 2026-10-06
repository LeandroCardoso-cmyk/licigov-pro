/**
 * SEM-061 — `getDocumentIntake.draft` descreve o rascunho VIGENTE (tamanho, data, origem, última edição, prévia) para que
 * "Substituir rascunho" mostre o que será substituído; leitura sempre escopada por (processo, órgão).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => null) }));
vi.mock("../../db/procurement");
import * as procDb from "../../db/procurement";
import { getDocumentIntake, DRAFT_PREVIEW_CHARS } from "../../services/documentIntakeService";
import { draftContentHash } from "../../domain/generatedDocument";

beforeEach(() => { vi.clearAllMocks(); });

describe("getDocumentIntake — resumo do rascunho vigente", () => {
  it("devolve hash, origem, tamanho, data, última edição e prévia truncada; consulta escopada", async () => {
    const content = "A".repeat(DRAFT_PREVIEW_CHARS + 50);
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue({ content, sources: ["edicao_manual"], title: "DFD — X", updatedAt: "2026-10-01T15:00:00.000Z" } as never);
    vi.mocked(procDb.getLatestDraftEdit).mockResolvedValue({ operation: "dfd_manual_edit", actorUserId: 3, newContentHash: "h", createdAt: "2026-10-01T15:00:00.000Z" });
    const v = await getDocumentIntake({ organizationId: 7, processId: "p1", kind: "dfd" });
    expect(v.draft).toMatchObject({
      exists: true, contentHash: draftContentHash(content), origin: "manual", contentLength: content.length,
      previewTruncated: true, updatedAt: "2026-10-01T15:00:00.000Z", lastEdit: { operation: "dfd_manual_edit", actorUserId: 3, at: "2026-10-01T15:00:00.000Z" },
    });
    expect(v.draft.preview).toHaveLength(DRAFT_PREVIEW_CHARS);
    expect(procDb.getGeneratedDocumentByKind).toHaveBeenCalledWith("p1", 7, "dfd");
    expect(procDb.getLatestDraftEdit).toHaveBeenCalledWith("p1", 7, "dfd");
  });

  it("sem rascunho (ou vazio): exists=false e nenhum conteúdo/ledger consultado", async () => {
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue({ content: "  ", sources: [], title: "t", updatedAt: "" } as never);
    const v = await getDocumentIntake({ organizationId: 7, processId: "p1", kind: "dfd" });
    expect(v.draft).toMatchObject({ exists: false, contentHash: null, preview: null, contentLength: null, lastEdit: null });
    expect(procDb.getLatestDraftEdit).not.toHaveBeenCalled();
  });
});
