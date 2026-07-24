/**
 * PR A.1 — domain/authErrors.ts (códigos de erro estáveis do fluxo de acesso institucional).
 *
 * Estes valores viram `message` de TRPCError e são consumidos pelo client como contrato
 * (client/src/utils/authErrorMessages.ts, C9) — este teste é uma rede de segurança contra
 * duplicatas/typos acidentais introduzidos em edições futuras, e contra a string de um código
 * mudar sem querer (o que quebraria o mapeamento no client silenciosamente).
 */

import { describe, it, expect } from "vitest";
import * as authErrors from "../../domain/authErrors";
import { AUTH_ERROR_CODES } from "../../domain/authErrors";

describe("domain/authErrors · integridade dos códigos", () => {
  it("todo código exportado é uma string SCREAMING_SNAKE_CASE não vazia", () => {
    for (const code of AUTH_ERROR_CODES) {
      expect(code).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  it("nenhum código se repete (cada erro tem string única)", () => {
    expect(new Set(AUTH_ERROR_CODES).size).toBe(AUTH_ERROR_CODES.length);
  });

  it("a const exportada tem o MESMO nome do seu valor (padrão do projeto: message = nome da const)", () => {
    const exported = authErrors as Record<string, unknown>;
    for (const code of AUTH_ERROR_CODES) {
      expect(exported[code]).toBe(code);
    }
  });

  it("congela a lista esperada de códigos — mudar isto é uma mudança de contrato client/server", () => {
    expect([...AUTH_ERROR_CODES].sort()).toEqual(
      [
        "INVITATION_NOT_FOUND",
        "INVITATION_EXPIRED",
        "INVITATION_CANCELLED",
        "INVITATION_ALREADY_ACCEPTED",
        "INVITATION_EMAIL_MISMATCH",
        "MEMBER_ALREADY_EXISTS",
        "MEMBER_NOT_FOUND",
        "LAST_TENANT_ADMIN",
        "ROLE_ASSIGNMENT_FORBIDDEN",
        "TENANT_ACCESS_FORBIDDEN",
        "PASSWORD_RESET_INVALID",
        "PASSWORD_RESET_EXPIRED",
        "PASSWORD_RESET_CONSUMED",
        "RATE_LIMITED",
        "EMAIL_DELIVERY_FAILED",
        "EMAIL_CONFIGURATION_MISSING",
        "TENANT_ALREADY_EXISTS",
        "ONBOARDING_CONFLICT",
      ].sort()
    );
  });
});
