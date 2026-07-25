/**
 * PR A.1 — domain/passwordPolicy.ts (política de senha compartilhada: reset + aceite de convite).
 */

import { describe, it, expect } from "vitest";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  normalizeEmail,
  validatePassword,
} from "../../domain/passwordPolicy";

describe("domain/passwordPolicy · normalizeEmail", () => {
  it("trim + lowercase", () => {
    expect(normalizeEmail("  Fulano@LiciGov.com.br  ")).toBe("fulano@licigov.com.br");
  });
});

describe("domain/passwordPolicy · validatePassword", () => {
  it("constantes: min 8, max 128 (mesma regra hoje só aplicada via zod em authRouter.register)", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(PASSWORD_MAX_LENGTH).toBe(128);
  });

  it("senha curta demais → inválida com code PASSWORD_TOO_SHORT", () => {
    const r = validatePassword("1234567"); // 7 chars
    expect(r.valid).toBe(false);
    expect(r.code).toBe("PASSWORD_TOO_SHORT");
    expect(r.message).toMatch(/8/);
  });

  it("senha longa demais → inválida com code PASSWORD_TOO_LONG", () => {
    const r = validatePassword("a".repeat(129));
    expect(r.valid).toBe(false);
    expect(r.code).toBe("PASSWORD_TOO_LONG");
  });

  it("limites exatos (8 e 128 chars) são válidos", () => {
    expect(validatePassword("a".repeat(8)).valid).toBe(true);
    expect(validatePassword("a".repeat(128)).valid).toBe(true);
  });

  it("senha igual ao e-mail (normalizado) → inválida com code PASSWORD_EQUALS_EMAIL", () => {
    const r = validatePassword("Fulano@X.com", { email: "  fulano@x.com  " });
    expect(r.valid).toBe(false);
    expect(r.code).toBe("PASSWORD_EQUALS_EMAIL");
  });

  it("sem context.email, a checagem senha≠e-mail é pulada", () => {
    expect(validatePassword("qualquerSenha1").valid).toBe(true);
  });

  it("senha válida e diferente do e-mail → válida, sem code/message", () => {
    const r = validatePassword("senhaForteDemais123", { email: "fulano@x.com" });
    expect(r).toEqual({ valid: true });
  });
});
