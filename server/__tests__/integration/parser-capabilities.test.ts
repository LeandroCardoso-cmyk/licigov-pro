/**
 * PR B.2.2 (correções) — Capacidade EXPLÍCITA dos parsers.
 *
 * O suporte público NÃO é inferido por convenção de versão ("-stub"): cada parser DECLARA
 * `capabilityStatus`. Este teste executável falha se um parser for registrado sem declarar a
 * capacidade corretamente, e fixa a matriz real (CSV/XLSX supported; PDF/DOCX stub).
 */
import { describe, it, expect } from "vitest";
import { parserRegistry } from "../../parsers/parserRegistry";

const VALID = new Set(["supported", "stub", "disabled"]);

describe("parserRegistry — capacidade declarada", () => {
  it("todo parser registrado declara capabilityStatus válido e supportsStructuredExtraction booleano", () => {
    const parsers = parserRegistry.list();
    expect(parsers.length).toBeGreaterThan(0);
    for (const p of parsers) {
      const c = p.capabilities;
      expect(VALID.has(c.capabilityStatus), `${p.parserType}: capabilityStatus inválido/ausente (${c.capabilityStatus})`).toBe(true);
      expect(typeof c.supportsStructuredExtraction, `${p.parserType}: supportsStructuredExtraction ausente`).toBe("boolean");
      // Coerência: só 'supported' extrai estrutura de fato.
      if (c.capabilityStatus === "supported") expect(c.supportsStructuredExtraction).toBe(true);
      if (c.capabilityStatus === "stub") expect(c.supportsStructuredExtraction).toBe(false);
    }
  });

  it("matriz real (B.2.3): CSV/XLSX/PDF/DOCX supported", () => {
    const byType = Object.fromEntries(parserRegistry.list().map(p => [p.parserType, p.capabilities.capabilityStatus]));
    expect(byType.csv).toBe("supported");
    expect(byType.xlsx).toBe("supported");
    expect(byType.pdf).toBe("supported");
    expect(byType.docx).toBe("supported");
  });
});
