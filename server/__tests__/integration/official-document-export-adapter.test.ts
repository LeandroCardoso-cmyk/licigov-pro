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
vi.mock("../../services/activityLogService", () => ({ logActivity: vi.fn().mockResolvedValue(undefined), PLATFORM_ADMIN_ACTOR_ROLE: "platform_admin" }));
vi.mock("../../db/officialDocuments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../db/officialDocuments")>()),
  listVersions: vi.fn().mockResolvedValue([]),
}));

import { exportOfficialDocument } from "../../services/officialDocumentExportAdapter";
import { getOfficialDocument } from "../../services/documentEngineService";
import { exportDocument } from "../../services/documentExportService";
import { logActivity } from "../../services/activityLogService";
import { recordOfficialArtifact } from "../../services/officialDocumentLifecycleService";
import { listVersions } from "../../db/officialDocuments";

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
  it("Frente C — acesso técnico da plataforma: ledger recebe a marca e o log de atividade usa o papel técnico (não do órgão)", async () => {
    await exportOfficialDocument({ organizationId: 1, userId: 9, documentId: "doc1", format: "pdf", correlationId: "corr-c", platformTechnicalAccess: true });
    expect(vi.mocked(recordOfficialArtifact).mock.calls[0][0]).toMatchObject({ actorUserId: 9, correlationId: "corr-c", platformTechnicalAccess: true });
    expect(vi.mocked(logActivity).mock.calls[0][0]).toMatchObject({ userId: 9, actorRole: "platform_admin", correlationId: "corr-c" });
    vi.mocked(logActivity).mockClear();
    await exportOfficialDocument({ organizationId: 1, userId: 9, documentId: "doc1", format: "pdf" });
    expect(vi.mocked(logActivity).mock.calls[0][0]).not.toHaveProperty("actorRole");
  });

  it("Revisão #336 — acesso técnico sobre artefato JÁ existente: segue auditável no activity log (papel técnico, reuso, hash, correlationId) sem novo evento", async () => {
    vi.mocked(recordOfficialArtifact).mockResolvedValueOnce({ artifact: { id: "art-1", sourceContentHash: "c".repeat(64) } as any, created: false });
    const r = await exportOfficialDocument({ organizationId: 1, userId: 9, documentId: "doc1", format: "pdf", correlationId: "corr-reuso", platformTechnicalAccess: true });
    expect(r).toMatchObject({ artifactId: "art-1", artifactReused: true });
    const log = vi.mocked(logActivity).mock.calls[0][0];
    expect(log).toMatchObject({ userId: 9, actorRole: "platform_admin", correlationId: "corr-reuso", action: "exportou documento oficial" });
    expect(log.details).toMatchObject({ artifactId: "art-1", artifactReused: true, artifactHash: "b".repeat(64) });
  });

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

describe("M8 P3.3 — cabeçalho da versão EMITIDA do processo licitatório: ordinal da emissão + revisão técnica", () => {
  const lineage = [
    { id: "g1", version: 1, status: "gerado", replayHash: "r1", createdAt: "x" },
    { id: "e2", version: 2, status: "emitido", replayHash: "r2", createdAt: "x" },
    { id: "g3", version: 3, status: "gerado", replayHash: "r3", createdAt: "x" },
    { id: "e4", version: 4, status: "emitido", replayHash: "r4", createdAt: "x" },
  ];
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listVersions).mockResolvedValue(lineage);
    vi.mocked(recordOfficialArtifact).mockResolvedValue({ artifact: { id: "art-1", sourceContentHash: "c".repeat(64) } as any, created: true });
  });
  const meta = () => vi.mocked(exportDocument).mock.calls[0][0].meta!;

  it("TR emitido v2 = 1ª emissão; v4 = 2ª emissão (contagem na linhagem do tenant; nada renumerado)", async () => {
    vi.mocked(getOfficialDocument).mockResolvedValue(mkDoc({ businessDomain: "processo_licitatorio", documentType: "tr", status: "emitido", version: 2 }) as any);
    await exportOfficialDocument({ organizationId: 1, userId: 9, documentId: "e2", format: "pdf" });
    expect(meta()).toMatchObject({ version: 2, emissionNumber: 1, statusLabel: "EMITIDO", isDraft: false });
    expect(listVersions).toHaveBeenCalledWith("lin1", 1);
    vi.mocked(exportDocument).mockClear();
    vi.mocked(getOfficialDocument).mockResolvedValue(mkDoc({ businessDomain: "processo_licitatorio", documentType: "tr", status: "emitido", version: 4 }) as any);
    await exportOfficialDocument({ organizationId: 1, userId: 9, documentId: "e4", format: "docx" });
    expect(meta()).toMatchObject({ version: 4, emissionNumber: 2 });
  });

  it("parecer (NEW-007), contratos e documentos não emitidos mantêm o cabeçalho anterior (sem ordinal)", async () => {
    for (const over of [
      { businessDomain: "parecer_juridico", documentType: "parecer", status: "emitido" },
      { businessDomain: "contratos", documentType: "contrato", status: "emitido" },
    ]) {
      vi.mocked(exportDocument).mockClear();
      vi.mocked(getOfficialDocument).mockResolvedValue(mkDoc(over) as any);
      await exportOfficialDocument({ organizationId: 1, userId: 9, documentId: "d", format: "pdf" });
      expect(meta()).not.toHaveProperty("emissionNumber");
      expect(meta().version).toBe(3);
    }
    expect(listVersions).not.toHaveBeenCalled();
    // snapshot técnico do processo licitatório continua NÃO exportável como oficial (gate inalterado)
    vi.mocked(getOfficialDocument).mockResolvedValue(mkDoc({ businessDomain: "processo_licitatorio", documentType: "tr", status: "gerado" }) as any);
    await expect(exportOfficialDocument({ organizationId: 1, userId: 9, documentId: "d", format: "pdf" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
