/**
 * Testes de Integração — Documentos (router legado `documents.*`)
 *
 * R2 / LEG-009 (decisão humana de 27/09/2026 = DISABLE): as procedures de leitura/gravação/geração/upload/
 * download/versionamento do router legado foram DESLIGADAS de forma governada. Este arquivo cobria o
 * comportamento antigo (versionamento, upload S3, URL presignada, assertProcessAccess/Owner) e foi REESCRITO
 * para o contrato governado, preservando a intenção de cada bloco:
 *  - autenticação continua exigida (UNAUTHORIZED antes do handler);
 *  - o schema de input continua validando (BAD_REQUEST, sem efeito colateral);
 *  - dono, membro, sem vínculo, processo/documento inexistente ⇒ MESMO FORBIDDEN + LEGACY_ENDPOINT_DISABLED
 *    (a recusa não depende do recurso — nenhuma enumeração de existência);
 *  - ZERO chamadas a banco (db.*), S3 (storagePut/storageGet), IA (gemini) e conversão (DOCX/PDF).
 * A cobertura exaustiva das 13 procedures está em `r2-leg009-legacy-documents-disabled.test.ts` (mockado) e
 * `r2-leg009-legacy-documents-disabled-mysql-smoke.test.ts` (MySQL real).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("../../db");

vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn().mockResolvedValue({
    organizationId: 1,
    membership: { id: 1, organizationId: 1, userId: 1, role: "owner", invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  }),
  getMembership: vi.fn().mockResolvedValue({ id: 1, organizationId: 1, userId: 1, role: "owner", invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() }),
  NO_ORGANIZATION_MEMBERSHIP: "NO_ORGANIZATION_MEMBERSHIP",
}));

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock herdado do rate limiter (tipagem interna do tRPC)
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
import * as gemini from "../../services/gemini";
import * as converter from "../../services/documentConverter";
import { makeContext, mockUser, mockOtherUser, mockProcess, mockDocument, mockUploadedDocument } from "../helpers/fixtures";

/** Contrato governado LEG-009: FORBIDDEN + token estável (mensagem idêntica para qualquer chamador/recurso). */
const GOVERNED = { code: "FORBIDDEN", message: expect.stringContaining("LEGACY_ENDPOINT_DISABLED") };

/** Nenhuma função de banco, S3, IA ou conversão foi chamada. */
function expectNoSideEffects() {
  for (const [name, fn] of Object.entries(db)) {
    if (vi.isMockFunction(fn)) expect(fn, `db.${name} não deveria ser chamado`).not.toHaveBeenCalled();
  }
  expect(storageModule.storagePut).not.toHaveBeenCalled();
  expect(storageModule.storageGet).not.toHaveBeenCalled();
  for (const fn of Object.values(gemini)) expect(fn).not.toHaveBeenCalled();
  expect(converter.convertToPDF).not.toHaveBeenCalled();
  expect(converter.convertToDOCX).not.toHaveBeenCalled();
}

async function errorOf(p: Promise<unknown>): Promise<{ code?: string; message?: string }> {
  try {
    await p;
  } catch (e) {
    const x = e as { code?: string; message?: string };
    return { code: x.code, message: x.message };
  }
  return { code: "RESOLVED" };
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe("Documents Router — Integração (R2 / LEG-009: desligamento governado)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Cenário "feliz" do legado (processo do próprio usuário, documentos existentes): mesmo assim nada executa.
    vi.mocked(db.getProcessByIdForOrganization).mockResolvedValue(mockProcess as never);
    vi.mocked(db.getProcessMember).mockResolvedValue(null as never);
    vi.mocked(db.getDocumentsByProcessForOrganization).mockResolvedValue([mockDocument] as never);
    vi.mocked(db.getDocumentByProcessAndTypeForOrganization).mockResolvedValue(mockDocument as never);
    vi.mocked(db.getDocumentByIdForOrganization).mockResolvedValue(mockUploadedDocument as never);
    vi.mocked(db.getDocumentVersionsForOrganization).mockResolvedValue([mockDocument] as never);
  });

  // ── documents.listByProcess ──────────────────────────────────────────────
  describe("listByProcess", () => {
    it("dono do processo recebe a recusa governada (não lista documentos) e nada é lido", async () => {
      const caller = documentsRouter.createCaller(makeContext(mockUser));
      await expect(caller.listByProcess({ processId: 10 })).rejects.toMatchObject(GOVERNED);
      expectNoSideEffects();
    });

    it("membro, usuário sem vínculo e processo inexistente recebem o MESMO erro do dono (sem enumeração)", async () => {
      const own = await errorOf(documentsRouter.createCaller(makeContext(mockUser)).listByProcess({ processId: 10 }));
      vi.mocked(db.getProcessByIdForOrganization).mockResolvedValue({ ...mockProcess, ownerId: 999 } as never);
      vi.mocked(db.getProcessMember).mockResolvedValue({ id: 1, processId: 10, userId: mockOtherUser.id } as never);
      const member = await errorOf(documentsRouter.createCaller(makeContext(mockOtherUser)).listByProcess({ processId: 10 }));
      vi.mocked(db.getProcessMember).mockResolvedValue(null as never);
      const stranger = await errorOf(documentsRouter.createCaller(makeContext(mockUser)).listByProcess({ processId: 10 }));
      vi.mocked(db.getProcessByIdForOrganization).mockResolvedValue(null as never);
      const missing = await errorOf(documentsRouter.createCaller(makeContext(mockUser)).listByProcess({ processId: 9999 }));

      expect(own.code).toBe("FORBIDDEN");
      expect(own.message).toMatch(/LEGACY_ENDPOINT_DISABLED/);
      expect(member).toEqual(own);
      expect(stranger).toEqual(own);
      expect(missing).toEqual(own);
      expectNoSideEffects();
    });

    it("rejeita acesso sem autenticação", async () => {
      await expect(
        documentsRouter.createCaller(makeContext(null)).listByProcess({ processId: 10 }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expectNoSideEffects();
    });
  });

  // ── documents.save ───────────────────────────────────────────────────────
  describe("save (criar/atualizar documento)", () => {
    it("não cria versão nem activity log (recusa governada)", async () => {
      await expect(
        documentsRouter.createCaller(makeContext(mockUser)).save({ processId: 10, type: "etp", content: "# ETP" }),
      ).rejects.toMatchObject(GOVERNED);
      expect(db.createDocument).not.toHaveBeenCalled();
      expect(db.createActivityLog).not.toHaveBeenCalled();
      expectNoSideEffects();
    });

    it("rejeita conteúdo acima de 500.000 chars com BAD_REQUEST (schema preservado)", async () => {
      const hugContent = "x".repeat(500001);
      await expect(
        documentsRouter.createCaller(makeContext(mockUser)).save({ processId: 10, type: "etp", content: hugContent }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expectNoSideEffects();
    });

    it("rejeita tipo de documento inválido com BAD_REQUEST (schema preservado)", async () => {
      await expect(
        documentsRouter.createCaller(makeContext(mockUser)).save({ processId: 10, type: "invalido" as never, content: "x" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expectNoSideEffects();
    });

    it("usuário sem permissão no processo recebe o mesmo erro governado do dono", async () => {
      const own = await errorOf(documentsRouter.createCaller(makeContext(mockUser)).save({ processId: 10, type: "tr", content: "# TR" }));
      vi.mocked(db.getProcessByIdForOrganization).mockResolvedValue({ ...mockProcess, ownerId: 999 } as never);
      const stranger = await errorOf(documentsRouter.createCaller(makeContext(mockUser)).save({ processId: 10, type: "tr", content: "# TR" }));
      expect(own.code).toBe("FORBIDDEN");
      expect(stranger).toEqual(own);
      expectNoSideEffects();
    });
  });

  // ── documents.getByType ──────────────────────────────────────────────────
  describe("getByType", () => {
    it("não devolve documento (recusa governada) para tipo existente nem inexistente", async () => {
      const caller = documentsRouter.createCaller(makeContext(mockUser));
      const existing = await errorOf(caller.getByType({ processId: 10, type: "dfd" }));
      vi.mocked(db.getDocumentByProcessAndTypeForOrganization).mockResolvedValue(null as never);
      const absent = await errorOf(caller.getByType({ processId: 10, type: "ata" }));
      expect(existing.code).toBe("FORBIDDEN");
      expect(existing.message).toMatch(/LEGACY_ENDPOINT_DISABLED/);
      expect(absent).toEqual(existing);
      expectNoSideEffects();
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

    it("NÃO faz upload para S3 nem persiste metadados (recusa governada)", async () => {
      await expect(
        documentsRouter.createCaller(makeContext(mockUser)).uploadDocument(validUpload),
      ).rejects.toMatchObject(GOVERNED);
      expect(storageModule.storagePut).not.toHaveBeenCalled();
      expect(db.createDocument).not.toHaveBeenCalled();
      expectNoSideEffects();
    });

    it("rejeita MIME type não permitido com BAD_REQUEST (schema preservado)", async () => {
      await expect(
        documentsRouter.createCaller(makeContext(mockUser)).uploadDocument({
          ...validUpload,
          mimeType: "image/png" as never,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expectNoSideEffects();
    });

    it("rejeita nome de arquivo com caracteres inválidos com BAD_REQUEST (schema preservado)", async () => {
      await expect(
        documentsRouter.createCaller(makeContext(mockUser)).uploadDocument({
          ...validUpload,
          fileName: "../../etc/passwd",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expectNoSideEffects();
    });

    it("não-dono do processo recebe o mesmo erro governado do dono", async () => {
      const own = await errorOf(documentsRouter.createCaller(makeContext(mockUser)).uploadDocument(validUpload));
      vi.mocked(db.getProcessByIdForOrganization).mockResolvedValue({ ...mockProcess, ownerId: 999 } as never);
      const stranger = await errorOf(documentsRouter.createCaller(makeContext(mockUser)).uploadDocument(validUpload));
      expect(own.code).toBe("FORBIDDEN");
      expect(stranger).toEqual(own);
      expectNoSideEffects();
    });
  });

  // ── documents.getDownloadUrl ─────────────────────────────────────────────
  describe("getDownloadUrl (presigned URL)", () => {
    it("NÃO emite URL presignada (recusa governada) nem consulta o S3", async () => {
      await expect(
        documentsRouter.createCaller(makeContext(mockUser)).getDownloadUrl({ documentId: 101 }),
      ).rejects.toMatchObject(GOVERNED);
      expect(storageModule.storageGet).not.toHaveBeenCalled();
      expectNoSideEffects();
    });

    it("documento inexistente, de outro dono ou sem s3Key recebem o MESMO erro (sem enumeração)", async () => {
      const caller = documentsRouter.createCaller(makeContext(mockUser));
      const own = await errorOf(caller.getDownloadUrl({ documentId: 101 }));
      vi.mocked(db.getDocumentByIdForOrganization).mockResolvedValue(null as never);
      const missing = await errorOf(caller.getDownloadUrl({ documentId: 9999 }));
      vi.mocked(db.getDocumentByIdForOrganization).mockResolvedValue(mockUploadedDocument as never);
      vi.mocked(db.getProcessByIdForOrganization).mockResolvedValue({ ...mockProcess, ownerId: 999 } as never);
      const foreign = await errorOf(caller.getDownloadUrl({ documentId: 101 }));
      vi.mocked(db.getDocumentByIdForOrganization).mockResolvedValue({ ...mockDocument, s3Key: null } as never);
      const textual = await errorOf(caller.getDownloadUrl({ documentId: 100 }));
      expect(own.code).toBe("FORBIDDEN");
      expect(own.message).toMatch(/LEGACY_ENDPOINT_DISABLED/);
      expect(missing).toEqual(own);
      expect(foreign).toEqual(own);
      expect(textual).toEqual(own);
      expectNoSideEffects();
    });
  });

  // ── documents.getVersionHistory ──────────────────────────────────────────
  describe("getVersionHistory", () => {
    it("NÃO devolve histórico (recusa governada); documento inexistente recebe o mesmo erro", async () => {
      const caller = documentsRouter.createCaller(makeContext(mockUser));
      const existing = await errorOf(caller.getVersionHistory({ documentId: 100 }));
      vi.mocked(db.getDocumentByIdForOrganization).mockResolvedValue(null as never);
      const missing = await errorOf(caller.getVersionHistory({ documentId: 9999 }));
      expect(existing.code).toBe("FORBIDDEN");
      expect(existing.message).toMatch(/LEGACY_ENDPOINT_DISABLED/);
      expect(missing).toEqual(existing);
      expectNoSideEffects();
    });
  });
});
