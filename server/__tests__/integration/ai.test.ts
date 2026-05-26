/**
 * Testes de Integração — IA / Geração de Documentos
 *
 * Cobre: suggestModality, suggestRisks, suggestClauses, suggestLegalBasis,
 * improveText, tratamento de timeout, tratamento de erro do Gemini,
 * log de atividade, processo inexistente.
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

vi.mock("../../services/ai/suggestions", () => ({
  suggestModality: vi.fn().mockResolvedValue("## Modalidade Recomendada\n\n**Pregão Eletrônico** (Art. 6º, inciso XLI da Lei 14.133/21)"),
  suggestRisks: vi.fn().mockResolvedValue("### 🔴 Riscos Altos\n- **Subdimensionamento:** ..."),
  suggestClauses: vi.fn().mockResolvedValue("## Cláusula 5ª — Penalidades\n\nConforme Art. 155..."),
  suggestTechnicalRequirements: vi.fn().mockResolvedValue("1. Qualificação técnica da empresa..."),
  suggestLegalBasis: vi.fn().mockResolvedValue("**Art. 75, inciso I** da Lei 14.133/21..."),
  improveText: vi.fn().mockResolvedValue("Texto reescrito com linguagem técnica adequada."),
}));

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
  storagePut: vi.fn().mockResolvedValue({ key: "test", url: "https://s3.example.com" }),
  storageGet: vi.fn().mockResolvedValue({ url: "https://s3.example.com/presigned" }),
}));

vi.mock("../../_core/sdk", () => ({
  sdk: {
    signSession: vi.fn().mockResolvedValue("fake-token"),
    authenticateRequest: vi.fn().mockResolvedValue(null),
  },
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import { aiAssistantRouter } from "../../routers/aiAssistantRouter";
import * as db from "../../db";
import * as suggestions from "../../services/ai/suggestions";
import { makeContext, mockUser, mockProcess, mockDocument } from "../helpers/fixtures";

// ─── Testes ───────────────────────────────────────────────────────────────────

describe("AI Assistant Router — Integração", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.getProcessById).mockResolvedValue(mockProcess as any);
    vi.mocked(db.getDocumentsByProcess).mockResolvedValue([mockDocument] as any);
    vi.mocked(db.createActivityLog).mockResolvedValue(undefined as any);
    vi.mocked(suggestions.suggestModality).mockResolvedValue("## Modalidade Recomendada\n\n**Pregão Eletrônico**");
    vi.mocked(suggestions.suggestRisks).mockResolvedValue("### Riscos\n- Risco A");
    vi.mocked(suggestions.suggestClauses).mockResolvedValue("## Cláusula 5ª\n\nTexto...");
    vi.mocked(suggestions.suggestLegalBasis).mockResolvedValue("**Art. 75** da Lei 14.133/21");
    vi.mocked(suggestions.improveText).mockResolvedValue("Texto melhorado.");
  });

  // ── suggestModality ──────────────────────────────────────────────────────
  describe("suggestModality", () => {
    it("retorna sugestão de modalidade com conteúdo", async () => {
      const caller = aiAssistantRouter.createCaller(makeContext(mockUser));
      const result = await caller.suggestModality({ processId: 10 });

      expect(result.suggestion).toContain("Pregão Eletrônico");
      expect(suggestions.suggestModality).toHaveBeenCalled();
    });

    it("passa o contexto correto do processo para o modelo de IA", async () => {
      const caller = aiAssistantRouter.createCaller(makeContext(mockUser));
      await caller.suggestModality({ processId: 10 });

      expect(suggestions.suggestModality).toHaveBeenCalledWith(
        expect.objectContaining({
          name: mockProcess.name,
          modality: mockProcess.modality,
          estimatedValue: mockProcess.estimatedValue,
        }),
      );
    });

    it("registra log de atividade após sugestão", async () => {
      const caller = aiAssistantRouter.createCaller(makeContext(mockUser));
      await caller.suggestModality({ processId: 10 });

      expect(db.createActivityLog).toHaveBeenCalledWith(
        expect.objectContaining({
          processId: 10,
          userId: mockUser.id,
          action: expect.stringContaining("modalidade"),
        }),
      );
    });

    it("lança NOT_FOUND para processo inexistente", async () => {
      vi.mocked(db.getProcessById).mockResolvedValue(null as any);

      await expect(
        aiAssistantRouter.createCaller(makeContext(mockUser)).suggestModality({ processId: 9999 }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("propaga erro do Gemini como erro de servidor", async () => {
      vi.mocked(suggestions.suggestModality).mockRejectedValue(new Error("Gemini API timeout"));

      await expect(
        aiAssistantRouter.createCaller(makeContext(mockUser)).suggestModality({ processId: 10 }),
      ).rejects.toThrow();
    });

    it("rejeita acesso sem autenticação", async () => {
      await expect(
        aiAssistantRouter.createCaller(makeContext(null)).suggestModality({ processId: 10 }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  // ── suggestRisks ─────────────────────────────────────────────────────────
  describe("suggestRisks", () => {
    it("retorna análise de riscos", async () => {
      const caller = aiAssistantRouter.createCaller(makeContext(mockUser));
      const result = await caller.suggestRisks({ processId: 10 });

      expect(result.suggestion).toContain("Riscos");
      expect(suggestions.suggestRisks).toHaveBeenCalled();
    });

    it("inclui conteúdo dos documentos no contexto para análise de riscos", async () => {
      vi.mocked(db.getDocumentsByProcess).mockResolvedValue([
        { ...mockDocument, type: "etp", content: "Conteúdo do ETP" },
        { ...mockDocument, type: "tr", content: "Conteúdo do TR", id: 200 },
      ] as any);

      const caller = aiAssistantRouter.createCaller(makeContext(mockUser));
      await caller.suggestRisks({ processId: 10 });

      expect(suggestions.suggestRisks).toHaveBeenCalledWith(
        expect.objectContaining({ etpContent: "Conteúdo do ETP", trContent: "Conteúdo do TR" }),
      );
    });

    it("registra log de atividade de análise de riscos", async () => {
      await aiAssistantRouter.createCaller(makeContext(mockUser)).suggestRisks({ processId: 10 });

      expect(db.createActivityLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: expect.stringContaining("riscos") }),
      );
    });
  });

  // ── suggestClauses ───────────────────────────────────────────────────────
  describe("suggestClauses", () => {
    it("retorna sugestão de cláusula com o tipo solicitado", async () => {
      const caller = aiAssistantRouter.createCaller(makeContext(mockUser));
      const result = await caller.suggestClauses({ processId: 10, clauseType: "penalidades" });

      expect(result.suggestion).toBeDefined();
      expect(suggestions.suggestClauses).toHaveBeenCalledWith(
        expect.any(Object),
        "penalidades",
      );
    });

    it("rejeita tipo de cláusula vazio com BAD_REQUEST", async () => {
      await expect(
        aiAssistantRouter.createCaller(makeContext(mockUser)).suggestClauses({ processId: 10, clauseType: "" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // ── suggestLegalBasis ────────────────────────────────────────────────────
  describe("suggestLegalBasis", () => {
    it("retorna fundamentação jurídica para a pergunta informada", async () => {
      const caller = aiAssistantRouter.createCaller(makeContext(mockUser));
      const result = await caller.suggestLegalBasis({
        processId: 10,
        question: "Posso dispensar licitação para valor abaixo de R$ 50.000?",
      });

      expect(result.suggestion).toContain("Art. 75");
      expect(suggestions.suggestLegalBasis).toHaveBeenCalledWith(
        expect.any(Object),
        "Posso dispensar licitação para valor abaixo de R$ 50.000?",
      );
    });

    it("rejeita pergunta vazia com BAD_REQUEST", async () => {
      await expect(
        aiAssistantRouter.createCaller(makeContext(mockUser)).suggestLegalBasis({ processId: 10, question: "" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // ── improveText ──────────────────────────────────────────────────────────
  describe("improveText", () => {
    it("retorna o texto melhorado", async () => {
      const caller = aiAssistantRouter.createCaller(makeContext(mockUser));
      const result = await caller.improveText({
        processId: 10,
        docType: "tr",
        textSnippet: "A contratação visa adquirir computadores.",
      });

      expect(result.suggestion).toBe("Texto melhorado.");
      expect(suggestions.improveText).toHaveBeenCalledWith(
        expect.any(Object),
        "tr",
        "A contratação visa adquirir computadores.",
      );
    });

    it("rejeita snippet vazio com BAD_REQUEST", async () => {
      await expect(
        aiAssistantRouter.createCaller(makeContext(mockUser)).improveText({
          processId: 10,
          docType: "etp",
          textSnippet: "",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rejeita snippet acima do limite de tamanho", async () => {
      const hugeText = "x".repeat(10001);
      await expect(
        aiAssistantRouter.createCaller(makeContext(mockUser)).improveText({
          processId: 10,
          docType: "etp",
          textSnippet: hugeText,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // ── Contexto de documentos ────────────────────────────────────────────────
  describe("buildContext — construção de contexto a partir dos documentos", () => {
    it("contexto sem documentos tem campos null", async () => {
      vi.mocked(db.getDocumentsByProcess).mockResolvedValue([] as any);
      const caller = aiAssistantRouter.createCaller(makeContext(mockUser));

      await caller.suggestModality({ processId: 10 });

      expect(suggestions.suggestModality).toHaveBeenCalledWith(
        expect.objectContaining({
          dfdContent: null,
          etpContent: null,
          trContent: null,
        }),
      );
    });

    it("contexto preenche campos dos documentos existentes", async () => {
      vi.mocked(db.getDocumentsByProcess).mockResolvedValue([
        { ...mockDocument, type: "dfd", content: "# DFD aqui" },
      ] as any);

      const caller = aiAssistantRouter.createCaller(makeContext(mockUser));
      await caller.suggestRisks({ processId: 10 });

      expect(suggestions.suggestRisks).toHaveBeenCalledWith(
        expect.objectContaining({ dfdContent: "# DFD aqui" }),
      );
    });
  });
});
