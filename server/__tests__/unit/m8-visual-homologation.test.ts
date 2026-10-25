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

const st = vi.hoisted(() => ({ manifest: null as unknown, bindings: [] as unknown[], emittedTr: [] as { id: string }[] }));
vi.mock("../../db/institutionalTemplates", () => ({
  getManifest: vi.fn(async () => st.manifest),
  listBindings: vi.fn(async () => st.bindings),
}));
vi.mock("../../db/officialDocuments", () => ({ listEmittedByOrigin: vi.fn(async () => st.emittedTr) }));
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
    stage: "GENERATION", generatedDocumentId: "D1", templateRevisionId: "REV2",
    // V2: o papel é o rótulo do MODELO (não "tr") — o TR é identificado pelo documento emitido do processo.
    officialDocRefs: [
      { role: "anexo-etp", order: 1, documentId: "ETP-DOC", lineageId: "L0", version: 1, contentHash: "e".repeat(64), title: "ETP" },
      { role: "termo-referencia", order: 2, documentId: "TR-DOC", lineageId: "L", version: 2, contentHash: "c".repeat(64), title: "TR" },
    ],
    ...over,
  },
});
const binding = (scope: Record<string, string>, rev = "REV2", active = true) => ({ scope, pinnedRevisionId: rev, active, documentKind: "edital" });
const draft = { id: "D1", processId: "P1", sources: ["origem:template", "tpl-m1:M1"] };

describe("recoverComposedEditalContext — somente leitura", () => {
  beforeEach(() => { st.manifest = null; st.bindings = []; st.emittedTr = [{ id: "TR-DOC" }]; vi.clearAllMocks(); });

  it("rascunho NÃO institucional ou sem ponteiro tpl-m1 ⇒ null, sem consultar manifests", async () => {
    expect(await recoverComposedEditalContext(2, { id: "D1", processId: "P1", sources: ["srcdigest:x"] })).toBeNull();
    expect(await recoverComposedEditalContext(2, { id: "D1", processId: "P1", sources: ["origem:template"] })).toBeNull();
    expect(tplDb.getManifest).not.toHaveBeenCalled();
  });

  it("usa o M1 apontado pelo PRÓPRIO rascunho; M1 de outro rascunho ⇒ null", async () => {
    st.manifest = m1({ generatedDocumentId: "OUTRO" });
    expect(await recoverComposedEditalContext(2, draft)).toBeNull();
    expect(tplDb.getManifest).toHaveBeenCalledWith(2, "M1");
  });

  it("um único escopo mapeável para a revisão fixada ⇒ RECOVERED + pin do TR emitido (papel do modelo V2)", async () => {
    st.manifest = m1();
    st.bindings = [binding({ modality: "pregao", form: "eletronica", platform: "bll" }), binding({ modality: "pregao", form: "eletronica", platform: "bll" }, "REV2", false), binding({ modality: "concorrencia", form: "presencial" }, "OUTRA")];
    expect(await recoverComposedEditalContext(2, draft)).toEqual({
      templateRevisionId: "REV2", scopeStatus: "RECOVERED",
      scope: { modality: "pregao", form: "eletronico", platform: "bll" },
      trPin: { documentId: "TR-DOC", version: 2, contentHash: "c".repeat(64) },
    });
    expect(tplDb.listBindings).toHaveBeenCalledWith(2, { documentKind: "edital" });
  });

  it("mais de um escopo, binding não mapeável (sem plataforma) ou com regime/critério ⇒ AMBIGUOUS (nada presumido)", async () => {
    st.manifest = m1();
    st.bindings = [binding({ modality: "pregao", form: "eletronica", platform: "bll" }), binding({ modality: "pregao", form: "eletronica", platform: "licitanet" })];
    expect(await recoverComposedEditalContext(2, draft)).toMatchObject({ scope: null, scopeStatus: "AMBIGUOUS" });
    st.bindings = [binding({ modality: "pregao", form: "eletronica" }), binding({ modality: "pregao", form: "eletronica", platform: "bll" })];
    expect(await recoverComposedEditalContext(2, draft)).toMatchObject({ scope: null, scopeStatus: "AMBIGUOUS" });
    st.bindings = [binding({ modality: "pregao", form: "eletronica", platform: "bll", regime: "empreitada" })];
    expect(await recoverComposedEditalContext(2, draft)).toMatchObject({ scope: null, scopeStatus: "AMBIGUOUS" });
  });

  it("sem binding ⇒ NOT_FOUND; pin que não é TR emitido do processo ⇒ trPin null", async () => {
    st.manifest = m1();
    st.emittedTr = [{ id: "OUTRO-TR" }];
    expect(await recoverComposedEditalContext(2, draft)).toMatchObject({ scope: null, scopeStatus: "NOT_FOUND", trPin: null });
  });
});
