/**
 * PR A.1 — routers/passwordResetRouter.ts. `services/passwordResetService` é mockado (já testado
 * isoladamente em password-reset-service.test.ts) — o foco aqui é o CONTRATO do router: validação
 * de input (zod), tradução de ip/correlationId do ctx, e que a resposta pública de `request`
 * é SEMPRE {success:true} independentemente do que o service faça internamente.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeContext } from "../helpers/fixtures";

vi.mock("../../_core/trpc", async () => {
  const actual = await vi.importActual<typeof import("../../_core/trpc")>("../../_core/trpc");
  return actual;
});

vi.mock("../../services/rateLimiter", async () => {
  const trpc = await import("../../_core/trpc");
  return {
    rateLimitMiddleware: (_type: string) => trpc.middleware(({ next }: { next: () => unknown }) => next()),
  };
});

vi.mock("../../services/passwordResetService", () => ({
  requestPasswordReset: vi.fn().mockResolvedValue(undefined),
  validatePasswordResetToken: vi.fn(),
  completePasswordReset: vi.fn().mockResolvedValue(undefined),
}));

import { passwordResetRouter } from "../../routers/passwordResetRouter";
import {
  requestPasswordReset,
  validatePasswordResetToken,
  completePasswordReset,
} from "../../services/passwordResetService";

const requestMock = vi.mocked(requestPasswordReset);
const validateMock = vi.mocked(validatePasswordResetToken);
const completeMock = vi.mocked(completePasswordReset);

beforeEach(() => {
  vi.clearAllMocks();
  requestMock.mockResolvedValue(undefined);
  completeMock.mockResolvedValue(undefined);
});

describe("passwordResetRouter · request", () => {
  it("sempre retorna {success:true}, mesmo que o service não faça nada internamente", async () => {
    const caller = passwordResetRouter.createCaller(makeContext(null));
    const result = await caller.request({ email: "fulano@x.com" });
    expect(result).toEqual({ success: true });
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({ email: "fulano@x.com", ipAddress: "127.0.0.1" })
    );
  });

  it("rejeita e-mail malformado (zod) ANTES de chamar o service", async () => {
    const caller = passwordResetRouter.createCaller(makeContext(null));
    await expect(caller.request({ email: "nao-e-email" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("também funciona autenticado (não exige sessão — é para quem perdeu acesso)", async () => {
    const caller = passwordResetRouter.createCaller(makeContext(null));
    await expect(caller.request({ email: "fulano@x.com" })).resolves.toEqual({ success: true });
  });
});

describe("passwordResetRouter · validateToken", () => {
  it("repassa o resultado do service", async () => {
    validateMock.mockResolvedValue({ valid: true });
    const caller = passwordResetRouter.createCaller(makeContext(null));
    const result = await caller.validateToken({ token: "a".repeat(43) });
    expect(result).toEqual({ valid: true });
  });

  it("token vazio é rejeitado pelo zod antes do service", async () => {
    const caller = passwordResetRouter.createCaller(makeContext(null));
    await expect(caller.validateToken({ token: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(validateMock).not.toHaveBeenCalled();
  });
});

describe("passwordResetRouter · complete", () => {
  it("chama completePasswordReset com token/newPassword/ip/correlationId e retorna {success:true}", async () => {
    const caller = passwordResetRouter.createCaller(makeContext(null));
    const result = await caller.complete({ token: "a".repeat(43), newPassword: "senhaForteNova123" });
    expect(result).toEqual({ success: true });
    expect(completeMock).toHaveBeenCalledWith(
      expect.objectContaining({ token: "a".repeat(43), newPassword: "senhaForteNova123", ipAddress: "127.0.0.1" })
    );
  });

  it("senha curta demais é rejeitada pelo zod antes do service", async () => {
    const caller = passwordResetRouter.createCaller(makeContext(null));
    await expect(caller.complete({ token: "a".repeat(43), newPassword: "curta" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("erro do service (ex.: token expirado) propaga para o cliente", async () => {
    const { TRPCError } = await import("@trpc/server");
    completeMock.mockRejectedValueOnce(new TRPCError({ code: "BAD_REQUEST", message: "PASSWORD_RESET_EXPIRED" }));
    const caller = passwordResetRouter.createCaller(makeContext(null));
    await expect(caller.complete({ token: "a".repeat(43), newPassword: "senhaForteNova123" })).rejects.toMatchObject({ message: "PASSWORD_RESET_EXPIRED" });
  });
});
