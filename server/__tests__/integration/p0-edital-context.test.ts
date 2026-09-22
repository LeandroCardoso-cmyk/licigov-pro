/**
 * P0 EDITAL — Context Builder (UNITÁRIO, puro, sem DB/rede).
 *
 * Prova o REAPROVEITAMENTO estruturado de DFD/ETP/TR/itens/parâmetros na montagem do contexto do Edital,
 * a regra de fonte ausente (`[REVISAR]`, sem alucinação) e o digest determinístico (replay + stale).
 */
import { describe, it, expect } from "vitest";
import { buildEditalSourceContext, type EditalSourceInputs } from "../../services/authoring/editalContext";

const base = (over: Partial<EditalSourceInputs> = {}): EditalSourceInputs => ({
  organizationId: 1,
  processId: "proc-1",
  object: "Aquisição de material de escritório",
  modality: "pregao",
  form: "eletronico",
  platform: "compras_gov",
  processObject: "Aquisição de material de escritório",
  processNumber: "2026/0001",
  currentStage: "NOTICE",
  dfd: { present: true, status: "aprovado", contentHash: "dfd-h", content: "DFD: necessidade de material de expediente." },
  etp: { present: true, status: "aprovado", contentHash: "etp-h", content: "ETP: solução escolhida é registro de preços." },
  tr: { present: true, status: "aprovado", contentHash: "tr-h", content: "TR: objeto detalhado; prazo de execução: 15 dias; obrigações da contratada." },
  // P0 piloto — CONTRATO MONETÁRIO: `averagePrice` é REAIS (DECIMAL(14,2) de intelligent_items), não centavos.
  // As fixtures antigas usavam 2550 assumindo centavos, o que casava com o bug `/100` do builder (R$ 25,50 real
  // era exibido como R$ 0,26). Contrato superado → fixtures em reais.
  approvedItems: [
    { id: "i1", description: "Papel A4", quantity: 100, unit: "resma", averagePrice: 25.5, suggestedCATMAT: "12345" },
  ],
  criterioJulgamento: null,
  regimeContratacao: null,
  ...over,
});

describe("P0 — buildEditalSourceContext (reuso estruturado)", () => {
  it("Cenário A — DFD + ETP + TR presentes: o contexto contém os três e os itens", () => {
    const ctx = buildEditalSourceContext(base());
    expect(ctx.promptContext).toContain("DFD: necessidade");
    expect(ctx.promptContext).toContain("ETP: solução escolhida");
    expect(ctx.promptContext).toContain("TR: objeto detalhado");
    expect(ctx.promptContext).toContain("Papel A4");
    expect(ctx.usedSources).toEqual(expect.arrayContaining(["dfd", "etp", "tr", "itens"]));
    // DFD/ETP/TR/itens presentes NÃO entram em `missing` (critério/regime não existem no espaço canônico).
    expect(ctx.missing).not.toContain("dfd");
    expect(ctx.missing).not.toContain("etp");
    expect(ctx.missing).not.toContain("tr");
    expect(ctx.missing).not.toContain("itens");
  });

  it("Cenário B — prazo do TR (15 dias) é reaproveitado no contexto de geração", () => {
    const ctx = buildEditalSourceContext(base());
    expect(ctx.promptContext).toContain("15 dias");
  });

  it("fonte ausente vira [REVISAR] explícito (nunca inventa) e entra em `missing`", () => {
    const ctx = buildEditalSourceContext(base({ tr: null, approvedItems: [] }));
    expect(ctx.promptContext).toContain("[REVISAR:");
    expect(ctx.missing).toEqual(expect.arrayContaining(["tr", "itens", "criterio_julgamento", "regime_contratacao"]));
    expect(ctx.usedSources).not.toContain("tr");
  });

  it("digest é determinístico e SENSÍVEL a mudança de fonte (base para replay + SOURCE_CHANGED)", () => {
    const a = buildEditalSourceContext(base()).sourcesDigest;
    const b = buildEditalSourceContext(base()).sourcesDigest;
    expect(a).toBe(b);
    // Alterar o hash de conteúdo do TR muda o digest (documento-base alterado).
    const trChanged = buildEditalSourceContext(base({ tr: { present: true, status: "aprovado", contentHash: "tr-h-2", content: "novo" } })).sourcesDigest;
    expect(trChanged).not.toBe(a);
    // Alterar parâmetro (modalidade) também muda.
    expect(buildEditalSourceContext(base({ modality: "concorrencia" })).sourcesDigest).not.toBe(a);
    // Alterar um item aprovado muda.
    expect(buildEditalSourceContext(base({ approvedItems: [{ id: "i1", description: "Papel A4 90g", quantity: 100, unit: "resma", averagePrice: 25.5, suggestedCATMAT: "12345" }] })).sourcesDigest).not.toBe(a);
  });

  it("digest independe da ORDEM dos itens (assinatura ordenada internamente)", () => {
    const items = [
      { id: "i1", description: "Papel A4", quantity: 100, unit: "resma", averagePrice: 25.5, suggestedCATMAT: "12345" },
      { id: "i2", description: "Caneta", quantity: 50, unit: "un", averagePrice: 1.2, suggestedCATMAT: null },
    ];
    const a = buildEditalSourceContext(base({ approvedItems: items })).sourcesDigest;
    const b = buildEditalSourceContext(base({ approvedItems: [...items].reverse() })).sourcesDigest;
    expect(a).toBe(b);
  });

  it("precedência do objeto: usa o objeto informado; cai para o objeto do processo quando vazio", () => {
    const ctx = buildEditalSourceContext(base({ object: "", processObject: "Objeto do processo" }));
    expect(ctx.promptContext).toContain("Objeto do processo");
    expect(ctx.missing).not.toContain("objeto");
    const empty = buildEditalSourceContext(base({ object: "", processObject: null }));
    expect(empty.missing).toContain("objeto");
  });

  it("lineage markers incluem digest, versões das fontes e contagem de itens", () => {
    const ctx = buildEditalSourceContext(base());
    expect(ctx.lineageMarkers.some((m) => m.startsWith("srcdigest:"))).toBe(true);
    expect(ctx.lineageMarkers.some((m) => m.startsWith("base:tr@"))).toBe(true);
    expect(ctx.lineageMarkers).toContain("itens:1");
  });

  it("P0 piloto — valor médio em REAIS (regressão do /100): R$ 25,50 × 100 = R$ 2.550,00 no quadro autoritativo", () => {
    const ctx = buildEditalSourceContext(base());
    expect(ctx.promptContext).toContain("R$ 25,50");
    expect(ctx.promptContext).not.toContain("R$ 0,26");
    expect(ctx.authoritativeBlock).toContain("| 1 | Papel A4 | 100 | resma | 25,50 | 2.550,00 |");
    expect(ctx.authoritativeBlock).toContain("**Valor estimado global:** R$ 2.550,00");
  });

  it("P0 piloto — sugestão de CATMAT NÃO aparece como código oficial; confirmação humana sim", () => {
    const sugg = buildEditalSourceContext(base());
    expect(sugg.promptContext).not.toContain("CATMAT/CATSER: 12345");
    expect(sugg.promptContext).toContain("a revisar (sugestão não confirmada)");
    const conf = buildEditalSourceContext(base({ approvedItems: [{ id: "i1", description: "Papel A4", quantity: 100, unit: "resma", averagePrice: 25.5, suggestedCATMAT: "12345", confirmedCatalogCode: "12345" }] }));
    expect(conf.promptContext).toContain("CATMAT/CATSER: 12345");
    expect(conf.sourcesDigest).not.toBe(sugg.sourcesDigest);
  });
});
