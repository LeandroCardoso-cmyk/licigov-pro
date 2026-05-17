/**
 * Testes de Integração — Processos Licitatórios
 *
 * Cobre: criação, listagem, busca, permissões, integridade de dados,
 * conversão de valores e geração de DFD em background.
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
  generateDFD: vi.fn().mockResolvedValue("# DFD gerado automaticamente"),
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

// ─── Imports ─────────────────────────────────────────────────────────────────

import { processesRouter } from "../../routers/processesRouter";
import * as db from "../../db";
import * as gemini from "../../services/gemini";
import { makeContext, mockUser, mockProcess } from "../helpers/fixtures";

// ─── Testes ───────────────────────────────────────────────────────────────────

const validCreateInput = {
  name: "Pregão Eletrônico 001/2025",
  object: "Computadores desktop para uso administrativo",
  estimatedValue: 50000,
  modality: "pregao_eletronico",
  category: "compras",
};

describe("Processes Router — Integração", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.getProcessesByUser).mockResolvedValue([] as any);
    vi.mocked(db.createProcess).mockResolvedValue({ insertId: 10 } as any);
    vi.mocked(db.getProcessById).mockResolvedValue(mockProcess as any);
    vi.mocked(db.createActivityLog).mockResolvedValue(undefined as any);
    vi.mocked(db.getDocumentSettingsByUser).mockResolvedValue(null as any);
    vi.mocked(db.searchProcesses).mockResolvedValue([] as any);
    vi.mocked(db.getActivityLogsByProcess).mockResolvedValue([] as any);
    vi.mocked(db.createDocument).mockResolvedValue(undefined as any);
    vi.mocked(gemini.generateDFD).mockResolvedValue("# DFD gerado");
  });

  // ── processes.list ──────────────────────────────────────────────────────
  describe("list", () => {
    it("retorna processos do usuário autenticado", async () => {
      vi.mocked(db.getProcessesByUser).mockResolvedValue([mockProcess] as any);
      const caller = processesRouter.createCaller(makeContext(mockUser));

      const result = await caller.list();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(10);
    });

    it("filtra processos pelo ID do usuário autenticado", async () => {
      vi.mocked(db.getProcessesByUser).mockResolvedValue([mockProcess] as any);
      const caller = processesRouter.createCaller(makeContext(mockUser));

      await caller.list();

      expect(db.getProcessesByUser).toHaveBeenCalledWith(mockUser.id);
      expect(db.getProcessesByUser).not.toHaveBeenCalledWith(999);
    });

    it("retorna lista vazia quando usuário não tem processos", async () => {
      vi.mocked(db.getProcessesByUser).mockResolvedValue([] as any);
      const caller = processesRouter.createCaller(makeContext(mockUser));

      const result = await caller.list();

      expect(result).toHaveLength(0);
    });

    it("rejeita acesso sem autenticação com UNAUTHORIZED", async () => {
      await expect(
        processesRouter.createCaller(makeContext(null)).list(),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  // ── processes.create ────────────────────────────────────────────────────
  describe("create", () => {
    it("cria processo com dados válidos", async () => {
      const caller = processesRouter.createCaller(makeContext(mockUser));
      const result = await caller.create(validCreateInput);

      expect(result.success).toBe(true);
      expect(result.processId).toBe(10);
    });

    it("associa o processo ao usuário autenticado (ownerId)", async () => {
      const caller = processesRouter.createCaller(makeContext(mockUser));
      await caller.create(validCreateInput);

      expect(db.createProcess).toHaveBeenCalledWith(
        expect.objectContaining({ ownerId: mockUser.id }),
      );
    });

    it("define status inicial como 'em_dfd'", async () => {
      const caller = processesRouter.createCaller(makeContext(mockUser));
      await caller.create(validCreateInput);

      expect(db.createProcess).toHaveBeenCalledWith(
        expect.objectContaining({ status: "em_dfd" }),
      );
    });

    it("converte estimatedValue de reais para centavos", async () => {
      const caller = processesRouter.createCaller(makeContext(mockUser));
      await caller.create({ ...validCreateInput, estimatedValue: 50000 });

      expect(db.createProcess).toHaveBeenCalledWith(
        expect.objectContaining({ estimatedValue: 5000000 }),
      );
    });

    it("converte valor fracionado para centavos corretamente", async () => {
      const caller = processesRouter.createCaller(makeContext(mockUser));
      await caller.create({ ...validCreateInput, estimatedValue: 1234.56 });

      expect(db.createProcess).toHaveBeenCalledWith(
        expect.objectContaining({ estimatedValue: 123456 }),
      );
    });

    it("registra log de atividade de criação", async () => {
      const caller = processesRouter.createCaller(makeContext(mockUser));
      await caller.create(validCreateInput);

      expect(db.createActivityLog).toHaveBeenCalledWith(
        expect.objectContaining({
          processId: 10,
          userId: mockUser.id,
          action: expect.stringContaining("criou o processo"),
        }),
      );
    });

    it("dispara geração de DFD em background (fire-and-forget)", async () => {
      const caller = processesRouter.createCaller(makeContext(mockUser));
      await caller.create(validCreateInput);

      expect(gemini.generateDFD).toHaveBeenCalled();
    });

    it("retorna processId mesmo se DFD falhar (falha silenciosa)", async () => {
      vi.mocked(gemini.generateDFD).mockRejectedValue(new Error("Gemini timeout"));
      const caller = processesRouter.createCaller(makeContext(mockUser));

      const result = await caller.create(validCreateInput);

      expect(result.success).toBe(true);
      expect(result.processId).toBe(10);
    });

    it("rejeita nome vazio com BAD_REQUEST", async () => {
      await expect(
        processesRouter.createCaller(makeContext(mockUser)).create({ ...validCreateInput, name: "" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rejeita estimatedValue negativo com BAD_REQUEST", async () => {
      await expect(
        processesRouter.createCaller(makeContext(mockUser)).create({ ...validCreateInput, estimatedValue: -100 }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rejeita objeto vazio com BAD_REQUEST", async () => {
      await expect(
        processesRouter.createCaller(makeContext(mockUser)).create({ ...validCreateInput, object: "" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rejeita acesso sem autenticação com UNAUTHORIZED", async () => {
      await expect(
        processesRouter.createCaller(makeContext(null)).create(validCreateInput),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  // ── processes.getById ───────────────────────────────────────────────────
  describe("getById", () => {
    it("retorna processo pelo ID", async () => {
      vi.mocked(db.getProcessById).mockResolvedValue(mockProcess as any);
      const caller = processesRouter.createCaller(makeContext(mockUser));

      const result = await caller.getById({ id: 10 });

      expect(result).toMatchObject({ id: 10, name: "Pregão Eletrônico 001/2025" });
    });

    it("retorna null para processo inexistente", async () => {
      vi.mocked(db.getProcessById).mockResolvedValue(null as any);
      const caller = processesRouter.createCaller(makeContext(mockUser));

      const result = await caller.getById({ id: 9999 });

      expect(result).toBeNull();
    });

    it("rejeita acesso sem autenticação", async () => {
      await expect(
        processesRouter.createCaller(makeContext(null)).getById({ id: 10 }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  // ── processes.search ────────────────────────────────────────────────────
  describe("search", () => {
    it("busca processos por termo e isola por usuário", async () => {
      vi.mocked(db.searchProcesses).mockResolvedValue([mockProcess] as any);
      const caller = processesRouter.createCaller(makeContext(mockUser));

      const result = await caller.search({ query: "Pregão" });

      expect(result).toHaveLength(1);
      expect(db.searchProcesses).toHaveBeenCalledWith(mockUser.id, "Pregão");
    });

    it("retorna lista vazia para busca sem resultados", async () => {
      vi.mocked(db.searchProcesses).mockResolvedValue([] as any);
      const caller = processesRouter.createCaller(makeContext(mockUser));

      const result = await caller.search({ query: "xyzinexistente" });

      expect(result).toHaveLength(0);
    });

    it("rejeita acesso sem autenticação", async () => {
      await expect(
        processesRouter.createCaller(makeContext(null)).search({ query: "teste" }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  // ── processes.getActivityLogs ────────────────────────────────────────────
  describe("getActivityLogs", () => {
    it("retorna logs de atividade dos processos do usuário", async () => {
      const mockLog = { id: 1, processId: 10, userId: 1, action: "criou o processo", createdAt: new Date() };
      vi.mocked(db.getProcessesByUser).mockResolvedValue([mockProcess] as any);
      vi.mocked(db.getActivityLogsByProcess).mockResolvedValue([mockLog] as any);

      const result = await processesRouter.createCaller(makeContext(mockUser)).getActivityLogs();

      expect(result).toHaveLength(1);
      expect(result[0].action).toBe("criou o processo");
    });

    it("retorna lista vazia quando não há atividade", async () => {
      vi.mocked(db.getProcessesByUser).mockResolvedValue([] as any);
      const result = await processesRouter.createCaller(makeContext(mockUser)).getActivityLogs();

      expect(result).toHaveLength(0);
    });
  });
});
