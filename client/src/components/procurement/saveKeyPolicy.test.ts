/**
 * C.4B.3A (Blocker 5) — política de rotação da idempotencyKey do save governado.
 * CONFLICT rotaciona (estado revisado expirou); erros transitórios mantêm a chave (retry idempotente).
 */
import { describe, it, expect } from "vitest";
import { shouldRotateSaveKeyOnError } from "./saveKeyPolicy";

describe("C.4B.3A — shouldRotateSaveKeyOnError", () => {
  it("CONFLICT → rotaciona (nova revisão, nova operação lógica)", () => {
    expect(shouldRotateSaveKeyOnError("CONFLICT")).toBe(true);
  });

  it("erros transitórios → NÃO rotaciona (retry seguro/idempotente com a mesma chave)", () => {
    expect(shouldRotateSaveKeyOnError("INTERNAL_SERVER_ERROR")).toBe(false);
    expect(shouldRotateSaveKeyOnError("TIMEOUT")).toBe(false);
    expect(shouldRotateSaveKeyOnError(undefined)).toBe(false);
    expect(shouldRotateSaveKeyOnError(null)).toBe(false);
    expect(shouldRotateSaveKeyOnError("BAD_REQUEST")).toBe(false);
  });
});
