/**
 * PR A.1 — utils/authErrorMessages.ts.
 */

import { describe, it, expect } from "vitest";
import { translateAuthError } from "./authErrorMessages";

describe("authErrorMessages · translateAuthError", () => {
  it("traduz um código conhecido para pt-BR amigável", () => {
    expect(translateAuthError("INVITATION_EXPIRED")).toMatch(/expirou/i);
    expect(translateAuthError("PASSWORD_RESET_CONSUMED")).toMatch(/já foi usado/i);
    expect(translateAuthError("LAST_TENANT_ADMIN")).toMatch(/último administrador/i);
  });

  it("mensagem já pronta em pt-BR (ex.: validação zod) passa direto, sem alteração", () => {
    expect(translateAuthError("Senha deve ter pelo menos 8 caracteres")).toBe("Senha deve ter pelo menos 8 caracteres");
  });

  it("null/undefined/vazio → mensagem padrão, nunca lança", () => {
    expect(translateAuthError(null)).toMatch(/erro inesperado/i);
    expect(translateAuthError(undefined)).toMatch(/erro inesperado/i);
    expect(translateAuthError("")).toMatch(/erro inesperado/i);
  });

  it("todo código de erro do backend (18 no total) tem uma tradução distinta da mensagem padrão", () => {
    const codes = [
      "INVITATION_NOT_FOUND", "INVITATION_EXPIRED", "INVITATION_CANCELLED", "INVITATION_ALREADY_ACCEPTED",
      "INVITATION_EMAIL_MISMATCH", "MEMBER_ALREADY_EXISTS", "MEMBER_NOT_FOUND", "LAST_TENANT_ADMIN",
      "ROLE_ASSIGNMENT_FORBIDDEN", "TENANT_ACCESS_FORBIDDEN", "PASSWORD_RESET_INVALID", "PASSWORD_RESET_EXPIRED",
      "PASSWORD_RESET_CONSUMED", "RATE_LIMITED", "EMAIL_DELIVERY_FAILED", "EMAIL_CONFIGURATION_MISSING",
      "TENANT_ALREADY_EXISTS", "ONBOARDING_CONFLICT",
    ];
    for (const code of codes) {
      const translated = translateAuthError(code);
      expect(translated).not.toBe(code);
      expect(translated.length).toBeGreaterThan(0);
    }
  });
});
