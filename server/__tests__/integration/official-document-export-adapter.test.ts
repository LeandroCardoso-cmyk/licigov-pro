/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PR B.1 — Adapter compartilhado de exportação institucional de documentos oficiais.
 * Serve Contratos/Aditivos, Contratação Direta e Parecer (todos em official_documents).
 * Persistência/render/storage mockados.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../services/documentEngineService", () => ({
  getOfficialDocument: vi.fn(),
}));
vi.mock("../../services/documentExportService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/documentExportService")>();
  return {
    ...actual, // mantém formatBrazilianDateTime real
    exportDocument: vi.fn().mockResolvedValue({
      key: "exports/contratos/1/1_contrato.pdf", url: "https://s3/signed",
      format: "pdf", mimeType: "application/pdf", fileName: "CONTRATO_012-2026_gerado_v3.pdf",
      artifactHash: "b".repeat(64), sizeBytes: 1234,
    }),
  };
});
vi.mock("../../db/organizations", () => ({
  getOrganizationById: vi.fn().mockResolvedValue({ id: 1, nome: "Prefeitura de Moreira Sales" }),
}));
vi.mock("../../services/officialDocumentLifecycleService", () => ({
  recordOfficialArtifact: vi.fn(),
}));
vi.mock("../../services/activityLogService", () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));

import { exportOfficialDocument } from "../../services/officialDocumentExportAdapter";
import { getOfficialDocument } from "../../services/documentEngineService";
import { exportDocument } from "../../services/documentExportService";
import { logActivity } from "../../services/activityLogService";
import { recordOfficialArtifact } from "../../services/officialDocumentLifecycleService";

function mkDoc(over: Record<string, unknown> = {}) {
  return {
    id: "doc1", tenantId: 1, businessDomain: "contratos", documentType: "contrato",
    origin: "ws-uuid-interno", title: "Contrato X", version: 3, status: "gerado",
    template: "t", content: "# Contrato\nCláusula primeira...", metadata: { contractNumber: "012/2026", object: "Aquisição" },
    author: "1", lineageId: "lin1", correlationId: "c", replayHash: "h", storageKey: "", mimeType: "", size: 0, hash: "",
    createdAt: "2026-07-26T00:00:00.000Z", updatedAt: "2026-07-26T00:00:00.000Z",
    ...over,
  };
}

describe("PR B.1 · exportOfficialDocument (adapter compartilhado)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOfficialDocument).mockResolvedValue(mkDoc() as any);
    vi.mocked(recordOfficialArtifact).mockResolvedValue({
      artifact: { id: "art-1", sourceContentHash: "c".repeat(64) } as any, created: true,
    });
  });

  it("exporta via o núcleo comum com meta institucional fiel + nome determinístico", async () => {
    const r = await exportOfficialDocument({ organizationId: 1, userId: 9, documentId: "doc1", format: "pdf" });

    expect(r.url).toBe("https://s3/signed");
    const arg = vi.mocked(exportDocument).mock.calls[0][0];
    expect(arg.content).toContain("Cláusula primeira"); // conteúdo persistido, fiel
    expect(arg.scope).toBe("contratos");
    expect(arg.disposition).toBe("attachment");
    // nome de download: número do contrato (metadados) + status + versão; SEM timestamp/UUID.
    expect(arg.downloadBaseName).toBe("CONTRATO_012-2026_gerado_v3");
    expect(arg.baseName).not.toContain("ws-uuid-interno"); // chave interna usa linhagem, não o origin
    expect(arg.meta?.organizationName).toBe("Prefeitura de Moreira Sales");
    expect(arg.meta?.documentTitle).toBe("Contrato");
    expect(arg.meta?.processNumber).toBe("012/2026");
    expect(arg.meta?.object).toBe("Aquisição");
    expect(arg.meta?.statusLabel).toBe("GERADO");
    expect(arg.meta?.isDraft).toBe(true); // "gerado" ainda não é finalizado
    expect(arg.meta?.draftNoticeLabel).toBe("GERADO");
    expect(arg.meta?.version).toBe(3);
    // auditoria sem conteúdo integral
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 1, entityType: "official_document",
      details: expect.objectContaining({ documentId: "doc1", format: "pdf", status: "gerado" }),
    }));
    expect(vi.mocked(logActivity).mock.calls[0][0].details).not.toHaveProperty("content");
  });

  it("status 'emitido' → NÃO é rascunho (isDraft false)", async () => {
    vi.mocked(getOfficialDocument).mockResolvedValue(mkDoc({ status: "emitido", documentType: "aditivo" }) as any);
    await exportOfficialDocument({ organizationId: 1, userId: 9, documentId: "doc1", format: "docx" });
    const arg = vi.mocked(exportDocument).mock.calls[0][0];
    expect(arg.meta?.statusLabel).toBe("EMITIDO");
    expect(arg.meta?.isDraft).toBe(false);
    expect(arg.meta?.documentTitle).toBe("Termo Aditivo");
  });

  it("impressão: disposition inline propagado ao núcleo", async () => {
    await exportOfficialDocument({ organizationId: 1, userId: 9, documentId: "doc1", format: "pdf", disposition: "inline" });
    expect(vi.mocked(exportDocument).mock.calls[0][0].disposition).toBe("inline");
  });

  it("sem número nos metadados → nome de download sem vazar origin/UUID", async () => {
    vi.mocked(getOfficialDocument).mockResolvedValue(mkDoc({ metadata: {} }) as any);
    await exportOfficialDocument({ organizationId: 1, userId: 9, documentId: "doc1", format: "pdf" });
    const arg = vi.mocked(exportDocument).mock.calls[0][0];
    expect(arg.downloadBaseName).toBe("CONTRATO_gerado_v3");
    expect(arg.meta?.processNumber).toBeUndefined();
  });

  it("documento inexistente ou vazio → NOT_FOUND, sem exportar", async () => {
    vi.mocked(getOfficialDocument).mockResolvedValue(null as any);
    await expect(exportOfficialDocument({ organizationId: 1, userId: 9, documentId: "x", format: "pdf" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    vi.mocked(getOfficialDocument).mockResolvedValue(mkDoc({ content: "   " }) as any);
    await expect(exportOfficialDocument({ organizationId: 1, userId: 9, documentId: "x", format: "pdf" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(exportDocument).not.toHaveBeenCalled();
  });

  it("é tenant-scoped: repassa a organização ao getOfficialDocument", async () => {
    await exportOfficialDocument({ organizationId: 42, userId: 9, documentId: "doc1", format: "pdf" });
    expect(getOfficialDocument).toHaveBeenCalledWith("doc1", 42);
  });

  // ─── SEM-043 — hash do artefato registrado no ledger, por formato ─────────────────────────────────────────
  it("SEM-043: registra o artefato (hash dos bytes + origem + ator humano) e o devolve no resultado e no log", async () => {
    const r = await exportOfficialDocument({ organizationId: 1, userId: 9, documentId: "doc1", format: "pdf", correlationId: "corr-x" });

    expect(recordOfficialArtifact).toHaveBeenCalledTimes(1);
    const rec = vi.mocked(recordOfficialArtifact).mock.calls[0][0];
    expect(rec).toMatchObject({
      format: "pdf", artifactHash: "b".repeat(64), sizeBytes: 1234, mimeType: "application/pdf",
      storageKey: "exports/contratos/1/1_contrato.pdf", actorUserId: 9, correlationId: "corr-x",
    });
    expect(rec.doc.id).toBe("doc1");
    expect(rec.identityFingerprint).toMatch(/^[0-9a-f]{64}$/);

    expect(r).toMatchObject({ url: "https://s3/signed", artifactHash: "b".repeat(64), artifactId: "art-1", artifactReused: false });
    const details = vi.mocked(logActivity).mock.calls[0][0].details as Record<string, unknown>;
    expect(details).toMatchObject({
      artifactHash: "b".repeat(64), artifactSizeBytes: 1234, artifactId: "art-1", artifactReused: false,
      sourceContentHash: "c".repeat(64), sourceReplayHash: "h",
    });
  });

  it("SEM-043: reexportar bytes idênticos → artifactReused true (no-op idempotente do ledger)", async () => {
    vi.mocked(recordOfficialArtifact).mockResolvedValue({ artifact: { id: "art-1", sourceContentHash: "c".repeat(64) } as any, created: false });
    const r = await exportOfficialDocument({ organizationId: 1, userId: 9, documentId: "doc1", format: "pdf" });
    expect(r.artifactReused).toBe(true);
    expect((vi.mocked(logActivity).mock.calls[0][0].details as Record<string, unknown>).artifactReused).toBe(true);
  });

  it("SEM-043: DOCX e PDF carregam hashes DISTINTOS ao ledger (nunca um único ponteiro por versão)", async () => {
    vi.mocked(exportDocument)
      .mockResolvedValueOnce({ key: "k-docx", url: "u1", format: "docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fileName: "a.docx", artifactHash: "d".repeat(64), sizeBytes: 5 })
      .mockResolvedValueOnce({ key: "k-pdf", url: "u2", format: "pdf", mimeType: "application/pdf", fileName: "a.pdf", artifactHash: "e".repeat(64), sizeBytes: 6 });
    await exportOfficialDocument({ organizationId: 1, userId: 9, documentId: "doc1", format: "docx" });
    await exportOfficialDocument({ organizationId: 1, userId: 9, documentId: "doc1", format: "pdf" });
    const [a, b] = vi.mocked(recordOfficialArtifact).mock.calls.map((c) => c[0]);
    expect([a.format, b.format]).toEqual(["docx", "pdf"]);
    expect(a.artifactHash).not.toBe(b.artifactHash);
    expect([a.storageKey, b.storageKey]).toEqual(["k-docx", "k-pdf"]);
  });

  it("SEM-043: falha ao registrar no ledger → export FALHA (sem URL) e sem log de sucesso", async () => {
    vi.mocked(recordOfficialArtifact).mockRejectedValue(new Error("ledger indisponível"));
    await expect(exportOfficialDocument({ organizationId: 1, userId: 9, documentId: "doc1", format: "pdf" })).rejects.toThrow("ledger indisponível");
    expect(logActivity).not.toHaveBeenCalled();
  });
});
