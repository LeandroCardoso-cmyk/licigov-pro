import { describe, it, expect } from "vitest";
import { structuralDeviationStatus } from "../../domain/institutionalTemplates/revalidation";

const blocks = [
  { blockId: "b1", includedAnchor: "CLÁUSULA A", excludedAnchor: null },
  { blockId: "b2", includedAnchor: null, excludedAnchor: "CLÁUSULA X" },
];
describe("structuralDeviationStatus — única autoridade dos desvios (revalidação e leitura do estado de revisão)", () => {
  it("sem alteração ⇒ nenhum desvio", () => {
    expect(structuralDeviationStatus(blocks, "CLÁUSULA A\ntexto", "CLÁUSULA A\ntexto", [])).toEqual([]);
  });
  it("bloco incluído removido e bloco excluído inserido ⇒ desvios por blockId, sem reconhecimento", () => {
    expect(structuralDeviationStatus(blocks, "CLÁUSULA A\n", "texto livre CLÁUSULA X", [])).toEqual([
      { blockId: "b1", kind: "INCLUDED_BLOCK_REMOVED", acknowledgmentRef: null },
      { blockId: "b2", kind: "EXCLUDED_BLOCK_INSERTED", acknowledgmentRef: null },
    ]);
  });
  it("reconhecimento humano por blockId+kind (com referência) resolve só aquele desvio", () => {
    const out = structuralDeviationStatus(blocks, "CLÁUSULA A\n", "texto livre CLÁUSULA X", [{ blockId: "b1", kind: "INCLUDED_BLOCK_REMOVED", acknowledgmentRef: "dec-1" } as never]);
    expect(out.find((d) => d.blockId === "b1")?.acknowledgmentRef).toBe("dec-1");
    expect(out.find((d) => d.blockId === "b2")?.acknowledgmentRef).toBeNull();
  });
  it("âncora repetida: compara OCORRÊNCIAS (remover uma de duas é desvio)", () => {
    const b = [{ blockId: "r", includedAnchor: "TABELA", excludedAnchor: null }];
    expect(structuralDeviationStatus(b, "TABELA TABELA", "TABELA", [])).toHaveLength(1);
    expect(structuralDeviationStatus(b, "TABELA TABELA", "TABELA TABELA", [])).toHaveLength(0);
  });
});
