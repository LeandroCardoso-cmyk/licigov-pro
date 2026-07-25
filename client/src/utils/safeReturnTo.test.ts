/**
 * PR A.1 — utils/safeReturnTo.ts (proteção contra open redirect no returnTo pós-login).
 */

import { describe, it, expect } from "vitest";
import { isSafeReturnTo } from "./safeReturnTo";

describe("safeReturnTo · isSafeReturnTo", () => {
  it("aceita caminhos relativos começando com uma barra", () => {
    expect(isSafeReturnTo("/dashboard")).toBe(true);
    expect(isSafeReturnTo("/convite?token=abc123")).toBe(true);
  });

  it("rejeita null/undefined/vazio", () => {
    expect(isSafeReturnTo(null)).toBe(false);
    expect(isSafeReturnTo(undefined)).toBe(false);
    expect(isSafeReturnTo("")).toBe(false);
  });

  it("rejeita URLs absolutas (não começam com /)", () => {
    expect(isSafeReturnTo("https://evil.com")).toBe(false);
    expect(isSafeReturnTo("evil.com")).toBe(false);
    expect(isSafeReturnTo("javascript:alert(1)")).toBe(false);
  });

  it("rejeita protocol-relative (//host) — escaparia do domínio atual", () => {
    expect(isSafeReturnTo("//evil.com")).toBe(false);
    expect(isSafeReturnTo("///evil.com")).toBe(false);
  });

  it("rejeita barra invertida (alguns navegadores tratam /\\ como //)", () => {
    expect(isSafeReturnTo("/\\evil.com")).toBe(false);
  });
});
