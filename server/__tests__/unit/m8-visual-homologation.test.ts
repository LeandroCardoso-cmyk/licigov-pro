/**
 * M8 (homologação visual) — regras puras e recuperação SOMENTE LEITURA do contexto da minuta institucional.
 *  - TR com versão oficial emitida: o bloqueio por fontes alteradas não manda "regenerar" (regeneração é recusada para
 *    documento emitido) e deixa claro que a versão emitida continua válida;
 *  - cotação fictícia continua bloqueando a emissão fora da exceção (fail-closed inalterado);
 *  - escopo da composição recuperado pelo inverso EXATO do mapeamento de fronteira; ambíguo/ausente ⇒ nada presumido.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { emissionBlockers } from "../../domain/emissionPreconditions";
import {
  adaptEditalParamsToBindingScope, bindingScopeToEditalParams,
  EDITAL_FORM_TO_SLUG, EDITAL_MODALITY_TO_SLUG, EDITAL_PLATFORM_TO_SLUG,
} from "../../domain/institutionalTemplates/editalBridgeScope";

const st = vi.hoisted(() => ({ manifests: [] as unknown[], bindings: [] as unknown[] }));
vi.mock("../../db/institutionalTemplates", () => ({
  listManifestsForGeneratedDocument: vi.fn(async () => st.manifests),
  listBindings: vi.fn(async () => st.bindings),
}));
import { recoverComposedEditalContext } from "../../services/institutionalTemplates/editalBridgeService";
import * as tplDb from "../../db/institutionalTemplates";

const base = {
  kind: "tr" as const, content: "texto revisado", contentHash: "h1", sourceState: "source_changed",
  changedSourceLabels: ["Itens / quantidades / preços"], trEmitted: true,
};

describe("emissão — fontes alteradas × versão oficial existente", () => {
  it("com versão emitida: orienta o ciclo de nova versão (sem 'regenere') e preserva a validade da emitida", () => {
    const [b] = emissionBlockers({ ...base, lastEmittedContentHash: "h0", lastEmittedVersion: 2 });
    expect(b.code).toBe("EMISSION_SOURCES_CHANGED");
    expect(b.message).toContain("versão oficial v2");
    expect(b.message).toContain("continua válida");
    expect(b.message).toContain("ciclo de nova versão governada");
    expect(b.message).not.toMatch(/regenere/);
  });

  it("sem versão emitida: orienta gerar novamente (caminho permitido)", () => {
    const [b] = emissionBlockers({ ...base, lastEmittedContentHash: null, lastEmittedVersion: null });
    expect(b.code).toBe("EMISSION_SOURCES_CHANGED");
    expect(b.message).toContain("gere novamente o rascunho");
  });

  it("TR emitido coexistindo com rascunho bloqueado: fictícia e 'nada a emitir' continuam bloqueando (fail-closed)", () => {
    const codes = emissionBlockers({
      ...base, sourceState: "current", contentHash: "h0", lastEmittedContentHash: "h0", lastEmittedVersion: 2, fictitiousPriceItemCount: 2,
    }).map((b) => b.code);
    expect(codes).toEqual(["EMISSION_FICTITIOUS_PRICES", "EMISSION_NO_CHANGES"]);
  });
});

describe("escopo da composição — inverso exato do mapeamento de fronteira", () => {
  it("ida e volta para todas as combinações mapeadas", () => {
    for (const modality of Object.keys(EDITAL_MODALITY_TO_SLUG)) {
      for (const form of Object.keys(EDITAL_FORM_TO_SLUG)) {
        const platforms = form === "presencial" ? [null] : Object.keys(EDITAL_PLATFORM_TO_SLUG);
        for (const platform of platforms) {
          const a = adaptEditalParamsToBindingScope({ modality, form, platform });
          expect(a.ok).toBe(true);
          if (a.ok) expect(bindingScopeToEditalParams(a.scope)).toEqual({ modality, form, platform });
        }
      }
    }
  });

  it("slug desconhecido/incompleto ⇒ null (nada aproximado)", () => {
    expect(bindingScopeToEditalParams({ modality: "pregao", form: "eletronica" })).toBeNull();          // falta plataforma
    expect(bindingScopeToEditalParams({ modality: "pregao", form: "eletronica", platform: "x" })).toBeNull();
    expect(bindingScopeToEditalParams({ modality: "inexistente", form: "presencial" })).toBeNull();
    expect(bindingScopeToEditalParams({ modality: "pregao", form: "presencial", platform: "bll" })).toBeNull();
  });
});

const m1 = (over: Record<string, unknown> = {}) => ({
  manifest: {
    stage: "GENERATION", templateRevisionId: "REV2",
    officialDocRefs: [{ role: "tr", order: 1, documentId: "TR-DOC", lineageId: "L", version: 2, contentHash: "c".repeat(64), title: "TR" }],
    ...over,
  },
});
const binding = (scope: Record<string, string>, rev = "REV2", active = true) => ({ scope, pinnedRevisionId: rev, active, documentKind: "edital" });

describe("recoverComposedEditalContext — somente leitura", () => {
  beforeEach(() => { st.manifests = []; st.bindings = []; vi.clearAllMocks(); });

  it("rascunho NÃO institucional ⇒ null, sem consultar manifests", async () => {
    expect(await recoverComposedEditalContext(2, { id: "D1", sources: ["srcdigest:x"] })).toBeNull();
    expect(tplDb.listManifestsForGeneratedDocument).not.toHaveBeenCalled();
  });

  it("um único escopo para a revisão fixada ⇒ RECOVERED + pin exato do TR (tenant do chamador)", async () => {
    st.manifests = [m1()];
    st.bindings = [binding({ modality: "pregao", form: "eletronica", platform: "bll" }), binding({ modality: "pregao", form: "eletronica", platform: "bll" }, "REV2", false), binding({ modality: "concorrencia", form: "presencial" }, "OUTRA")];
    const ctx = await recoverComposedEditalContext(2, { id: "D1", sources: ["origem:template", "tpl-m1:x"] });
    expect(ctx).toEqual({
      templateRevisionId: "REV2", scopeStatus: "RECOVERED",
      scope: { modality: "pregao", form: "eletronico", platform: "bll" },
      trPin: { documentId: "TR-DOC", version: 2, contentHash: "c".repeat(64) },
    });
    expect(tplDb.listManifestsForGeneratedDocument).toHaveBeenCalledWith(2, "D1");
    expect(tplDb.listBindings).toHaveBeenCalledWith(2, { documentKind: "edital" });
  });

  it("mais de um escopo para a mesma revisão ⇒ AMBIGUOUS (nenhum presumido)", async () => {
    st.manifests = [m1()];
    st.bindings = [binding({ modality: "pregao", form: "eletronica", platform: "bll" }), binding({ modality: "pregao", form: "eletronica", platform: "licitanet" })];
    const ctx = await recoverComposedEditalContext(2, { id: "D1", sources: ["origem:template"] });
    expect(ctx).toMatchObject({ scope: null, scopeStatus: "AMBIGUOUS" });
  });

  it("sem binding para a revisão ⇒ NOT_FOUND; sem manifest ⇒ null", async () => {
    st.manifests = [m1({ officialDocRefs: [] })];
    expect(await recoverComposedEditalContext(2, { id: "D1", sources: ["origem:template"] })).toMatchObject({ scope: null, scopeStatus: "NOT_FOUND", trPin: null });
    st.manifests = [];
    expect(await recoverComposedEditalContext(2, { id: "D1", sources: ["origem:template"] })).toBeNull();
  });
});
