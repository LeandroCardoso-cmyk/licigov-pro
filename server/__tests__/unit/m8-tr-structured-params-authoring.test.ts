/**
 * M8 pós-homologação (LICIGOV-FAST "uma informação, um preenchimento") — os parâmetros estruturados do TR CONFIRMADOS no processo
 * entram na autoria ANTES da cognição. Defeito observado em staging: com 22 parâmetros confirmados (ex.: vigência de 12 meses), o TR
 * saiu com "[REVISAR: prazo de vigência contratual…]" porque o bloco só era anexado DEPOIS da IA. Provider mockado (seam `invoke`).
 */
import { describe, it, expect } from "vitest";
import { buildDocumentAuthoringContext, type DocumentAuthoringInputs } from "../../services/authoring/authoringContext";
import { generateStructuredAuthoring, buildMockProviderAuthoring, type TrConfirmedParams } from "../../services/authoring/structuredAuthoringService";

const ctxInput = (over: Partial<DocumentAuthoringInputs> = {}): DocumentAuthoringInputs => ({
  organizationId: 2, processId: "p-m8", kind: "tr", object: "[HOMOLOGAÇÃO SINTÉTICA] Aquisição de material de expediente",
  processObject: "[HOMOLOGAÇÃO SINTÉTICA] Aquisição de material de expediente", processNumber: "1461/2026",
  dfd: { present: true, status: "rascunho", contentHash: "dfd-h", content: "DFD: a Secretaria Fictícia precisa de material de expediente.", origin: "generated" },
  etp: { present: true, status: "rascunho", contentHash: "etp-h", content: "ETP: aquisição em parcela única.", origin: "generated" },
  approvedItems: [{
    id: "i1", description: "Papel sulfite A4", quantity: 200, unit: "RESMA", averagePriceCents: 2550, quoteCount: 3,
    confirmedCatalogCode: null, suggestedCatalogCode: null, sourceState: "current", quotes: [],
  }],
  pendingItemCount: 0,
  ...over,
});

const PARAMS: TrConfirmedParams = {
  block: "PARÂMETROS ESTRUTURADOS DA CONTRATAÇÃO (confirmados neste processo; o Edital usa os mesmos dados)\n\n"
    + "- Vigência contratual: 12 mês(es)\n- Local de execução/entrega: Almoxarifado central da Prefeitura Sintética\n- Prazo de pagamento: 30 dia(s)",
  digest: "a".repeat(64),
  pending: ["Instrumento substitutivo do contrato"],
  conflicting: [],
};

async function promptFor(kind: "etp" | "tr", confirmedParams?: TrConfirmedParams | null): Promise<{ prompt: string; content: string }> {
  let prompt = "";
  const r = await generateStructuredAuthoring({
    organizationId: 2, kind, object: "[HOMOLOGAÇÃO SINTÉTICA] Aquisição de material de expediente", correlationId: `m8-${kind}`,
    sourceContext: buildDocumentAuthoringContext(ctxInput({ kind })), confirmedParams,
    invoke: async (p) => { prompt = p; return buildMockProviderAuthoring(kind); },
  });
  return { prompt, content: r.content };
}

describe("M8 — parâmetros confirmados do TR na entrada efetiva da autoria", () => {
  it("o prompt do TR contém os valores confirmados e proíbe pedi-los de novo (antes: ausentes da cognição)", async () => {
    const { prompt } = await promptFor("tr", PARAMS);
    expect(prompt).toContain("=== PARÂMETROS DA CONTRATAÇÃO CONFIRMADOS NESTE PROCESSO");
    expect(prompt).toContain("- Vigência contratual: 12 mês(es)");
    expect(prompt).toContain("- Local de execução/entrega: Almoxarifado central da Prefeitura Sintética");
    expect(prompt).toContain("NÃO escreva '[REVISAR]' pedindo informação que consta destes parâmetros");
    expect(prompt).toContain("Onde o contexto e os parâmetros confirmados NÃO fornecerem a informação");
    // os parâmetros vêm DEPOIS do contexto do processo (o contexto continua presente)
    expect(prompt.indexOf("=== CONTEXTO DO PROCESSO")).toBeGreaterThan(-1);
    expect(prompt.indexOf("=== PARÂMETROS DA CONTRATAÇÃO")).toBeGreaterThan(prompt.indexOf("=== CONTEXTO DO PROCESSO"));
  });

  it("parâmetro pendente continua pendente: a IA é instruída a manter [REVISAR] e não presumir", async () => {
    const { prompt } = await promptFor("tr", PARAMS);
    expect(prompt).toContain("Parâmetros ainda NÃO confirmados (mantenha '[REVISAR: <parâmetro>]' onde forem necessários; não presuma): Instrumento substitutivo do contrato.");
  });

  it("divergência de fontes: parâmetro em conflito entra só como rótulo (sem valor) e a divergência com DFD/ETP vai para a revisão humana", async () => {
    const { prompt } = await promptFor("tr", { ...PARAMS, conflicting: ["Índice de reajuste"] });
    expect(prompt).toContain("Parâmetros com registro divergente ou inválido (NÃO use valor; marque '[REVISAR: conflito em <parâmetro>]'): Índice de reajuste.");
    expect(prompt).toContain("Se o DFD ou o ETP divergirem de um parâmetro confirmado, use o parâmetro no TR e registre a divergência em 'limitations'");
  });

  it("sem parâmetros confirmados o prompt do TR é exatamente o anterior (null ≡ ausente; frase original preservada)", async () => {
    const absent = await promptFor("tr");
    const nulled = await promptFor("tr", null);
    expect(nulled.prompt).toBe(absent.prompt);
    expect(absent.prompt).not.toContain("PARÂMETROS DA CONTRATAÇÃO CONFIRMADOS");
    expect(absent.prompt).toContain("Onde o contexto NÃO fornecer a informação, escreva '[REVISAR: <o que falta>]'");
  });

  it("ETP e demais tipos nunca recebem os parâmetros do TR (não regressão)", async () => {
    const withParams = await promptFor("etp", PARAMS);
    const without = await promptFor("etp");
    expect(withParams.prompt).toBe(without.prompt);
    expect(withParams.prompt).not.toContain("PARÂMETROS DA CONTRATAÇÃO CONFIRMADOS");
  });

  it("a autoria não cola o bloco no texto (o serviço anexa o bloco determinístico uma única vez)", async () => {
    const { content } = await promptFor("tr", PARAMS);
    expect(content).not.toContain("PARÂMETROS ESTRUTURADOS DA CONTRATAÇÃO");
  });

  it("o contexto de autoria (e seu digest de fontes) não depende dos parâmetros — rascunhos existentes não viram 'fonte alterada'", () => {
    const a = buildDocumentAuthoringContext(ctxInput());
    const b = buildDocumentAuthoringContext(ctxInput());
    expect(a.sourcesDigest).toBe(b.sourcesDigest);
  });
});
