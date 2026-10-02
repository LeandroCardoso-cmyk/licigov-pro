/**
 * R9 / SEM-039 (autoridade a montante) + SEM-047 (digest por fonte) — regras puras + builders de contexto.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildDocumentAuthoringContext, type UpstreamDoc } from "../../services/authoring/authoringContext";
import { buildEditalSourceContext } from "../../services/authoring/editalContext";
import { compareSources, parseSourceDigestMarkers } from "../../domain/sourceDigests";
import { authorityLabel, authorityMarker, draftAuthority } from "../../services/authoring/upstreamAuthority";
import { draftContentHash } from "../../domain/generatedDocument";

const up = (content: string, over: Partial<UpstreamDoc> = {}): UpstreamDoc => ({
  present: true, status: "rascunho", contentHash: draftContentHash(content), content, origin: "generated", authority: "rascunho", version: null, ...over,
});
const tr = (over: { dfd?: UpstreamDoc | null; etp?: UpstreamDoc | null; pending?: number } = {}) => buildDocumentAuthoringContext({
  organizationId: 7, processId: "p1", kind: "tr", object: "Limpeza", processObject: "Limpeza", processNumber: "1",
  dfd: over.dfd === undefined ? up("DFD conteúdo") : over.dfd, etp: over.etp === undefined ? up("ETP conteúdo") : over.etp,
  approvedItems: [], pendingItemCount: over.pending ?? 0,
});

describe("SEM-047 — digest POR FONTE", () => {
  it("a geração grava um marcador por fonte e a comparação diz QUAL mudou", () => {
    const before = tr();
    const stored = before.lineageMarkers;
    expect(parseSourceDigestMarkers(stored)).toMatchObject({ dfd: expect.any(String), etp: expect.any(String), itens: expect.any(String), processo: expect.any(String) });
    const after = tr({ etp: up("ETP conteúdo ALTERADO") });
    expect(compareSources(stored, { perSource: after.sourceDigests, globalDigest: after.sourcesDigest })).toEqual({ mode: "per_source", state: "source_changed", changed: ["etp"] });
    expect(compareSources(stored, { perSource: before.sourceDigests, globalDigest: before.sourcesDigest }).state).toBe("current");
  });
  it("falso positivo removido: contagem de pendentes e status/origem do DFD não mudam as fontes", () => {
    const stored = tr().lineageMarkers;
    for (const after of [tr({ pending: 5 }), tr({ dfd: up("DFD conteúdo", { status: "aprovado", authority: "aprovado", origin: "manual" }) })]) {
      expect(compareSources(stored, { perSource: after.sourceDigests, globalDigest: after.sourcesDigest }).state).toBe("current");
    }
  });
  it("falso negativo removido: mudança FORA do recorte (texto longo) é detectada", () => {
    const long = "## Seção\n" + "a".repeat(20_000);
    const stored = tr({ dfd: up(long) }).lineageMarkers;
    const after = tr({ dfd: up(long + " mudança no fim") });
    expect(compareSources(stored, { perSource: after.sourceDigests, globalDigest: after.sourcesDigest }).changed).toEqual(["dfd"]);
  });
  it("documento ANTIGO (sem srcd:) continua no digest global legado — sem mudança de estado", () => {
    const c = tr();
    const legacy = [`srcdigest:${c.sourcesDigest.slice(0, 16)}`];
    expect(compareSources(legacy, { perSource: c.sourceDigests, globalDigest: c.sourcesDigest })).toEqual({ mode: "legacy_global", state: "current", changed: [] });
    expect(compareSources(["srcdigest:outro"], { perSource: c.sourceDigests, globalDigest: c.sourcesDigest }).state).toBe("source_changed");
  });
});

describe("SEM-039 — documentos a jusante consomem a fonte AUTORITATIVA, rotulada", () => {
  it("rótulos e marcadores de autoridade", () => {
    expect(draftAuthority("aprovado")).toBe("aprovado");
    expect(draftAuthority("rascunho")).toBe("rascunho");
    expect(authorityMarker("tr", { authority: "emitido", version: 3 })).toBe("autoridade:tr=emitido:v3");
    expect(authorityMarker("dfd", null)).toBe("autoridade:dfd=ausente");
    expect(authorityLabel({ authority: "rascunho" })).toContain("[REVISAR");
  });
  it("TR: o prompt diz se o ETP é emitido ou rascunho; a lineage registra a autoridade", () => {
    const draftBased = tr();
    expect(draftBased.promptContext).toContain("RASCUNHO não emitido — [REVISAR");
    expect(draftBased.lineageMarkers).toContain("autoridade:etp=rascunho");
    const emitted = tr({ etp: up("ETP conteúdo", { status: "emitido", authority: "emitido", version: 2 }) });
    expect(emitted.promptContext).toContain("estado: emitido v2 — versão oficial");
    expect(emitted.lineageMarkers).toContain("autoridade:etp=emitido:v2");
  });
  it("Edital: marcador de autoridade do TR REAL; o marcador fixo \"tr_aprovado\" deixou de existir", () => {
    const e = buildEditalSourceContext({
      organizationId: 7, processId: "p1", object: "Limpeza", modality: "pregao", form: "eletronico", platform: "compras_gov",
      processObject: "Limpeza", processNumber: "1", currentStage: null, dfd: null, etp: null,
      tr: { present: true, status: "rascunho", contentHash: draftContentHash("TR"), content: "TR", authority: "rascunho", version: null },
      approvedItems: [], criterioJulgamento: null, regimeContratacao: null,
    });
    expect(e.lineageMarkers).toContain("autoridade:tr=rascunho");
    expect(parseSourceDigestMarkers(e.lineageMarkers)).toMatchObject({ parametros: expect.any(String), tr: expect.any(String) });
    const svc = readFileSync(resolve(__dirname, "../../services/procurementProcessService.ts"), "utf8");
    expect(svc).not.toMatch(/^\s*"tr_aprovado",/m);
  });
});
