/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Bridge Edital → Modelos Institucionais — adapter de fronteira (puro) + roteamento do servidor (ports em memória, geradores espiados).
 */
import { describe, it, expect, vi } from "vitest";
import { adaptEditalParamsToBindingScope } from "../../domain/institutionalTemplates/editalBridgeScope";
import { generateEditalRouted, resolveEditalTemplate, TR_OFICIAL_EXATO_NECESSARIO, type BridgeDeps } from "../../services/institutionalTemplates/editalBridgeService";

const HASH = "e62297e1" + "a".repeat(56);
const ORG = 1;
const NOW = "2026-10-09T12:00:00Z";

describe("adapter de fronteira — vocabulário do processo → BindingScope", () => {
  it("eletronico → eletronica; presencial → presencial; plataformas mapeadas explicitamente", () => {
    expect(adaptEditalParamsToBindingScope({ modality: "pregao", form: "eletronico", platform: "bll" })).toEqual({ ok: true, scope: { modality: "pregao", form: "eletronica", platform: "bll" } });
    expect(adaptEditalParamsToBindingScope({ modality: "pregao", form: "presencial" })).toEqual({ ok: true, scope: { modality: "pregao", form: "presencial" } });
    for (const [legacy, slug] of [["bll", "bll"], ["compras_gov", "compras-gov"], ["licitanet", "licitanet"], ["portal_proprio", "propria"]] as const) {
      expect((adaptEditalParamsToBindingScope({ modality: "pregao", form: "eletronico", platform: legacy }) as any).scope.platform).toBe(slug);
    }
    expect((adaptEditalParamsToBindingScope({ modality: "chamada_publica", form: "presencial" }) as any).scope.modality).toBe("chamada-publica");
  });
  it("critério/regime NÃO entram no escopo; presencial ignora plataforma", () => {
    const r: any = adaptEditalParamsToBindingScope({ modality: "pregao", form: "eletronico", platform: "bll", judgmentCriterion: "menor preço", executionRegime: "fornecimento" } as any);
    expect(Object.keys(r.scope).sort()).toEqual(["form", "modality", "platform"]);
    expect(adaptEditalParamsToBindingScope({ modality: "pregao", form: "presencial", platform: "bll" })).toEqual({ ok: true, scope: { modality: "pregao", form: "presencial" } });
  });
  it("valor desconhecido/'outra'/incompleto NUNCA é aproximado", () => {
    expect(adaptEditalParamsToBindingScope({ modality: "pregao", form: "eletronico", platform: "outra" })).toMatchObject({ ok: false, reason: "UNMAPPED_PLATFORM" });
    expect(adaptEditalParamsToBindingScope({ modality: "pregao", form: "eletronico", platform: "BLL" })).toMatchObject({ ok: false, reason: "UNMAPPED_PLATFORM" });
    expect(adaptEditalParamsToBindingScope({ modality: "dispensa", form: "eletronico", platform: "bll" })).toMatchObject({ ok: false, reason: "UNMAPPED_MODALITY" });
    expect(adaptEditalParamsToBindingScope({ modality: "pregao", form: "eletronica", platform: "bll" })).toMatchObject({ ok: false, reason: "UNMAPPED_FORM" });
    expect(adaptEditalParamsToBindingScope({ modality: "pregao", form: "eletronico" })).toMatchObject({ ok: false, reason: "PARAMETERS_INCOMPLETE" });
    expect(adaptEditalParamsToBindingScope({ modality: null, form: "presencial" })).toMatchObject({ ok: false, reason: "PARAMETERS_INCOMPLETE" });
    expect(adaptEditalParamsToBindingScope({ modality: "constructor", form: "presencial" })).toMatchObject({ ok: false });   // sem prototype lookup
  });
});

// ── ports em memória (só o que a resolução usa) ──
const binding = (over: Record<string, unknown> = {}) => ({
  id: "tb1", organizationId: ORG, documentKind: "edital", scope: { modality: "pregao", form: "eletronica", platform: "bll" }, identityId: "ti1",
  pinnedRevisionId: "tr1", active: true, effectiveFrom: "2026-01-01T00:00:00Z", effectiveTo: null, ...over,
});
const revision = (over: Record<string, unknown> = {}) => ({ id: "tr1", organizationId: ORG, identityId: "ti1", revision: 1, status: "PUBLISHED", semanticHash: HASH, ...over });
function depsOf(opts: { enabled?: boolean; bindings?: any[]; revisions?: any[]; ports?: boolean } = {}): BridgeDeps {
  if (opts.ports === false) return { ports: null, now: () => NOW };
  const ports: any = {
    enablement: { isEnabled: async (org: number) => org === ORG && (opts.enabled ?? true) },
    repository: {
      listBindings: async (org: number) => (opts.bindings ?? [binding()]).filter((b) => b.organizationId === org),
      listRevisions: async (org: number) => (opts.revisions ?? [revision()]).filter((r) => r.organizationId === org),
      getIdentity: async (org: number, id: string) => (org === ORG && id === "ti1" ? { id, organizationId: org, slug: "edital-pregao-eletronico-bll", displayName: "Edital — Pregão Eletrônico — BLL" } : null),
      getRevision: async () => null,
    },
  };
  return { ports, now: () => NOW };
}
const WS = { modality: "pregao", form: "eletronico", platform: "bll" } as const;

describe("resolveEditalTemplate — estados autoritativos", () => {
  it("BLL resolve SOMENTE pregao+eletronica+bll (igualdade exata, sem aproximação)", async () => {
    const r: any = await resolveEditalTemplate(depsOf(), ORG, WS);
    expect(r.status).toBe("BOUND");
    expect(r.template).toMatchObject({ bindingId: "tb1", identityId: "ti1", displayName: "Edital — Pregão Eletrônico — BLL", revisionId: "tr1", revision: 1, semanticHash: HASH });
    expect(JSON.stringify(r)).not.toMatch(/"ast"|tpl-ast/);
    for (const other of [{ ...WS, platform: "licitanet" }, { ...WS, platform: "outra" }, { modality: "pregao", form: "presencial" }, { ...WS, modality: "concorrencia" }]) {
      expect(((await resolveEditalTemplate(depsOf(), ORG, other)) as any).status).toBe("NOT_BOUND");
    }
  });
  it("feature OFF (flag desligada ou módulo não integrado) ⇒ FEATURE_OFF", async () => {
    expect(await resolveEditalTemplate(depsOf({ enabled: false }), ORG, WS)).toEqual({ status: "FEATURE_OFF" });
    expect(await resolveEditalTemplate(depsOf({ ports: false }), ORG, WS)).toEqual({ status: "FEATURE_OFF" });
  });
  it("CONFLICT (vínculos ambíguos) e INVALID (revisão não publicada)", async () => {
    const dup = await resolveEditalTemplate(depsOf({ bindings: [binding(), binding({ id: "tb2" })] }), ORG, WS);
    expect(dup).toMatchObject({ status: "CONFLICT", bindingIds: expect.arrayContaining(["tb1", "tb2"]) });
    const bad = await resolveEditalTemplate(depsOf({ revisions: [revision({ status: "DEPRECATED" })] }), ORG, WS);
    expect(bad).toMatchObject({ status: "INVALID" });
  });
  it("tenant: binding/revisão de outro tenant não resolvem", async () => {
    const d = depsOf({ bindings: [binding({ organizationId: 2 })], revisions: [revision({ organizationId: 2 })] });
    expect(((await resolveEditalTemplate(d, ORG, WS)) as any).status).toBe("NOT_BOUND");
    expect(((await resolveEditalTemplate(d, 2, WS)) as any).status).toBe("FEATURE_OFF");   // o enablement é por tenant
  });
});

const TR = { documentId: "od1", version: 1, contentHash: "b".repeat(64) };
function run(deps: BridgeDeps, over: { params?: any; officialPins?: any; institutional?: any } = {}) {
  const legacy = vi.fn(async () => ({ document: { id: "g" }, validation: { valid: true, violations: [] } }));
  const institutional = over.institutional ?? vi.fn(async () => ({ generationManifest: { id: "m1" }, replayed: false }));
  const result = generateEditalRouted(deps, {
    organizationId: ORG, processId: "p1", object: "Aquisição", actorUserId: 5, correlationId: "c1", params: over.params ?? WS,
    ...(over.officialPins !== undefined ? { officialPins: over.officialPins } : { officialPins: { TR } }), legacy, institutional,
  } as any);
  return { result, legacy, institutional };
}

describe("generateEditalRouted — o servidor decide o motor; institucional nunca cai para o legado", () => {
  it("A) feature OFF ⇒ legado", async () => {
    const t = run(depsOf({ enabled: false }));
    expect((await t.result).mode).toBe("LEGACY");
    expect(t.legacy).toHaveBeenCalledTimes(1); expect(t.institutional).not.toHaveBeenCalled();
    const t2 = run(depsOf({ ports: false }));
    expect((await t2.result).mode).toBe("LEGACY");
  });
  it("B) feature ON + NOT_BOUND (inclusive plataforma sem slug) ⇒ legado", async () => {
    for (const params of [{ ...WS, platform: "licitanet" }, { ...WS, platform: "outra" }]) {
      const t = run(depsOf(), { params });
      expect((await t.result).mode).toBe("LEGACY");
      expect(t.legacy).toHaveBeenCalledTimes(1); expect(t.institutional).not.toHaveBeenCalled();
    }
  });
  it("C) BOUND ⇒ institucional, escopo NORMALIZADO, asOf do servidor e TR exato; legado NÃO chamado", async () => {
    const t = run(depsOf());
    const r: any = await t.result;
    expect(r.mode).toBe("INSTITUTIONAL_TEMPLATE");
    expect(t.legacy).not.toHaveBeenCalled();
    expect(t.institutional).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG, subjectId: "p1", documentKind: "edital", documentType: "edital", scope: { modality: "pregao", form: "eletronica", platform: "bll" },
      asOf: NOW, actorUserId: 5, correlationId: "c1", officialPins: { TR }, title: "Edital — Aquisição",
    }));
    expect(r.template).toMatchObject({ revisionId: "tr1", identityId: "ti1" });
  });
  it("D) BOUND + falha institucional ⇒ ERRO; legado NÃO é chamado (sem fallback silencioso)", async () => {
    const boom = vi.fn(async () => { throw new Error("TEMPLATE_COMPOSITION_FAILED: MISSING_REQUIRED"); });
    const t = run(depsOf(), { institutional: boom });
    await expect(t.result).rejects.toThrow("TEMPLATE_COMPOSITION_FAILED");
    expect(t.legacy).not.toHaveBeenCalled();
  });
  it("E) CONFLICT / INVALID ⇒ erro; nenhum gerador executa", async () => {
    const c = run(depsOf({ bindings: [binding(), binding({ id: "tb2" })] }));
    await expect(c.result).rejects.toMatchObject({ code: "CONFLICT" });
    expect(c.legacy).not.toHaveBeenCalled(); expect(c.institutional).not.toHaveBeenCalled();
    const i = run(depsOf({ revisions: [revision({ status: "DEPRECATED" })] }));
    await expect(i.result).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(i.legacy).not.toHaveBeenCalled(); expect(i.institutional).not.toHaveBeenCalled();
  });
  it("BOUND sem TR exato ⇒ TR_OFICIAL_EXATO_NECESSARIO, zero efeitos (nenhum gerador)", async () => {
    const t = run(depsOf(), { officialPins: {} });
    await expect(t.result).rejects.toThrow(TR_OFICIAL_EXATO_NECESSARIO);
    expect(t.legacy).not.toHaveBeenCalled(); expect(t.institutional).not.toHaveBeenCalled();
  });
  it("mesmas entradas ⇒ mesmos parâmetros ao motor (determinismo do boundary; o replay é do M1)", async () => {
    const a = run(depsOf()); await a.result;
    const b = run(depsOf()); await b.result;
    expect((a.institutional as any).mock.calls[0][0]).toEqual((b.institutional as any).mock.calls[0][0]);
  });
});
