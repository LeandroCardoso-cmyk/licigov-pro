/**
 * M8 — coerência do ETP: fundamentação NORMATIVA ≠ suficiência FACTUAL. Com lacunas factuais, a conclusão de viabilidade é
 * explicitamente PRELIMINAR (nunca definitiva sobre evidência insuficiente); a ressalva usa o mecanismo existente de limitações.
 * Nenhum texto do sistema introduz o marcador [REVISAR] (que bloquearia a emissão) — só as lacunas reais o fazem.
 */
import { describe, it, expect } from "vitest";
import { generateStructuredAuthoring } from "../../services/authoring/structuredAuthoringService";
import { buildDocumentAuthoringContext } from "../../services/authoring/authoringContext";
import { canonicalSectionsFor } from "../../domain/authoring/authoringSchema";

const provider = (viabilidade: string) => JSON.stringify({
  sections: canonicalSectionsFor("etp").map((s) => ({
    key: s.key, contentMode: "provided", legalReferences: [],
    prose: s.key === "viabilidade" ? viabilidade : s.key === "necessidade" ? "A necessidade decorre de [REVISAR: informar o diagnóstico do setor]." : `Texto de ${s.key}.`,
  })),
});
/** Processo sem DFD e sem itens aprovados: fontes ausentes = lacunas factuais reais. */
const ctx = () => buildDocumentAuthoringContext({
  organizationId: 7, processId: "p1", kind: "etp", object: "Computadores", processObject: "Computadores", processNumber: "1",
  dfd: null, etp: null, approvedItems: [], pendingItemCount: 0,
});

describe("M8 — ETP: viabilidade preliminar com lacunas factuais", () => {
  it("lacuna factual ⇒ conclusão de viabilidade marcada como PRELIMINAR e ressalva registrada", async () => {
    const r = await generateStructuredAuthoring({ organizationId: 7, kind: "etp", object: "Computadores", correlationId: "m8-etp", sourceContext: ctx(), invoke: async () => provider("A contratação é viável e razoável.") });
    const v = r.structured.sections.find((s) => s.key === "viabilidade")!;
    expect(v.prose).toMatch(/^Conclusão preliminar, condicionada ao saneamento de \d+ lacuna\(s\) factual\(is\)/);
    expect(v.prose).toContain("A contratação é viável e razoável.");
    expect(r.structured.limitations.some((l) => /Suficiência factual pendente/.test(l))).toBe(true);
    // O sistema não injeta o marcador [REVISAR] por conta própria (o cabeçalho e o prefixo usam linguagem natural).
    expect(v.prose.replace(/^Conclusão preliminar[^.]*\.\s*/, "")).toBe("A contratação é viável e razoável.");
    // Estado de fundamentação é proveniência (resultado estruturado/lineage/tela), não texto do documento (M8 P3.2).
    expect(r.groundingState).toBeDefined();
    expect(r.content).not.toMatch(/Estado de fundamentação normativa/);
    expect(r.content.split("\n")[2]).not.toContain("[REVISAR");
  });
});
