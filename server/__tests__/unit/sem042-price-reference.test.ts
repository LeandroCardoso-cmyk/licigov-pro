/**
 * R9 / SEM-042 — linhagem do valor da justificativa de preço (domínio puro): o valor é CALCULADO a partir das cotações
 * (por item, método escolhido pela pessoa), a linhagem é verificável e nada é "confiança" inventada.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  summarizePriceResearch, proposalMatchesServerValue, buildResearchLineage, encodeLineage, splitLineage, isLineageToken,
  describeLineage, PRICE_LINEAGE_PREFIX, PRICE_RESEARCH_INCONSISTENT,
} from "../../domain/directPriceReference";

const q = (description: string, quantity: number | string, value: number | string, unit = "un") => ({ description, unit, quantity, value });

describe("SEM-042 — summarizePriceResearch (determinístico, por item)", () => {
  it("3 cotações do mesmo item: média / mediana / menor preço × quantidade (centavos)", () => {
    const r = summarizePriceResearch([q("Notebook", 2, 14000), q("notebook ", 2, 15000), q("Notebook", 2, 16500)]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary).toMatchObject({ quoteCount: 3, itemCount: 1, minQuotesPerItem: 3 });
    expect(r.summary.values).toEqual({ media: 30333.33, mediana: 30000, menor_preco: 28000 });
  });
  it("itens distintos somam por item (cada item usa a própria estatística)", () => {
    const r = summarizePriceResearch([q("Caneta", 100, 1.5), q("Caneta", 100, 2.5), q("Lápis", 50, 0.8)]);
    if (!r.ok) throw new Error("esperava ok");
    expect(r.summary.itemCount).toBe(2);
    expect(r.summary.minQuotesPerItem).toBe(1); // fato exposto — o sistema NÃO impõe mínimo legal
    expect(r.summary.values.media).toBe(240); // 100×2.00 + 50×0.80
    expect(r.summary.values.mediana).toBe(240);
    expect(r.summary.values.menor_preco).toBe(190); // 100×1.50 + 40
  });
  it("mediana com n par = média dos dois centrais", () => {
    const r = summarizePriceResearch([q("X", 1, 10), q("X", 1, 20), q("X", 1, 30), q("X", 1, 100)]);
    if (!r.ok) throw new Error("esperava ok");
    expect(r.summary.values.mediana).toBe(25);
  });
  it("é determinístico e independe da ordem das cotações", () => {
    const rows = [q("A", 3, 9.99), q("B", 1, 5), q("A", 3, 10.49), q("A", 3, 11)];
    expect(summarizePriceResearch(rows)).toEqual(summarizePriceResearch([...rows].reverse()));
  });
  it("quantidades divergentes para o mesmo item / valor inválido / vazio ⇒ recusa (nunca escolhe)", () => {
    for (const rows of [[q("X", 1, 10), q("X", 2, 10)], [q("X", 1, 0)], [q("X", 0, 5)], [q("X", 1, "abc")], []]) {
      const r = summarizePriceResearch(rows);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe(PRICE_RESEARCH_INCONSISTENT);
    }
  });
  it("proposta do cliente: tolerância de meio centavo", () => {
    expect(proposalMatchesServerValue(15000, 15000)).toBe(true);
    expect(proposalMatchesServerValue(15000.004, 15000)).toBe(true);
    expect(proposalMatchesServerValue(15000.01, 15000)).toBe(false);
  });
});

describe("SEM-042 — linhagem codificada nas referências (token reservado, só emitido pelo servidor)", () => {
  const summary = (() => { const r = summarizePriceResearch([q("X", 1, 10), q("X", 1, 30)]); if (!r.ok) throw new Error("x"); return r.summary; })();
  const lineage = buildResearchLineage({ researchId: "abc123", contentHash: "f".repeat(64), importedAt: "2026-10-01T10:00:00.000Z", importSource: "colar", summary, method: "media", proposedValue: null });

  it("a linhagem registra pesquisa, hash, versão do hash, nº de cotações, método e o valor CALCULADO", () => {
    expect(lineage).toMatchObject({ kind: "pesquisa", researchId: "abc123", contentHash: "f".repeat(64), hashVersion: "dpi-content-v1", quoteCount: 2, method: "media", computedValue: 20, proposedValue: null });
  });
  it("encode/split: ida e volta; referências comuns preservadas; token malformado não vira linhagem", () => {
    const refs = [encodeLineage(lineage), "Proposta 12/2026", `${PRICE_LINEAGE_PREFIX}{quebrado`];
    const { lineage: got, references } = splitLineage(refs);
    expect(got).toEqual(lineage);
    expect(references).toEqual(["Proposta 12/2026"]);
    expect(isLineageToken(refs[0])).toBe(true);
    expect(isLineageToken("Proposta 12/2026")).toBe(false);
    expect(splitLineage([`${PRICE_LINEAGE_PREFIX}{"kind":"outro"}`]).lineage).toBeNull();
  });
  it("a descrição é FACTUAL: sem 'confiança' nem 'baseado na pesquisa' fixos", () => {
    const text = describeLineage(lineage);
    expect(text).toContain("abc123");
    expect(text).toContain("ffffffffffff");
    expect(text).toContain("método: média");
    expect(text).toContain("R$ 20.00");
    expect(text).not.toMatch(/confian|Baseado na Pesquisa/i);
    expect(describeLineage({ kind: "declarado", declaredValue: 10, declaredByUserId: 3 })).toMatch(/sem pesquisa de preços vinculada/);
  });
});

describe("SEM-042 — guards estáticos: o boilerplate fabricado não volta", () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, "../../..", rel), "utf8");
  it("o serviço não contém 'Baseado na Pesquisa' nem confiança fixa 0.85", () => {
    // só CÓDIGO (os comentários explicam o que foi removido)
    const svc = read("server/services/directProcurementService.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(svc).not.toMatch(/Baseado na Pesquisa/);
    expect(svc).not.toMatch(/confidence:\s*params\.source/);
    expect(svc).not.toMatch(/0\.85/);
  });
  it("a tela não monta o valor a partir do cliente quando a fonte é pesquisa (envia o valor calculado pelo servidor)", () => {
    const ui = read("client/src/components/direct-procurement/PriceJustificationWorkspace.tsx");
    expect(ui).toContain("calculado pelo sistema");
    expect(ui).toContain("priceResearches");
    expect(ui).not.toMatch(/researchId:\s*researchId\s*\|\|\s*current\?\.researchId/);
  });
  it("a tela de necessidade não afirma sucesso (sem mutation e sem 'registrada')", () => {
    const ui = read("client/src/components/direct-procurement/NeedCharacterizationWorkspace.tsx").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(ui).not.toMatch(/useMutation|characterizeNeed|isSuccess|Necessidade registrada/);
  });
});
