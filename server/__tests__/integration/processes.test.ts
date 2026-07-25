/**
 * Testes de Integração — Processos Licitatórios
 *
 * Cobre: criação, listagem, busca, permissões, integridade de dados,
 * conversão de valores e geração de DFD em background.
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
    vi.mocked(db.listProcessesForOrganization).mockResolvedValue([] as any);
    // RC-SEC-PR-A: createProcess agora retorna o insertId numérico diretamente
    // (contrato corrigido — antes o router lia (result as any).insertId = NaN).
    vi.mocked(db.createProcess).mockResolvedValue(10 as any);
    vi.mocked(db.getProcessByIdForOrganization).mockResolvedValue(mockProcess as any);
    vi.mocked(db.createActivityLog).mockResolvedValue(undefined as any);
    vi.mocked(db.getDocumentSettingsByUser).mockResolvedValue(null as any);
    vi.mocked(db.searchProcessesForOrganization).mockResolvedValue([] as any);
    vi.mocked(db.getActivityLogsByProcess).mockResolvedValue([] as any);
    vi.mocked(db.createDocument).mockResolvedValue(undefined as any);
    vi.mocked(gemini.generateDFD).mockResolvedValue("# DFD gerado");
  });

  // ── processes.list ──────────────────────────────────────────────────────
  describe("list", () => {
    it("retorna processos do usuário autenticado", async () => {
      vi.mocked(db.listProcessesForOrganization).mockResolvedValue([mockProcess] as any);
      const caller = processesRouter.createCaller(makeContext(mockUser));

      const result = await caller.list();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(10);
    });

    it("filtra processos pela organização do usuário autenticado", async () => {
      vi.mocked(db.listProcessesForOrganization).mockResolvedValue([mockProcess] as any);
      const caller = processesRouter.createCaller(makeContext(mockUser));

      await caller.list();

      expect(db.listProcessesForOrganization).toHaveBeenCalledWith(1);
      expect(db.listProcessesForOrganization).not.toHaveBeenCalledWith(999);
    });

    it("retorna lista vazia quando usuário não tem processos", async () => {
      vi.mocked(db.listProcessesForOrganization).mockResolvedValue([] as any);
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

  // ── processes.create (PR B — corte controlado: gravação legada DESATIVADA) ──
  describe("create — pipeline legado desativado (PR B)", () => {
    it("recusa a criação legada com FORBIDDEN + token estável", async () => {
      const caller = processesRouter.createCaller(makeContext(mockUser));
      await expect(caller.create(validCreateInput)).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringContaining("LEGACY_PROCESS_PIPELINE_DISABLED"),
      });
    });

    it("NÃO grava processo legado (db.createProcess nunca é chamado)", async () => {
      const caller = processesRouter.createCaller(makeContext(mockUser));
      await expect(caller.create(validCreateInput)).rejects.toBeTruthy();
      expect(db.createProcess).not.toHaveBeenCalled();
    });

    it("NÃO dispara geração legada de DFD por IA", async () => {
      const caller = processesRouter.createCaller(makeContext(mockUser));
      await expect(caller.create(validCreateInput)).rejects.toBeTruthy();
      expect(gemini.generateDFD).not.toHaveBeenCalled();
    });

    it("mantém a guarda de autenticação antes da trava (UNAUTHORIZED)", async () => {
      await expect(
        processesRouter.createCaller(makeContext(null)).create(validCreateInput),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  // ── processes.getById ───────────────────────────────────────────────────
  describe("getById", () => {
    it("retorna processo pelo ID", async () => {
      vi.mocked(db.getProcessByIdForOrganization).mockResolvedValue(mockProcess as any);
      const caller = processesRouter.createCaller(makeContext(mockUser));

      const result = await caller.getById({ id: 10 });

      expect(result).toMatchObject({ id: 10, name: "Pregão Eletrônico 001/2025" });
    });

    it("retorna NOT_FOUND para processo inexistente (tenant-safe)", async () => {
      vi.mocked(db.getProcessByIdForOrganization).mockResolvedValue(null as any);
      const caller = processesRouter.createCaller(makeContext(mockUser));

      await expect(caller.getById({ id: 9999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("rejeita acesso sem autenticação", async () => {
      await expect(
        processesRouter.createCaller(makeContext(null)).getById({ id: 10 }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  // ── processes.search ────────────────────────────────────────────────────
  describe("search", () => {
    it("busca processos por termo e isola por organização", async () => {
      vi.mocked(db.searchProcessesForOrganization).mockResolvedValue([mockProcess] as any);
      const caller = processesRouter.createCaller(makeContext(mockUser));

      const result = await caller.search({ query: "Pregão" });

      expect(result).toHaveLength(1);
      expect(db.searchProcessesForOrganization).toHaveBeenCalledWith(1, "Pregão");
    });

    it("retorna lista vazia para busca sem resultados", async () => {
      vi.mocked(db.searchProcessesForOrganization).mockResolvedValue([] as any);
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
      vi.mocked(db.listProcessesForOrganization).mockResolvedValue([mockProcess] as any);
      vi.mocked(db.getActivityLogsByProcess).mockResolvedValue([mockLog] as any);

      const result = await processesRouter.createCaller(makeContext(mockUser)).getActivityLogs();

      expect(result).toHaveLength(1);
      expect(result[0].action).toBe("criou o processo");
    });

    it("retorna lista vazia quando não há atividade", async () => {
      vi.mocked(db.listProcessesForOrganization).mockResolvedValue([] as any);
      const result = await processesRouter.createCaller(makeContext(mockUser)).getActivityLogs();

      expect(result).toHaveLength(0);
    });
  });
});
