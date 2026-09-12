/**
 * A3 — sanitizeFailureMessage: truncamento SEGURO (≤ coluna varchar(300)) + redação de segredos.
 *
 * Regressão A3 (LIVE): `slice(0,300)+"…"` produzia 301 caracteres → "Data too long for column
 * failure_message" no MySQL strict quando o provider retornava um erro longo (ex.: Gemini 400).
 * A elipse agora fica DENTRO do limite: slice(MAX-1)+"…" = MAX. Puro; sem DB.
 */
import { describe, it, expect } from "vitest";
import { sanitizeFailureMessage, MAX_FAILURE_MESSAGE_LENGTH } from "../../domain/cognitiveProvenance";

describe("sanitizeFailureMessage — limite de comprimento (≤ varchar(300))", () => {
  it("mensagem curta é preservada", () => {
    expect(sanitizeFailureMessage("boom")).toBe("boom");
  });

  it("exatamente 300 caracteres NÃO é truncada (sem elipse)", () => {
    const s = ".".repeat(MAX_FAILURE_MESSAGE_LENGTH);
    const out = sanitizeFailureMessage(s);
    expect(out.length).toBe(MAX_FAILURE_MESSAGE_LENGTH);
    expect(out.endsWith("…")).toBe(false);
  });

  it("301 caracteres é truncada para ≤ 300 COM a elipse dentro do limite", () => {
    const s = ".".repeat(MAX_FAILURE_MESSAGE_LENGTH + 1);
    const out = sanitizeFailureMessage(s);
    expect(out.length).toBe(MAX_FAILURE_MESSAGE_LENGTH);
    expect(out.endsWith("…")).toBe(true);
  });

  it("erro longo do provider (mimetiza Gemini 400) nunca excede a coluna", () => {
    const geminiLike =
      'GoogleGenerativeAIError: [400 Bad Request] Invalid JSON payload received. ' +
      'Unknown name "additionalProperties" at \'generation_config.response_schema\': Cannot find field. ' +
      'Unknown name "additionalProperties" at \'generation_config.response_schema.properties[0].value.items\'. '.repeat(6);
    const out = sanitizeFailureMessage(geminiLike);
    expect(out.length).toBeLessThanOrEqual(MAX_FAILURE_MESSAGE_LENGTH);
  });

  it("INVARIANTE: qualquer entrada → comprimento ≤ MAX", () => {
    for (const n of [0, 1, 50, 299, 300, 301, 1000, 5000]) {
      expect(sanitizeFailureMessage("palavra ".repeat(n)).length).toBeLessThanOrEqual(MAX_FAILURE_MESSAGE_LENGTH);
    }
  });

  it("segredos/URLs continuam redigidos mesmo em mensagens longas", () => {
    const raw =
      "Connection failed mysql://root:s3nh4Secreta@db.internal:3306/licigov api_key=AIzaSyDVERYLONGSECRETKEY1234567890abcd " +
      "token=abcdef0123456789abcdef0123456789abcdef";
    const out = sanitizeFailureMessage(raw);
    expect(out).not.toContain("mysql://");
    expect(out).not.toContain("s3nh4Secreta");
    expect(out).not.toContain("AIzaSyDVERYLONGSECRETKEY1234567890abcd");
    expect(out).toContain("[redacted");
    expect(out.length).toBeLessThanOrEqual(MAX_FAILURE_MESSAGE_LENGTH);
  });
});
