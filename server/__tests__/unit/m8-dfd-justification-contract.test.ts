/**
 * M8-AI-DFD-001 — contrato de saída da IA da justificativa do DFD (homologação real: "Pontuação de confiança: 0.85" e
 * "Fatos utilizados: 1, 3" chegaram ao documento, com os números convertidos em [REVISAR: …]).
 */
import { describe, expect, it } from "vitest";
import { interpretJustificationOutput, DFD_JUSTIFICATION_RESPONSE_SCHEMA } from "../../domain/dfdJustificationContract";
import { buildJustificationPrompt, generateDFDJustificationText, justificationFacts } from "../../services/authoring/dfdJustificationAuthoring";
import { resolveCanonicalContext } from "../../domain/canonicalProcurementContext";
import { MockAIProvider } from "../../_core/ai/mockProvider";

const P1 = "A Secretaria Municipal de Administração necessita de computadores desktop para substituir equipamentos obsoletos que comprometem o atendimento ao público.";
const P2 = "A aquisição assegura a continuidade dos serviços administrativos e a segurança das informações tratadas pela unidade [REVISAR: descrever o impacto da indisponibilidade].";

const ctx = resolveCanonicalContext({
  organizationId: 2, processId: "p1",
  process: { number: "2026/0002", object: "Aquisição de 10 computadores desktop completos", responsibleUserId: 3, createdAt: "2026-10-01T00:00:00.000Z" },
  organization: { name: "Prefeitura Sintética — Homologação", municipio: "Sintética", uf: "PR" },
  assertions: [], intelligentItems: [], procurementItems: [], priceLinks: [],
});

describe("M8-AI-DFD-001 — contrato estruturado", () => {
  it("separa conteúdo documental, lacunas e avisos; o documento recebe SÓ os parágrafos", () => {
    const r = interpretJustificationOutput(JSON.stringify({ paragrafos: [P1, P2], lacunas: ["impacto da indisponibilidade"], avisos: ["Confirmar o alinhamento com o PCA."] }));
    expect(r.contract).toBe("structured");
    expect(r.accepted).toBe(true);
    expect(r.paragraphs).toEqual([P1, P2]);
    expect(r.gaps).toEqual(["impacto da indisponibilidade", "descrever o impacto da indisponibilidade"]);
    expect(r.warnings).toEqual(["Confirmar o alinhamento com o PCA."]);
    expect(r.discarded).toEqual([]);
  });

  it("parágrafo estruturado com autoavaliação/lista de fatos/metadado é descartado (com motivo) — nunca recortado", () => {
    const r = interpretJustificationOutput(JSON.stringify({
      paragrafos: [P1, "Pontuação de confiança: 0.85", "Fatos utilizados: 1, 3", "Este texto foi gerado com base nos fatos fornecidos.", P1],
      lacunas: [], avisos: [], confianca: 0.85,
    }));
    expect(r.paragraphs).toEqual([P1]);
    expect(r.discarded.map((d) => d.reason).sort()).toEqual(["autoavaliacao", "campo_fora_do_contrato", "duplicado", "lista_de_fatos", "metadado_de_geracao"]);
  });

  it("SAÍDA FORA DO CONTRATO (texto livre contaminado, como na homologação) ⇒ só prosa documental; lacunas/avisos separados", () => {
    const raw = [
      "## 2. JUSTIFICATIVA DA NECESSIDADE", "",
      P1, "",
      P2, "",
      "Pontuação de confiança: 0.85",
      "Fatos utilizados: 1, 3", "",
      "Lacunas:", "- prazo de entrega desejado", "- local de instalação", "",
      "Observações: o texto deve ser revisado pelo setor jurídico.",
    ].join("\n");
    const r = interpretJustificationOutput(raw);
    expect(r.contract).toBe("text-fallback");
    expect(r.paragraphs).toEqual([P1, P2]);
    expect(r.gaps).toEqual(["prazo de entrega desejado", "local de instalação", "descrever o impacto da indisponibilidade"]);
    expect(r.warnings).toEqual(["o texto deve ser revisado pelo setor jurídico."]);
    expect(r.discarded.map((d) => d.reason)).toEqual(expect.arrayContaining(["titulo_de_secao", "autoavaliacao", "lista_de_fatos"]));
  });

  it("nada documental ⇒ não aceito (fallback seguro: sem sugestão)", () => {
    expect(interpretJustificationOutput("Pontuação de confiança: 0.85\nFatos utilizados: 1, 3").accepted).toBe(false);
    expect(interpretJustificationOutput("").accepted).toBe(false);
    expect(interpretJustificationOutput("{\"paragrafos\": [\"ok\"]").accepted).toBe(false); // JSON quebrado e curto
    expect(interpretJustificationOutput("mock:abc123").accepted).toBe(false);
  });

  it("limita a 4 parágrafos (excedente descartado com motivo) e reúne linhas quebradas da mesma frase", () => {
    const many = interpretJustificationOutput(JSON.stringify({ paragrafos: [1, 2, 3, 4, 5].map((n) => `${P1.slice(0, -1)} — parte ${"abcde"[n - 1]}.`), lacunas: [], avisos: [] }));
    expect(many.paragraphs).toHaveLength(4);
    expect(many.discarded.map((d) => d.reason)).toEqual(["excede_limite"]);
    const wrapped = interpretJustificationOutput("A Secretaria necessita de computadores para\nsubstituir equipamentos obsoletos do atendimento ao público.");
    expect(wrapped.paragraphs).toEqual(["A Secretaria necessita de computadores para substituir equipamentos obsoletos do atendimento ao público."]);
  });

  it("prompt e schema pedem a separação; prompt versão 2", () => {
    const prompt = buildJustificationPrompt(justificationFacts(ctx));
    expect(prompt).toContain("\"paragrafos\"");
    expect(prompt).toContain("Nunca coloque nos parágrafos: pontuação ou grau de confiança");
    expect(DFD_JUSTIFICATION_RESPONSE_SCHEMA.schema.required).toEqual(["paragrafos", "lacunas", "avisos"]);
    expect(DFD_JUSTIFICATION_RESPONSE_SCHEMA.schema.additionalProperties).toBe(false);
  });
});

describe("M8-AI-DFD-001 — geração ponta a ponta (seam)", () => {
  const gen = (raw: string) => generateDFDJustificationText({ organizationId: 2, processId: "p1", ctx, correlationId: "c", actorUserId: 3, idempotencyKey: "k", invoke: async () => raw });

  it("números de METADADOS (0.85; 1, 3) nunca viram [REVISAR] no documento; números no texto documental continuam guardados", async () => {
    const r = await gen(`${P1}\n\nSão necessárias 25 unidades adicionais para o setor de protocolo e atendimento.\n\nPontuação de confiança: 0.85\nFatos utilizados: 1, 3`);
    expect(r.text).not.toMatch(/0[.,]85|confian|Fatos utilizados/i);
    expect(r.text).toContain("[REVISAR: 25]");
    expect(r.unverifiedNumbers).toEqual(["25"]);
    expect(r.outputContract).toBe("text-fallback");
    expect(r.discardedReasons).toEqual(expect.arrayContaining(["autoavaliacao", "lista_de_fatos"]));
    expect(r.promptVersion).toBe("dfd-justificativa/2");
  });

  it("contrato estruturado: texto = parágrafos unidos; lacunas/avisos devolvidos à parte", async () => {
    const r = await gen(JSON.stringify({ paragrafos: [P1, P2], lacunas: ["prazo"], avisos: ["revisar PCA"] }));
    expect(r.text).toBe(`${P1}\n\n${P2}`);
    expect(r.gaps).toContain("prazo");
    expect(r.warnings).toEqual(["revisar PCA"]);
    expect(r.outputContract).toBe("structured");
  });

  it("título de seção na saída não duplica o cabeçalho no DFD", async () => {
    const r = await gen(`JUSTIFICATIVA DA NECESSIDADE DA CONTRATAÇÃO\n\n${P1}`);
    expect(r.text).toBe(P1);
  });

  it("provider de teste (mock) responde no contrato quando o schema é pedido", async () => {
    const out = await new MockAIProvider().generate({ messages: [{ role: "user", content: "x" }], responseSchema: DFD_JUSTIFICATION_RESPONSE_SCHEMA as never });
    const r = interpretJustificationOutput(out.text);
    expect(r.contract).toBe("structured");
    expect(r.accepted).toBe(true);
    expect(r.paragraphs.join(" ")).not.toMatch(/(?<![\p{L}\d])\d/u); // sem números soltos que virariam [REVISAR]
  });
});

describe("M8-AI-DFD-001 — inserção sem duplicação", () => {
  it("título colado no texto aceito não duplica o cabeçalho da seção 2 nem abre seção falsa", async () => {
    const { justificationBody, applyReviewedJustification } = await import("../../domain/dfdPrefill");
    expect(justificationBody(`## 2. JUSTIFICATIVA DA NECESSIDADE\nJustificativa da necessidade da contratação\n${P1}`)).toEqual([P1]);
    expect(justificationBody(P1)).toEqual([P1]);
    const doc = "# DFD\n\n## 1. Objeto\nX\n\n## 2. Justificativa da necessidade\n[preencher]\n\n## 3. Quantidades\nY";
    const out = applyReviewedJustification(doc, [], `## 2. Justificativa da necessidade\n${P1}`, null).content;
    expect(out.match(/## 2\./g)).toHaveLength(1);
    expect(out).toContain(P1);
    expect(out).toContain("## 3. Quantidades");
  });
});
