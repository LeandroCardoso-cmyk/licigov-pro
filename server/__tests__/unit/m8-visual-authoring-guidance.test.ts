/**
 * Homologação visual M8 (P1) — TR recusado com "mínimo legal 'fundamentacao' … exige conteúdo": a validação continua
 * fail-closed; a mensagem passa a dizer o que faltou, onde completar e a próxima ação (rascunho ≠ emissão oficial).
 * O prompt declara as seções de mínimo legal (nunca omitidas) e pede [REVISAR] onde faltar fato.
 */
import { describe, it, expect } from "vitest";
import { authoringFailureGuidance } from "../../domain/authoring/authoringGuidance";
import { generateStructuredAuthoring } from "../../services/authoring/structuredAuthoringService";
import { AuthoringContractError, canonicalSectionsFor } from "../../domain/authoring/authoringSchema";
import { buildDocumentAuthoringContext } from "../../services/authoring/authoringContext";

describe("orientação operacional da recusa de autoria", () => {
  it("TR sem fundamentação: motivo, onde complementar (ETP), próxima ação e distinção rascunho × emissão", () => {
    const g = authoringFailureGuidance("tr", ['mínimo legal "fundamentacao" (Art. 6º, XXIII, b) não pode ser omitido/justificado — exige conteúdo']);
    expect(g.sections).toEqual([expect.objectContaining({ key: "fundamentacao", title: "Fundamentação da contratação" })]);
    expect(g.message).toMatch(/^Rascunho do Termo de Referência não gerado — nada foi gravado/);
    expect(g.message).toContain("Fundamentação da contratação");
    expect(g.message).toContain("Art. 6º, XXIII, b");
    expect(g.message).toMatch(/Onde complementar: no ETP do processo/);
    expect(g.message).toMatch(/Próxima ação: complete/);
    expect(g.message).toMatch(/emissão da versão oficial tem verificações próprias/);
  });

  it("issue sem seção identificável: mensagem genérica, com o detalhe técnico", () => {
    expect(authoringFailureGuidance("etp", ["estrutura inválida"]).message).toMatch(/não atendeu à estrutura exigida.*estrutura inválida/);
  });

  it("a validação continua fail-closed: provider que omite seção de mínimo legal ⇒ AuthoringContractError; o prompt declara as obrigatórias", async () => {
    const ctx = buildDocumentAuthoringContext({ organizationId: 7, processId: "p1", kind: "tr", object: "Notebooks", processObject: "Notebooks", processNumber: "1", dfd: null, etp: null, approvedItems: [], pendingItemCount: 0 });
    let seen = "";
    const omitted = JSON.stringify({ sections: canonicalSectionsFor("tr").map((s) => s.key === "fundamentacao"
      ? { key: s.key, contentMode: "not_applicable_with_justification", prose: "", omissionJustification: "Sem ETP emitido.", legalReferences: [] }
      : { key: s.key, contentMode: "provided", prose: `Texto de ${s.key}.`, legalReferences: [] }) });
    await expect(generateStructuredAuthoring({ organizationId: 7, kind: "tr", object: "Notebooks", correlationId: "c", sourceContext: ctx, invoke: async (q) => { seen = q; return omitted; } }))
      .rejects.toBeInstanceOf(AuthoringContractError);
    expect(seen).toMatch(/Seções de MÍNIMO LEGAL — sempre contentMode "provided", NUNCA omitidas/);
    expect(seen).toContain("fundamentacao");
    expect(seen).toMatch(/NÃO afirme como conclusão \(ex\.: parcelamento ou lote único, economicidade/);
  });
});
