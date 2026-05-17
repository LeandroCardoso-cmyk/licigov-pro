/**
 * Testes de Integração — Documentos
 *
 * Cobre: versionamento, controle de acesso, upload S3, download com URL
 * presignada, assertProcessAccess/Owner, persistência no banco.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("../../db");

vi.mock("../../services/rateLimiter", async () => {
  const trpc = await import("../../_core/trpc");
  return {
    RATE_LIMITS: {
      login: { windowMs: 900000, max: 5, message: "" },
      documentGeneration: { windowMs: 3600000, max: 50, message: "" },
      api: { windowMs: 60000, max: 100, message: "" },
      signature: { windowMs: 900000, max: 10, message: "" },
      export: { windowMs: 3600000, max: 30, message: "" },
    },
    checkRateLimit: vi.fn().mockReturnValue({ allowed: true, remaining: 99, resetAt: Date.now() + 900000 }),
    resetRateLimit: vi.fn(),
    cleanupExpiredEntries: vi.fn(),
    getRateLimitStats: vi.fn().mockReturnValue(null),
    rateLimitMiddleware: (_type: string) => trpc.middleware(({ next }: any) => next()),
  };
});

vi.mock("../../services/gemini", () => ({
  generateDFD: vi.fn().mockResolvedValue("# DFD"),
  generateETP: vi.fn().mockResolvedValue("# ETP"),
  generateTR: vi.fn().mockResolvedValue("# TR"),
  generateEdital: vi.fn().mockResolvedValue("# Edital"),
  generateContrato: vi.fn().mockResolvedValue("# Contrato"),
  generateAta: vi.fn().mockResolvedValue("# Ata"),
  generateParecer: vi.fn().mockResolvedValue("# Parecer"),
}));

vi.mock("../../storage", () => ({
  storagePut: vi.fn().mockResolvedValue({
    key: "processes/10/tr/1234567890_termo.pdf",
    url: "https://s3.example.com/processes/10/tr/1234567890_termo.pdf",
  }),
  storageGet: vi.fn().mockResolvedValue({ url: "https://s3.example.com/presigned-url?expires=3600" }),
}));

vi.mock("../../services/documentConverter", () => ({
  convertToPDF: vi.fn().mockResolvedValue(Buffer.from("fake-pdf-content")),
  convertToDOCX: vi.fn().mockResolvedValue(Buffer.from("fake-docx-content")),
}));

vi.mock("../../_core/sdk", () => ({
  sdk: {
    signSession: vi.fn().mockResolvedValue("fake-token"),
    authenticateRequest: vi.fn().mockResolvedValue(null),
  },
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import { documentsRouter } from "../../routers/documentsRouter";
import * as db from "../../db";
import * as storageModule from "../../storage";
import { makeContext, mockUser, mockOtherUser, mockProcess, mockDocument, mockUploadedDocument } from "../helpers/fixtures";

// ─── Testes ───────────────────────────────────────────────────────────────────

describe("Documents Router — Integração", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.getProcessById).mockResolvedValue(mockProcess as any);
    vi.mocked(db.getProcessMember).mockResolvedValue(null as any);
    vi.mocked(db.getDocumentsByProcess).mockResolvedValue([mockDocument] as any);
    vi.mocked(db.getDocumentByProcessAndType).mockResolvedValue(null as any);
    vi.mocked(db.createDocument).mockResolvedValue(undefined as any);
    vi.mocked(db.createActivityLog).mockResolvedValue(undefined as any);
    vi.mocked(db.getDocumentById).mockResolvedValue(null as any);
    vi.mocked(db.getDocumentVersions).mockResolvedValue([] as any);
  });

  // ── documents.listByProcess ──────────────────────────────────────────────
  describe("listByProcess", () => {
    it("retorna documentos para o dono do processo", async () => {
      vi.mocked(db.getDocumentsByProcess).mockResolvedValue([mockDocument] as any);
      const caller = documentsRouter.createCaller(makeContext(mockUser));

      const result = await caller.listByProcess({ processId: 10 });

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("dfd");
    });

    it("permite acesso a membro autorizado do processo", async () => {
      const memberUser = { ...mockOtherUser };
      vi.mocked(db.getProcessById).mockResolvedValue({ ...mockProcess, ownerId: 999 } as any);
      vi.mocked(db.getProcessMember).mockResolvedValue({ id: 1, processId: 10, userId: memberUser.id } as any);

      const result = await documentsRouter.createCaller(makeContext(memberUser)).listByProcess({ processId: 10 });

      expect(result).toBeDefined();
    });

    it("bloqueia usuário sem vínculo com o processo com FORBIDDEN", async () => {
      vi.mocked(db.getProcessById).mockResolvedValue({ ...mockProcess, ownerId: 999 } as any);
      vi.mocked(db.getProcessMember).mockResolvedValue(null as any);

      await expect(
        documentsRouter.createCaller(makeContext(mockUser)).listByProcess({ processId: 10 }),
      ).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("permissão") });
    });

    it("retorna NOT_FOUND para processo inexistente", async () => {
      vi.mocked(db.getProcessById).mockResolvedValue(null as any);

      await expect(
        documentsRouter.createCaller(makeContext(mockUser)).listByProcess({ processId: 9999 }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("rejeita acesso sem autenticação", async () => {
      await expect(
        documentsRouter.createCaller(makeContext(null)).listByProcess({ processId: 10 }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  // ── documents.save ───────────────────────────────────────────────────────
  describe("save (criar/atualizar documento)", () => {
    it("cria documento com versão 1 quando não existe versão anterior", async () => {
      vi.mocked(db.getDocumentByProcessAndType).mockResolvedValue(null as any);
      const caller = documentsRouter.createCaller(makeContext(mockUser));

      const result = await caller.save({ processId: 10, type: "etp", content: "# ETP" });

      expect(result.success).toBe(true);
      expect(result.version).toBe(1);
      expect(db.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({ version: 1, type: "etp", createdBy: mockUser.id }),
      );
    });

    it("incrementa versão quando já existe documento do mesmo tipo", async () => {
      vi.mocked(db.getDocumentByProcessAndType).mockResolvedValue({ ...mockDocument, version: 2 } as any);
      const caller = documentsRouter.createCaller(makeContext(mockUser));

      const result = await caller.save({ processId: 10, type: "dfd", content: "# DFD v3" });

      expect(result.version).toBe(3);
      expect(db.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({ version: 3 }),
      );
    });

    it("persiste o userId como createdBy", async () => {
      const caller = documentsRouter.createCaller(makeContext(mockUser));
      await caller.save({ processId: 10, type: "tr", content: "# TR" });

      expect(db.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({ createdBy: mockUser.id }),
      );
    });

    it("registra log de atividade ao salvar", async () => {
      const caller = documentsRouter.createCaller(makeContext(mockUser));
      await caller.save({ processId: 10, type: "etp", content: "# ETP" });

      expect(db.createActivityLog).toHaveBeenCalledWith(
        expect.objectContaining({ processId: 10, userId: mockUser.id }),
      );
    });

    it("rejeita conteúdo acima de 500.000 chars com BAD_REQUEST", async () => {
      const hugContent = "x".repeat(500001);
      await expect(
        documentsRouter.createCaller(makeContext(mockUser)).save({ processId: 10, type: "etp", content: hugContent }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rejeita tipo de documento inválido com BAD_REQUEST", async () => {
      await expect(
        documentsRouter.createCaller(makeContext(mockUser)).save({ processId: 10, type: "invalido" as any, content: "x" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("bloqueia usuário sem permissão no processo", async () => {
      vi.mocked(db.getProcessById).mockResolvedValue({ ...mockProcess, ownerId: 999 } as any);

      await expect(
        documentsRouter.createCaller(makeContext(mockUser)).save({ processId: 10, type: "tr", content: "# TR" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // ── documents.getByType ──────────────────────────────────────────────────
  describe("getByType", () => {
    it("retorna documento pelo tipo", async () => {
      vi.mocked(db.getDocumentByProcessAndType).mockResolvedValue(mockDocument as any);
      const caller = documentsRouter.createCaller(makeContext(mockUser));

      const result = await caller.getByType({ processId: 10, type: "dfd" });

      expect(result).toMatchObject({ type: "dfd", processId: 10 });
    });

    it("retorna null para tipo inexistente", async () => {
      vi.mocked(db.getDocumentByProcessAndType).mockResolvedValue(null as any);
      const caller = documentsRouter.createCaller(makeContext(mockUser));

      const result = await caller.getByType({ processId: 10, type: "ata" });

      expect(result).toBeNull();
    });
  });

  // ── documents.uploadDocument ─────────────────────────────────────────────
  describe("uploadDocument (S3)", () => {
    const validUpload = {
      processId: 10,
      docType: "tr" as const,
      fileName: "termo_referencia.pdf",
      fileBase64: Buffer.from("fake-pdf-content").toString("base64"),
      mimeType: "application/pdf" as const,
    };

    it("faz upload para S3 e persiste metadados no banco", async () => {
      vi.mocked(storageModule.storagePut).mockResolvedValue({
        key: "processes/10/tr/1234_termo.pdf",
        url: "https://s3.example.com/processes/10/tr/1234_termo.pdf",
      } as any);
      vi.mocked(db.getDocumentsByProcess).mockResolvedValue([] as any);
      const caller = documentsRouter.createCaller(makeContext(mockUser));

      const result = await caller.uploadDocument(validUpload);

      expect(result.success).toBe(true);
      expect(storageModule.storagePut).toHaveBeenCalled();
      expect(db.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceType: "upload",
          s3Key: expect.stringContaining("tr"),
        }),
      );
    });

    it("define versão 1 para primeiro upload do tipo", async () => {
      vi.mocked(db.getDocumentsByProcess).mockResolvedValue([] as any);
      const caller = documentsRouter.createCaller(makeContext(mockUser));

      const result = await caller.uploadDocument(validUpload);

      expect(result.version).toBe(1);
    });

    it("incrementa versão em uploads subsequentes do mesmo tipo", async () => {
      vi.mocked(db.getDocumentsByProcess).mockResolvedValue([{ ...mockUploadedDocument, type: "tr", version: 2 }] as any);
      const caller = documentsRouter.createCaller(makeContext(mockUser));

      const result = await caller.uploadDocument(validUpload);

      expect(result.version).toBe(3);
    });

    it("rejeita MIME type não permitido com BAD_REQUEST", async () => {
      await expect(
        documentsRouter.createCaller(makeContext(mockUser)).uploadDocument({
          ...validUpload,
          mimeType: "image/png" as any,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rejeita nome de arquivo com caracteres inválidos com BAD_REQUEST", async () => {
      await expect(
        documentsRouter.createCaller(makeContext(mockUser)).uploadDocument({
          ...validUpload,
          fileName: "../../etc/passwd",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("exige que o usuário seja dono do processo (assertProcessOwner)", async () => {
      vi.mocked(db.getProcessById).mockResolvedValue({ ...mockProcess, ownerId: 999 } as any);

      await expect(
        documentsRouter.createCaller(makeContext(mockUser)).uploadDocument(validUpload),
      ).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("responsável") });
    });
  });

  // ── documents.getDownloadUrl ─────────────────────────────────────────────
  describe("getDownloadUrl (presigned URL)", () => {
    it("retorna URL presignada para documento S3 válido", async () => {
      vi.mocked(db.getDocumentById).mockResolvedValue(mockUploadedDocument as any);
      vi.mocked(db.getProcessById).mockResolvedValue(mockProcess as any);
      vi.mocked(storageModule.storageGet).mockResolvedValue({ url: "https://s3.example.com/presigned" } as any);

      const result = await documentsRouter.createCaller(makeContext(mockUser)).getDownloadUrl({ documentId: 101 });

      expect(result.url).toContain("presigned");
      expect(result.expiresIn).toBe(3600);
    });

    it("retorna NOT_FOUND para documento inexistente", async () => {
      vi.mocked(db.getDocumentById).mockResolvedValue(null as any);

      await expect(
        documentsRouter.createCaller(makeContext(mockUser)).getDownloadUrl({ documentId: 9999 }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("retorna FORBIDDEN para usuário que não é dono do processo", async () => {
      vi.mocked(db.getDocumentById).mockResolvedValue(mockUploadedDocument as any);
      vi.mocked(db.getProcessById).mockResolvedValue({ ...mockProcess, ownerId: 999 } as any);

      await expect(
        documentsRouter.createCaller(makeContext(mockUser)).getDownloadUrl({ documentId: 101 }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("retorna BAD_REQUEST para documento sem s3Key (documento textual)", async () => {
      vi.mocked(db.getDocumentById).mockResolvedValue({ ...mockDocument, s3Key: null } as any);

      await expect(
        documentsRouter.createCaller(makeContext(mockUser)).getDownloadUrl({ documentId: 100 }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("S3") });
    });
  });

  // ── documents.getVersionHistory ──────────────────────────────────────────
  describe("getVersionHistory", () => {
    it("retorna histórico de versões do documento", async () => {
      const versions = [{ ...mockDocument, version: 1 }, { ...mockDocument, version: 2, id: 200 }];
      vi.mocked(db.getDocumentById).mockResolvedValue(mockDocument as any);
      vi.mocked(db.getDocumentVersions).mockResolvedValue(versions as any);

      const result = await documentsRouter.createCaller(makeContext(mockUser)).getVersionHistory({ documentId: 100 });

      expect(result).toHaveLength(2);
    });

    it("retorna NOT_FOUND para documento inexistente", async () => {
      vi.mocked(db.getDocumentById).mockResolvedValue(null as any);

      await expect(
        documentsRouter.createCaller(makeContext(mockUser)).getVersionHistory({ documentId: 9999 }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
