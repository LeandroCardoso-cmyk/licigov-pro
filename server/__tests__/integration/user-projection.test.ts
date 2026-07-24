/**
 * PR A.1 — services/userProjection.ts (sanitizeUser/sanitizeUsers).
 *
 * Defeito original: `auth.me` e `admin.listUsers` retornavam a linha COMPLETA de `users` ao
 * cliente — incluindo `passwordHash`/`signaturePassword` (hashes bcrypt).
 */

import { describe, it, expect } from "vitest";
import type { User } from "../../../drizzle/schema";
import { sanitizeUser, sanitizeUsers } from "../../services/userProjection";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1, openId: "open-id-001", name: "Usuário Teste", email: "teste@licigov.com.br",
    loginMethod: "email", role: "user", theme: "light", passwordHash: "$2b$12$hashedpassword",
    signaturePassword: "$2b$12$hashedsignature", tokenVersion: 2,
    createdAt: new Date("2025-01-01"), updatedAt: new Date("2025-06-01"), lastSignedIn: new Date("2025-07-01"),
    ...overrides,
  } as User;
}

describe("userProjection · sanitizeUser", () => {
  it("NUNCA inclui passwordHash", () => {
    const result = sanitizeUser(makeUser()) as unknown as Record<string, unknown>;
    expect(result).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(result)).not.toContain("hashedpassword");
  });

  it("NUNCA inclui signaturePassword", () => {
    const result = sanitizeUser(makeUser()) as unknown as Record<string, unknown>;
    expect(result).not.toHaveProperty("signaturePassword");
    expect(JSON.stringify(result)).not.toContain("hashedsignature");
  });

  it("NUNCA inclui tokenVersion (mecanismo interno, irrelevante ao cliente)", () => {
    const result = sanitizeUser(makeUser()) as unknown as Record<string, unknown>;
    expect(result).not.toHaveProperty("tokenVersion");
  });

  it("mantém os campos públicos: id, openId, name, email, role, theme, createdAt, lastSignedIn", () => {
    const user = makeUser();
    const result = sanitizeUser(user);
    expect(result).toEqual({
      id: user.id, openId: user.openId, name: user.name, email: user.email,
      role: user.role, theme: user.theme, createdAt: user.createdAt, lastSignedIn: user.lastSignedIn,
    });
  });

  it("compatível com toMatchObject({id,email,role}) usado por auth.test.ts", () => {
    const result = sanitizeUser(makeUser({ id: 1, email: "teste@licigov.com.br", role: "user" }));
    expect(result).toMatchObject({ id: 1, email: "teste@licigov.com.br", role: "user" });
  });
});

describe("userProjection · sanitizeUsers", () => {
  it("aplica sanitizeUser a cada item da lista, preservando a ordem", () => {
    const users = [makeUser({ id: 1 }), makeUser({ id: 2, role: "admin" })];
    const result = sanitizeUsers(users);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(1);
    expect(result[1].id).toBe(2);
    expect(result[1].role).toBe("admin");
    for (const u of result as unknown as Record<string, unknown>[]) {
      expect(u).not.toHaveProperty("passwordHash");
    }
  });

  it("lista vazia → lista vazia", () => {
    expect(sanitizeUsers([])).toEqual([]);
  });
});
