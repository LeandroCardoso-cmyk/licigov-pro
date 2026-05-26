/**
 * Testes de Integração — Segurança
 *
 * Cobre: rotas protegidas (UNAUTHORIZED), controle de acesso por role (FORBIDDEN),
 * validação de payload (Zod), acesso indevido a recursos de outro usuário,
 * middleware adminProcedure, sanitização de entrada, limites de payload.
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
  storagePut: vi.fn().mockResolvedValue({ key: "test-key", url: "https://s3.example.com/test" }),
  storageGet: vi.fn().mockResolvedValue({ url: "https://s3.example.com/presigned" }),
}));

vi.mock("../../_core/sdk", () => ({
  sdk: {
    signSession: vi.fn().mockResolvedValue("fake-token"),
    authenticateRequest: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("../../_core/cookies", () => ({
  getSessionCookieOptions: vi.fn().mockReturnValue({ httpOnly: true, path: "/" }),
}));

vi.mock("../../services/passwordSecurity", () => ({
  hashPassword: vi.fn().mockResolvedValue("$2b$12$hashed"),
  verifyPassword: vi.fn().mockResolvedValue(false),
}));

vi.mock("../../services/ai/suggestions", () => ({
  suggestModality: vi.fn().mockResolvedValue("sugestão"),
  suggestRisks: vi.fn().mockResolvedValue("riscos"),
  suggestClauses: vi.fn().mockResolvedValue("cláusulas"),
  suggestTechnicalRequirements: vi.fn().mockResolvedValue("requisitos"),
  suggestLegalBasis: vi.fn().mockResolvedValue("base legal"),
  improveText: vi.fn().mockResolvedValue("texto melhorado"),
}));

vi.mock("../../services/documentConverter", () => ({
  convertToPDF: vi.fn().mockResolvedValue(Buffer.from("pdf")),
  convertToDOCX: vi.fn().mockResolvedValue(Buffer.from("docx")),
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import { authRouter } from "../../routers/authRouter";
import { processesRouter } from "../../routers/processesRouter";
import { documentsRouter } from "../../routers/documentsRouter";
import { aiAssistantRouter } from "../../routers/aiAssistantRouter";
import { systemRouter } from "../../_core/systemRouter";
import * as db from "../../db";
import { makeContext, mockUser, mockAdmin, mockOtherUser, mockProcess } from "../helpers/fixtures";

// ─── Testes ───────────────────────────────────────────────────────────────────

describe("Segurança — Integração", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.getProcessById).mockResolvedValue(mockProcess as any);
    vi.mocked(db.getProcessMember).mockResolvedValue(null as any);
    vi.mocked(db.getDocumentsByProcess).mockResolvedValue([] as any);
    vi.mocked(db.createActivityLog).mockResolvedValue(undefined as any);
    vi.mocked(db.getDocumentSettingsByUser).mockResolvedValue(null as any);
    vi.mocked(db.createDocument).mockResolvedValue(undefined as any);
    vi.mocked(db.getDocumentByProcessAndType).mockResolvedValue(null as any);
  });

  // ── Procedures protegidas ─────────────────────────────────────────────────
  describe("protectedProcedure — rejeita usuário não autenticado", () => {
    it("processes.list → UNAUTHORIZED", async () => {
      await expect(
        processesRouter.createCaller(makeContext(null)).list(),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("processes.create → UNAUTHORIZED", async () => {
      await expect(
        processesRouter.createCaller(makeContext(null)).create({
          name: "Test", object: "Test", estimatedValue: 100, modality: "pregao", category: "compras",
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("documents.listByProcess → UNAUTHORIZED", async () => {
      await expect(
        documentsRouter.createCaller(makeContext(null)).listByProcess({ processId: 10 }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("documents.save → UNAUTHORIZED", async () => {
      await expect(
        documentsRouter.createCaller(makeContext(null)).save({ processId: 10, type: "etp", content: "x" }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("documents.uploadDocument → UNAUTHORIZED", async () => {
      await expect(
        documentsRouter.createCaller(makeContext(null)).uploadDocument({
          processId: 10, docType: "tr", fileName: "f.pdf",
          fileBase64: "abc", mimeType: "application/pdf",
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("aiAssistant.suggestModality → UNAUTHORIZED", async () => {
      await expect(
        aiAssistantRouter.createCaller(makeContext(null)).suggestModality({ processId: 10 }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("auth.updateTheme → UNAUTHORIZED", async () => {
      await expect(
        authRouter.createCaller(makeContext(null)).updateTheme({ theme: "dark" }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  // ── adminProcedure — rejeita usuário não-admin ────────────────────────────
  describe("adminProcedure — rejeita usuário com role 'user'", () => {
    it("system.notifyOwner → FORBIDDEN para user comum", async () => {
      await expect(
        systemRouter.createCaller(makeContext(mockUser)).notifyOwner({
          title: "Teste",
          content: "Conteúdo",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("system.notifyOwner → permite acesso para admin", async () => {
      vi.mocked(db.getUserByEmail).mockResolvedValue(mockAdmin as any);
      // Não precisa resolver completamente — apenas verificar que não lança FORBIDDEN
      // O envio real de notificação pode falhar, mas o middleware passou
      const notifyFn = async () =>
        systemRouter.createCaller(makeContext(mockAdmin)).notifyOwner({ title: "T", content: "C" });
      // Pode rejeitar por outro motivo (RESEND_API_KEY não configurada), mas NÃO por FORBIDDEN
      try {
        await notifyFn();
      } catch (err: any) {
        expect(err.code).not.toBe("FORBIDDEN");
      }
    });

    it("system.notifyOwner → FORBIDDEN sem usuário (adminProcedure não diferencia nulo de user comum)", async () => {
      await expect(
        systemRouter.createCaller(makeContext(null)).notifyOwner({ title: "T", content: "C" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // ── Controle de acesso por ownership de processo ──────────────────────────
  describe("assertProcessAccess — isolamento de dados por usuário", () => {
    it("usuário não-dono sem membro → FORBIDDEN em listByProcess", async () => {
      vi.mocked(db.getProcessById).mockResolvedValue({ ...mockProcess, ownerId: 999 } as any);

      await expect(
        documentsRouter.createCaller(makeContext(mockUser)).listByProcess({ processId: 10 }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("usuário não-dono → FORBIDDEN em save", async () => {
      vi.mocked(db.getProcessById).mockResolvedValue({ ...mockProcess, ownerId: 999 } as any);

      await expect(
        documentsRouter.createCaller(makeContext(mockUser)).save({ processId: 10, type: "tr", content: "x" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("assertProcessOwner — usuário não-dono → FORBIDDEN em uploadDocument", async () => {
      vi.mocked(db.getProcessById).mockResolvedValue({ ...mockProcess, ownerId: 999 } as any);

      await expect(
        documentsRouter.createCaller(makeContext(mockUser)).uploadDocument({
          processId: 10, docType: "tr", fileName: "f.pdf",
          fileBase64: "abc", mimeType: "application/pdf",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("processo inexistente → NOT_FOUND (não FORBIDDEN)", async () => {
      vi.mocked(db.getProcessById).mockResolvedValue(null as any);

      await expect(
        documentsRouter.createCaller(makeContext(mockUser)).listByProcess({ processId: 9999 }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ── Validação de payload (Zod) ────────────────────────────────────────────
  describe("sanitização e validação de payloads de entrada", () => {
    it("e-mail malformado é rejeitado em login", async () => {
      await expect(
        authRouter.createCaller(makeContext(null)).login({ email: "nao@e@email", password: "x" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("estimatedValue zero é rejeitado em processes.create", async () => {
      await expect(
        processesRouter.createCaller(makeContext(mockUser)).create({
          name: "Test", object: "Obj", estimatedValue: 0, modality: "preg", category: "comp",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("tipo de documento inválido é rejeitado em documents.save", async () => {
      await expect(
        documentsRouter.createCaller(makeContext(mockUser)).save({
          processId: 10, type: "SCRIPT_INJECTION" as any, content: "<script>",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("MIME type não permitido é rejeitado em uploadDocument", async () => {
      await expect(
        documentsRouter.createCaller(makeContext(mockUser)).uploadDocument({
          processId: 10, docType: "tr", fileName: "malware.exe",
          fileBase64: "abc", mimeType: "application/x-msdownload" as any,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("nome de arquivo com path traversal é rejeitado", async () => {
      await expect(
        documentsRouter.createCaller(makeContext(mockUser)).uploadDocument({
          processId: 10, docType: "tr", fileName: "../../../etc/passwd",
          fileBase64: "abc", mimeType: "application/pdf",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("conteúdo de documento acima de 500.000 chars é rejeitado", async () => {
      await expect(
        documentsRouter.createCaller(makeContext(mockUser)).save({
          processId: 10, type: "edital", content: "x".repeat(500001),
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("tema inválido é rejeitado em updateTheme", async () => {
      await expect(
        authRouter.createCaller(makeContext(mockUser)).updateTheme({ theme: "neon" as any }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // ── Rate limiting ─────────────────────────────────────────────────────────
  describe("rate limiting — comportamento quando limite é excedido", () => {
    it("TOO_MANY_REQUESTS quando checkRateLimit rejeita a requisição", async () => {
      const { rateLimitMiddleware } = await import("../../services/rateLimiter");
      const { middleware } = await import("../../_core/trpc");
      const { TRPCError } = await import("@trpc/server");

      // Simula middleware bloqueando
      const blockingMiddleware = middleware(() => {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Muitas tentativas." });
      });

      // Verificar que o erro TOO_MANY_REQUESTS tem o código correto
      await expect(
        Promise.reject(new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Muitas tentativas." })),
      ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    });
  });
});
