/**
 * PR A.1 (homologação) — Regressão de sanitização em adminRouter.listUsers.
 *
 * Defeito original: `admin.listUsers` retornava a linha COMPLETA de `users` (com passwordHash/
 * signaturePassword) para o administrador de plataforma. Corrigido no C6 com `sanitizeUsers`.
 * Este teste trava o comportamento — `db.getAllUsers` é mockado devolvendo uma linha COM os
 * campos sensíveis, e verificamos que eles NUNCA chegam ao retorno do router.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeContext } from "../helpers/fixtures";
import type { User } from "../../../drizzle/schema";

vi.mock("../../db", () => ({
  getAllUsers: vi.fn(),
  updateUserRole: vi.fn(),
  createAuditLog: vi.fn(),
  getUserStats: vi.fn(),
  getAuditLogs: vi.fn(),
}));

import * as db from "../../db";
import { adminRouter } from "../../routers/adminRouter";

const getAllUsersMock = vi.mocked(db.getAllUsers);

const PLATFORM_ADMIN = { id: 1, role: "admin" as const, openId: "admin", name: "Admin", email: "admin@x.com", theme: "light" as const, loginMethod: "email", passwordHash: null, signaturePassword: null, tokenVersion: 0, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };
const NORMAL_USER = { ...PLATFORM_ADMIN, id: 5, role: "user" as const };

function rawUser(): User {
  return {
    id: 10, openId: "open-id-secreto", name: "Servidor", email: "servidor@orgao.gov.br",
    loginMethod: "email", role: "user", theme: "light",
    passwordHash: "$2b$12$HASH_SECRETO", signaturePassword: "$2b$12$ASSINATURA_SECRETA", tokenVersion: 7,
    createdAt: new Date("2025-01-01"), updatedAt: new Date("2025-06-01"), lastSignedIn: new Date("2025-07-01"),
  } as User;
}

beforeEach(() => vi.clearAllMocks());

describe("adminRouter.listUsers · sanitização", () => {
  it("não-admin de plataforma → FORBIDDEN", async () => {
    const caller = adminRouter.createCaller(makeContext(NORMAL_USER as never) as never);
    await expect(caller.listUsers()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin: retorna a lista SEM passwordHash/signaturePassword/tokenVersion/openId", async () => {
    getAllUsersMock.mockResolvedValue([rawUser()]);
    const caller = adminRouter.createCaller(makeContext(PLATFORM_ADMIN as never) as never);
    const result = (await caller.listUsers()) as unknown as Record<string, unknown>[];

    expect(result).toHaveLength(1);
    for (const forbidden of ["passwordHash", "signaturePassword", "tokenVersion", "openId", "loginMethod", "updatedAt"]) {
      expect(result[0], `campo "${forbidden}" vazou em admin.listUsers`).not.toHaveProperty(forbidden);
    }
    // nenhum hash sensível aparece no JSON serializado
    expect(JSON.stringify(result)).not.toContain("HASH_SECRETO");
    expect(JSON.stringify(result)).not.toContain("ASSINATURA_SECRETA");
    expect(JSON.stringify(result)).not.toContain("open-id-secreto");
    // campos públicos preservados
    expect(result[0]).toMatchObject({ id: 10, name: "Servidor", email: "servidor@orgao.gov.br", role: "user" });
  });
});
