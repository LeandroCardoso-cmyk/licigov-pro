/**
 * PR A.1 — Revogação de sessão via claim `tv` (tokenVersion). Usa o `sdk` REAL (jose real, secret
 * de desenvolvimento) — só `db.getUserByOpenId` é mockado, para controlar o `tokenVersion` do
 * usuário retornado. Cobre: sessão válida (tv bate), sessão revogada (tv desatualizado — ex.:
 * emitida antes de uma redefinição de senha), e retrocompatibilidade com tokens emitidos antes
 * desta mudança (sem claim `tv` → tratado como 0).
 */

import { describe, it, expect, vi } from "vitest";
import type { Request } from "express";
import type { User } from "../../../drizzle/schema";

vi.mock("../../db", () => ({
  getUserByOpenId: vi.fn(),
}));

import { sdk } from "../../_core/sdk";
import { getUserByOpenId } from "../../db";

const getUserByOpenIdMock = vi.mocked(getUserByOpenId);

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1, openId: "open-id-001", name: "Usuário Teste", email: "teste@licigov.com.br",
    loginMethod: "email", role: "user", theme: "light", passwordHash: "$2b$12$hash",
    signaturePassword: null, tokenVersion: 0,
    createdAt: new Date("2025-01-01"), updatedAt: new Date("2025-01-01"), lastSignedIn: new Date("2025-01-01"),
    ...overrides,
  } as User;
}

function reqWithCookie(token: string): Request {
  return { headers: { cookie: `app_session_id=${token}` } } as unknown as Request;
}

describe("session-revocation · sessão válida", () => {
  it("token com tv=0 e user.tokenVersion=0 → autentica normalmente", async () => {
    getUserByOpenIdMock.mockResolvedValue(makeUser({ tokenVersion: 0 }));
    const token = await sdk.signSession({ openId: "open-id-001", appId: "licigov-pro", name: "Usuário", tv: 0 });
    const user = await sdk.authenticateRequest(reqWithCookie(token));
    expect(user.id).toBe(1);
  });

  it("token com tv=3 e user.tokenVersion=3 (várias redefinições depois, sessão emitida na 3ª) → autentica", async () => {
    getUserByOpenIdMock.mockResolvedValue(makeUser({ tokenVersion: 3 }));
    const token = await sdk.signSession({ openId: "open-id-001", appId: "licigov-pro", name: "Usuário", tv: 3 });
    const user = await sdk.authenticateRequest(reqWithCookie(token));
    expect(user.id).toBe(1);
  });
});

describe("session-revocation · sessão revogada", () => {
  it("token emitido com tv=0, mas users.tokenVersion já avançou para 1 (senha redefinida depois) → Forbidden", async () => {
    getUserByOpenIdMock.mockResolvedValue(makeUser({ tokenVersion: 1 }));
    const token = await sdk.signSession({ openId: "open-id-001", appId: "licigov-pro", name: "Usuário", tv: 0 });
    await expect(sdk.authenticateRequest(reqWithCookie(token))).rejects.toThrow();
  });

  it("token com tv MAIOR que o do usuário (cenário anômalo, ex.: rollback de banco) também é rejeitado — comparação é de igualdade, não de 'ainda válido'", async () => {
    getUserByOpenIdMock.mockResolvedValue(makeUser({ tokenVersion: 0 }));
    const token = await sdk.signSession({ openId: "open-id-001", appId: "licigov-pro", name: "Usuário", tv: 5 });
    await expect(sdk.authenticateRequest(reqWithCookie(token))).rejects.toThrow();
  });
});

describe("session-revocation · retrocompatibilidade", () => {
  it("token SEM claim tv (emitido antes desta mudança) + user.tokenVersion=0 → ainda válido (tv ausente tratado como 0)", async () => {
    getUserByOpenIdMock.mockResolvedValue(makeUser({ tokenVersion: 0 }));
    // Simula um token "legado": assina sem passar `tv` — signSession aplica o default `?? 0`.
    const token = await sdk.signSession({ openId: "open-id-001", appId: "licigov-pro", name: "Usuário" });
    const user = await sdk.authenticateRequest(reqWithCookie(token));
    expect(user.id).toBe(1);
  });

  it("token legado (tv=0 implícito) + user.tokenVersion=1 (senha redefinida) → Forbidden, como esperado", async () => {
    getUserByOpenIdMock.mockResolvedValue(makeUser({ tokenVersion: 1 }));
    const token = await sdk.signSession({ openId: "open-id-001", appId: "licigov-pro", name: "Usuário" });
    await expect(sdk.authenticateRequest(reqWithCookie(token))).rejects.toThrow();
  });
});

describe("session-revocation · verifySession expõe tv (retrocompat)", () => {
  it("verifySession de um token com tv retorna o número; sem tv retorna 0", async () => {
    const withTv = await sdk.signSession({ openId: "x", appId: "a", name: "n", tv: 7 });
    const withoutTv = await sdk.signSession({ openId: "x", appId: "a", name: "n" });
    expect((await sdk.verifySession(withTv))?.tv).toBe(7);
    expect((await sdk.verifySession(withoutTv))?.tv).toBe(0);
  });
});
