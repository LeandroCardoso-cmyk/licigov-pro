/**
 * Testes de Integração — Autenticação
 *
 * Cobre: login válido/inválido, registro, logout, JWT, procedures protegidas,
 * validação de payload, controle de acesso por role.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (hoisted pelo vitest) ─────────────────────────────────────────────

vi.mock("../../db");

vi.mock("../../_core/sdk", () => ({
  sdk: {
    signSession: vi.fn().mockResolvedValue("fake-jwt-token"),
    authenticateRequest: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("../../_core/cookies", () => ({
  getSessionCookieOptions: vi.fn().mockReturnValue({ httpOnly: true, path: "/" }),
}));

vi.mock("../../services/passwordSecurity", () => ({
  hashPassword: vi.fn().mockResolvedValue("$2b$12$mocked-hash"),
  verifyPassword: vi.fn(),
}));

vi.mock("../../services/rateLimiter", async () => {
  const trpc = await import("../../_core/trpc");
  return {
    RATE_LIMITS: {
      login: { windowMs: 900000, max: 5, message: "Muitas tentativas." },
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

// ─── Imports (após os mocks) ─────────────────────────────────────────────────

import { authRouter } from "../../routers/authRouter";
import * as db from "../../db";
import { hashPassword, verifyPassword } from "../../services/passwordSecurity";
import { sdk } from "../../_core/sdk";
import { makeContext, mockUser, mockAdmin } from "../helpers/fixtures";

// ─── Testes ───────────────────────────────────────────────────────────────────

describe("Auth Router — Integração", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sdk.signSession).mockResolvedValue("fake-jwt-token");
    vi.mocked(db.getUserByEmail).mockResolvedValue(null as any);
    vi.mocked(db.createUser).mockResolvedValue(mockUser as any);
    vi.mocked(hashPassword).mockResolvedValue("$2b$12$mocked-hash");
    vi.mocked(verifyPassword).mockResolvedValue(false);
  });

  // ── auth.me ──────────────────────────────────────────────────────────────
  describe("me", () => {
    it("retorna null quando não autenticado", async () => {
      const caller = authRouter.createCaller(makeContext(null));
      const result = await caller.me();
      expect(result).toBeNull();
    });

    it("retorna o usuário autenticado corretamente", async () => {
      const caller = authRouter.createCaller(makeContext(mockUser));
      const result = await caller.me();
      expect(result).toMatchObject({ id: 1, email: "teste@licigov.com.br", role: "user" });
    });

    it("retorna admin com role correto", async () => {
      const caller = authRouter.createCaller(makeContext(mockAdmin));
      const result = await caller.me();
      expect(result).toMatchObject({ role: "admin" });
    });
  });

  // ── auth.login ───────────────────────────────────────────────────────────
  describe("login", () => {
    it("autentica com credenciais válidas e seta cookie", async () => {
      vi.mocked(db.getUserByEmail).mockResolvedValue(mockUser as any);
      vi.mocked(verifyPassword).mockResolvedValue(true);
      const ctx = makeContext(null);

      const result = await authRouter.createCaller(ctx).login({
        email: "teste@licigov.com.br",
        password: "Senha@123",
      });

      expect(result.success).toBe(true);
      expect(result.user.email).toBe("teste@licigov.com.br");
      expect(ctx.res.cookie).toHaveBeenCalledWith(
        expect.any(String),
        "fake-jwt-token",
        expect.any(Object),
      );
    });

    it("rejeita senha incorreta com UNAUTHORIZED", async () => {
      vi.mocked(db.getUserByEmail).mockResolvedValue(mockUser as any);
      vi.mocked(verifyPassword).mockResolvedValue(false);

      await expect(
        authRouter.createCaller(makeContext(null)).login({
          email: "teste@licigov.com.br",
          password: "SenhaErrada",
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED", message: expect.stringContaining("incorretos") });
    });

    it("retorna UNAUTHORIZED para e-mail inexistente (não vaza existência)", async () => {
      vi.mocked(db.getUserByEmail).mockResolvedValue(null as any);

      await expect(
        authRouter.createCaller(makeContext(null)).login({
          email: "naocadastrado@teste.com",
          password: "Qualquer@123",
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED", message: expect.stringContaining("incorretos") });
    });

    it("rejeita usuário sem passwordHash (conta OAuth) com UNAUTHORIZED", async () => {
      vi.mocked(db.getUserByEmail).mockResolvedValue({ ...mockUser, passwordHash: null } as any);

      await expect(
        authRouter.createCaller(makeContext(null)).login({
          email: "oauth@teste.com",
          password: "Qualquer@123",
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("rejeita e-mail malformado com BAD_REQUEST (validação Zod)", async () => {
      await expect(
        authRouter.createCaller(makeContext(null)).login({
          email: "email-invalido-sem-arroba",
          password: "Senha@123",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rejeita senha vazia com BAD_REQUEST (validação Zod)", async () => {
      await expect(
        authRouter.createCaller(makeContext(null)).login({
          email: "teste@licigov.com.br",
          password: "",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rejeita e-mail acima de 254 chars com BAD_REQUEST", async () => {
      const longEmail = `${"a".repeat(250)}@b.co`;
      await expect(
        authRouter.createCaller(makeContext(null)).login({ email: longEmail, password: "Senha@123" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // ── auth.register ────────────────────────────────────────────────────────
  describe("register", () => {
    it("cria conta com dados válidos e seta cookie", async () => {
      vi.mocked(db.getUserByEmail).mockResolvedValue(null as any);
      vi.mocked(db.createUser).mockResolvedValue(mockUser as any);
      const ctx = makeContext(null);

      const result = await authRouter.createCaller(ctx).register({
        name: "João Silva",
        email: "joao@prefeitura.gov.br",
        password: "Senha@123456",
      });

      expect(result.success).toBe(true);
      expect(hashPassword).toHaveBeenCalledWith("Senha@123456");
      expect(ctx.res.cookie).toHaveBeenCalled();
    });

    it("rejeita e-mail já cadastrado com CONFLICT", async () => {
      vi.mocked(db.getUserByEmail).mockResolvedValue(mockUser as any);

      await expect(
        authRouter.createCaller(makeContext(null)).register({
          name: "Outro Usuário",
          email: "teste@licigov.com.br",
          password: "Senha@123456",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("já cadastrado") });
    });

    it("rejeita nome com menos de 2 chars com BAD_REQUEST", async () => {
      await expect(
        authRouter.createCaller(makeContext(null)).register({
          name: "A",
          email: "novo@teste.com",
          password: "Senha@123456",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rejeita senha com menos de 8 chars com BAD_REQUEST", async () => {
      await expect(
        authRouter.createCaller(makeContext(null)).register({
          name: "João Silva",
          email: "novo@teste.com",
          password: "123",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rejeita e-mail inválido no registro com BAD_REQUEST", async () => {
      await expect(
        authRouter.createCaller(makeContext(null)).register({
          name: "João Silva",
          email: "nao-e-um-email",
          password: "Senha@123456",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // ── auth.logout ──────────────────────────────────────────────────────────
  describe("logout", () => {
    it("limpa o cookie de sessão para usuário autenticado", async () => {
      const ctx = makeContext(mockUser);
      const result = await authRouter.createCaller(ctx).logout();

      expect(result.success).toBe(true);
      expect(ctx.res.clearCookie).toHaveBeenCalled();
    });

    it("também limpa o cookie quando não há sessão ativa", async () => {
      const ctx = makeContext(null);
      const result = await authRouter.createCaller(ctx).logout();

      expect(result.success).toBe(true);
      expect(ctx.res.clearCookie).toHaveBeenCalled();
    });
  });

  // ── auth.updateTheme ─────────────────────────────────────────────────────
  describe("updateTheme", () => {
    it("atualiza o tema para usuário autenticado", async () => {
      vi.mocked(db.updateUserTheme).mockResolvedValue(undefined as any);

      const result = await authRouter.createCaller(makeContext(mockUser)).updateTheme({ theme: "dark" });

      expect(result.success).toBe(true);
      expect(db.updateUserTheme).toHaveBeenCalledWith(mockUser.id, "dark");
    });

    it("rejeita acesso sem autenticação com UNAUTHORIZED", async () => {
      await expect(
        authRouter.createCaller(makeContext(null)).updateTheme({ theme: "dark" }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("rejeita tema inválido com BAD_REQUEST (Zod enum)", async () => {
      await expect(
        authRouter.createCaller(makeContext(mockUser)).updateTheme({ theme: "rainbow" as any }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("aceita todos os temas válidos", async () => {
      vi.mocked(db.updateUserTheme).mockResolvedValue(undefined as any);
      const caller = authRouter.createCaller(makeContext(mockUser));

      for (const theme of ["light", "dark", "system"] as const) {
        const result = await caller.updateTheme({ theme });
        expect(result.success).toBe(true);
      }
    });
  });

  // ── Middleware de autenticação ────────────────────────────────────────────
  describe("middleware de autenticação (requireUser)", () => {
    it("procedure protegida bloqueia acesso de não-autenticado", async () => {
      await expect(
        authRouter.createCaller(makeContext(null)).updateTheme({ theme: "light" }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("procedure pública é acessível sem autenticação", async () => {
      const result = await authRouter.createCaller(makeContext(null)).me();
      expect(result).toBeNull();
    });
  });
});
