import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit, resetRateLimit, RATE_LIMITS } from "../rateLimiter";

const ID = "test-user-42";

beforeEach(() => {
  // Resetar estado entre testes
  (Object.keys(RATE_LIMITS) as Array<keyof typeof RATE_LIMITS>).forEach((type) => {
    resetRateLimit(ID, type);
  });
});

describe("checkRateLimit", () => {
  it("permite requisições abaixo do limite", () => {
    const resultado = checkRateLimit(ID, "login");
    expect(resultado.allowed).toBe(true);
    expect(resultado.remaining).toBe(RATE_LIMITS.login.max - 1);
  });

  it("bloqueia após exceder o limite de login (5 tentativas)", () => {
    for (let i = 0; i < RATE_LIMITS.login.max; i++) {
      checkRateLimit(ID, "login");
    }
    const ultima = checkRateLimit(ID, "login");
    expect(ultima.allowed).toBe(false);
    expect(ultima.remaining).toBe(0);
  });

  it("conta corretamente o número de requisições", () => {
    checkRateLimit(ID, "api");
    checkRateLimit(ID, "api");
    const terceira = checkRateLimit(ID, "api");
    expect(terceira.remaining).toBe(RATE_LIMITS.api.max - 3);
  });

  it("retorna resetAt no futuro", () => {
    const resultado = checkRateLimit(ID, "api");
    expect(resultado.resetAt).toBeGreaterThan(Date.now());
  });

  it("IDs diferentes não interferem entre si", () => {
    for (let i = 0; i < RATE_LIMITS.login.max; i++) {
      checkRateLimit(ID, "login");
    }
    // Outro ID não deve estar bloqueado
    const outroId = checkRateLimit("outro-usuario-99", "login");
    expect(outroId.allowed).toBe(true);
  });
});

describe("resetRateLimit", () => {
  it("reseta o contador e permite novas requisições", () => {
    for (let i = 0; i <= RATE_LIMITS.login.max; i++) {
      checkRateLimit(ID, "login");
    }
    resetRateLimit(ID, "login");
    const aposReset = checkRateLimit(ID, "login");
    expect(aposReset.allowed).toBe(true);
  });
});
