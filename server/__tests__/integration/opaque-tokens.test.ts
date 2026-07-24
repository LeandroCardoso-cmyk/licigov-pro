/**
 * PR A.1 — services/security/opaqueTokens.ts (token opaco de convite/redefinição de senha).
 */

import { describe, it, expect } from "vitest";
import { generateOpaqueToken, hashOpaqueToken, isPlausibleOpaqueToken } from "../../services/security/opaqueTokens";

describe("opaqueTokens · generateOpaqueToken", () => {
  it("gera um token base64url plausível (sem +, /, = — apenas [A-Za-z0-9_-])", () => {
    const token = generateOpaqueToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(40); // 32 bytes → 43 chars em base64url sem padding
  });

  it("cada chamada gera um token diferente (256 bits de entropia — colisão praticamente impossível)", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateOpaqueToken()));
    expect(tokens.size).toBe(100);
  });
});

describe("opaqueTokens · hashOpaqueToken", () => {
  it("determinístico: o mesmo token sempre produz o mesmo hash", () => {
    const token = generateOpaqueToken();
    expect(hashOpaqueToken(token)).toBe(hashOpaqueToken(token));
  });

  it("hash SHA-256 em hex: 64 caracteres [0-9a-f]", () => {
    const hash = hashOpaqueToken(generateOpaqueToken());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("tokens diferentes produzem hashes diferentes", () => {
    const a = hashOpaqueToken(generateOpaqueToken());
    const b = hashOpaqueToken(generateOpaqueToken());
    expect(a).not.toBe(b);
  });

  it("o hash NUNCA é igual ao token em claro (nunca persistir o token, só o hash)", () => {
    const token = generateOpaqueToken();
    expect(hashOpaqueToken(token)).not.toBe(token);
  });
});

describe("opaqueTokens · isPlausibleOpaqueToken", () => {
  it("aceita um token gerado pela própria função", () => {
    expect(isPlausibleOpaqueToken(generateOpaqueToken())).toBe(true);
  });
  it("rejeita entradas obviamente inválidas sem tocar o banco", () => {
    expect(isPlausibleOpaqueToken("")).toBe(false);
    expect(isPlausibleOpaqueToken("curto")).toBe(false);
    expect(isPlausibleOpaqueToken("tem espaço no meio 1234567890123456789012345")).toBe(false);
    expect(isPlausibleOpaqueToken("{\"a\":1}")).toBe(false);
    expect(isPlausibleOpaqueToken(null)).toBe(false);
    expect(isPlausibleOpaqueToken(undefined)).toBe(false);
    expect(isPlausibleOpaqueToken(12345)).toBe(false);
  });
});
