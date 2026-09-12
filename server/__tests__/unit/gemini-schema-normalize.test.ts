/**
 * A3 — Normalizador de response_schema para o Gemini (boundary do provider). Puro, sem SDK.
 *
 * Prova que `additionalProperties` é removido em qualquer profundidade (raiz/objeto/array/aninhado),
 * que o schema ORIGINAL é imutável, que os campos suportados permanecem, e que os response schemas
 * REAIS da A3 (CATMAT / LEGAL / DIRECT PROCUREMENT) passam pela normalização sem `additionalProperties`.
 */
import { describe, it, expect } from "vitest";
import { normalizeGeminiResponseSchema } from "../../_core/ai/geminiSchema";
import { CATMAT_RESPONSE_SCHEMA } from "../../services/catmatMatcher";
import { LEGAL_OPINION_SCHEMA } from "../../services/legalOpinionService";
import { LEGAL_ARTICLE_SCHEMA } from "../../services/legalFrameworkAssistant";

/** true se `additionalProperties` aparece em QUALQUER profundidade. */
function hasAdditionalProperties(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasAdditionalProperties);
  if (node !== null && typeof node === "object") {
    return Object.entries(node as Record<string, unknown>).some(
      ([k, v]) => k === "additionalProperties" || hasAdditionalProperties(v),
    );
  }
  return false;
}

describe("normalizeGeminiResponseSchema — remoção de additionalProperties", () => {
  it("A. remove additionalProperties da RAIZ", () => {
    const out = normalizeGeminiResponseSchema({ type: "object", properties: {}, additionalProperties: false });
    expect(hasAdditionalProperties(out)).toBe(false);
    expect((out as Record<string, unknown>).type).toBe("object");
  });

  it("B. remove additionalProperties de OBJETO ANINHADO", () => {
    const out = normalizeGeminiResponseSchema({
      type: "object",
      properties: { inner: { type: "object", properties: {}, additionalProperties: false } },
      additionalProperties: false,
    });
    expect(hasAdditionalProperties(out)).toBe(false);
  });

  it("C. remove additionalProperties de OBJETO dentro de ARRAY (items)", () => {
    const out = normalizeGeminiResponseSchema({
      type: "object",
      properties: {
        list: { type: "array", items: { type: "object", properties: {}, additionalProperties: false } },
      },
      additionalProperties: false,
    });
    expect(hasAdditionalProperties(out)).toBe(false);
  });

  it("D. remove em MÚLTIPLOS níveis de profundidade", () => {
    const out = normalizeGeminiResponseSchema({
      type: "object",
      additionalProperties: false,
      properties: {
        a: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: { b: { type: "object", additionalProperties: false, properties: {} } },
          },
        },
      },
    });
    expect(hasAdditionalProperties(out)).toBe(false);
  });

  it("E. o schema ORIGINAL permanece imutável", () => {
    const original = { type: "object", properties: { x: { type: "string" } }, additionalProperties: false } as const;
    const snapshot = JSON.stringify(original);
    normalizeGeminiResponseSchema(original);
    expect(JSON.stringify(original)).toBe(snapshot);
    expect((original as { additionalProperties: boolean }).additionalProperties).toBe(false);
  });

  it("F. campos SUPORTADOS permanecem intactos (type, properties, required, items, enum, description)", () => {
    const input = {
      type: "object",
      description: "raiz",
      required: ["code", "kind"],
      properties: {
        code: { type: "string", description: "código" },
        kind: { type: "string", enum: ["dispensa", "inexigibilidade"] },
        arr: { type: "array", items: { type: "integer" } },
      },
      additionalProperties: false,
    };
    const out = normalizeGeminiResponseSchema(input) as Record<string, unknown>;
    expect(out.type).toBe("object");
    expect(out.description).toBe("raiz");
    expect(out.required).toEqual(["code", "kind"]);
    const props = out.properties as Record<string, Record<string, unknown>>;
    expect(props.code.description).toBe("código");
    expect(props.kind.enum).toEqual(["dispensa", "inexigibilidade"]);
    expect((props.arr.items as Record<string, unknown>).type).toBe("integer");
    expect(hasAdditionalProperties(out)).toBe(false);
  });

  it("G. CATMAT response schema normaliza sem additionalProperties (original tinha)", () => {
    expect(hasAdditionalProperties(CATMAT_RESPONSE_SCHEMA.schema)).toBe(true);
    expect(hasAdditionalProperties(normalizeGeminiResponseSchema(CATMAT_RESPONSE_SCHEMA.schema))).toBe(false);
  });

  it("H. LEGAL response schema normaliza sem additionalProperties", () => {
    expect(hasAdditionalProperties(normalizeGeminiResponseSchema(LEGAL_OPINION_SCHEMA.schema))).toBe(false);
  });

  it("I. DIRECT PROCUREMENT response schema normaliza sem additionalProperties (original tinha)", () => {
    expect(hasAdditionalProperties(LEGAL_ARTICLE_SCHEMA.schema)).toBe(true);
    expect(hasAdditionalProperties(normalizeGeminiResponseSchema(LEGAL_ARTICLE_SCHEMA.schema))).toBe(false);
  });
});
