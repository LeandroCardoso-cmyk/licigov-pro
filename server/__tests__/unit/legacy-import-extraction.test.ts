/**
 * Importação assistida de legado: texto corrido numa linha só (o caso real colado de um PDF) não pode estourar as colunas
 * de `operation_records` — cada campo para no separador do trecho e respeita o limite da coluna.
 */
import { describe, it, expect } from "vitest";
import { createLegacyImportRecord, reconstructLegacyRecord } from "../../domain/operationRecord";

describe("importação assistida de legado — extração por trecho", () => {
  it("texto corrido com travessões: número, modalidade e objeto separados", () => {
    const f = reconstructLegacyRecord("Processo nº 12/2023 — Pregão Eletrônico — Objeto: manutenção predial preventiva e corretiva (homologação ABCDEFGH).");
    expect(f.number).toBe("12/2023");
    expect(f.modality).toBe("Eletrônico");
    expect(f.object).toBe("manutenção predial preventiva e corretiva (homologação ABCDEFGH).");
  });

  it("multilinha continua igual (primeira linha do campo)", () => {
    const f = reconstructLegacyRecord("Processo nº 45/2022\nModalidade: Pregão Eletrônico\nObjeto: aquisição de veículos");
    expect(f).toEqual({ number: "45/2022", modality: "Pregão Eletrônico", object: "aquisição de veículos" });
  });

  it("valores longos são limitados às colunas (nunca derrubam a gravação)", () => {
    const { record } = createLegacyImportRecord({ organizationId: 1, recordType: "processo_licitatorio_legado", correlationId: "c",
      rawText: `Processo nº ${"9".repeat(200)} Modalidade: ${"x".repeat(200)}` });
    expect(record.number.length).toBeLessThanOrEqual(80);
    expect(record.modality.length).toBeLessThanOrEqual(60);
  });
});
