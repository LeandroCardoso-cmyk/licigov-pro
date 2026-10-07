/**
 * Lane A (multi-modelo) — domínio puro: escopo exato (modalidade/forma/plataforma/regime/critério), fontes governadas
 * (certame-config/1, política, codec de payload) e catálogo v2. Sem DB, sem relógio, sem IA.
 */
import { describe, it, expect } from "vitest";
import {
  BINDING_SCOPE_KEYS, normalizeScopeSlug, resolveTemplateBinding, sameScope, scopeIssues, validateTemplateIdentity,
  validateGovernedSection, validateGovernedPayload, validateParticipation, participationRegimeFor, applyFieldsToData,
  encodeGovernedPayload, decodeGovernedPayload, GOVERNED_FIELDS_SCHEMA, AUTHORITY_OWNED_PATHS,
  type VariableCatalog2,
  type BindingScope, type TemplateBinding,
} from "../../domain/institutionalTemplates";
import { createVariableCatalogPort, CURRENT_TEMPLATE_CATALOG_VERSION, TEMPLATE_CATALOG_V1 } from "../../services/institutionalTemplates/catalogRegistry";
import { MODEL_PACKAGES } from "../../services/institutionalTemplates/modelPackages";
import { ORG_A, ORG_B, identity, publishedRevision } from "../helpers/institutionalTemplatesFixture";

const ASOF = "2026-10-06T12:00:00Z";
const rev = publishedRevision();
const binding = (id: string, scope: BindingScope, over: Partial<TemplateBinding> = {}): TemplateBinding => ({
  id, organizationId: ORG_A, documentKind: "edital", scope, identityId: rev.identityId, pinnedRevisionId: rev.id, active: true,
  effectiveFrom: "2026-10-01T00:00:00Z", ...over,
});
const resolve = (scope: BindingScope, bindings: TemplateBinding[], org = ORG_A) =>
  resolveTemplateBinding({ organizationId: org, documentKind: "edital", scope, asOf: ASOF }, bindings, [rev]);

describe("escopo multi-modelo — resolução EXATA, determinística e fail-closed", () => {
  it("o escopo tem 5 chaves canônicas, em ordem fixa", () => {
    expect([...BINDING_SCOPE_KEYS]).toEqual(["modality", "form", "platform", "regime", "criterion"]);
  });

  it("a mesma revisão PUBLISHED atende vários bindings exatos (formas/plataformas distintas) sem ambiguidade", () => {
    const bs = [
      binding("b1", { modality: "pregao", form: "eletronico", platform: "bll" }),
      binding("b2", { modality: "pregao", form: "eletronico", platform: "licitanet" }),
      binding("b3", { modality: "pregao", form: "presencial" }),
    ];
    for (const [scope, id] of [
      [{ modality: "pregao", form: "eletronico", platform: "bll" }, "b1"],
      [{ modality: "pregao", form: "eletronico", platform: "licitanet" }, "b2"],
      [{ modality: "pregao", form: "presencial" }, "b3"],
    ] as const) {
      const r = resolve(scope, bs);
      expect(r.status).toBe("RESOLVED");
      if (r.status === "RESOLVED") { expect(r.binding.id).toBe(id); expect(r.revision.id).toBe(rev.id); }
    }
  });

  it("plataforma é slug EXTENSÍVEL (sem enum fechado): nova plataforma = novo binding", () => {
    expect(scopeIssues({ platform: "portal-compras-publicas" })).toEqual([]);
    expect(scopeIssues({ platform: "plataforma-nova-2027" })).toEqual([]);
    expect(resolve({ platform: "plataforma-nova-2027" }, [binding("b1", { platform: "plataforma-nova-2027" })]).status).toBe("RESOLVED");
  });

  it("sem fallback, sem 'melhor correspondência', sem curinga: escopo diferente ⇒ NOT_BOUND", () => {
    const bs = [binding("b1", { modality: "pregao", form: "eletronico", platform: "bll" })];
    expect(resolve({ modality: "pregao", form: "eletronico" }, bs).status).toBe("NOT_BOUND");                      // falta plataforma
    expect(resolve({ modality: "pregao", form: "eletronico", platform: "licitanet" }, bs).status).toBe("NOT_BOUND");
    expect(resolve({ modality: "pregao", form: "presencial", platform: "bll" }, bs).status).toBe("NOT_BOUND");
    expect(resolve({ modality: "pregao", form: "eletronico", platform: "bll", regime: "menor-preco" }, bs).status).toBe("NOT_BOUND");
    expect(resolve({}, bs).status).toBe("NOT_BOUND");
    // binding genérico não "cobre" pedido específico (nem o contrário)
    expect(resolve({ modality: "pregao", form: "eletronico" }, [binding("g", { modality: "pregao" })]).status).toBe("NOT_BOUND");
  });

  it("dois bindings ativos no MESMO escopo exato ⇒ AMBIGUOUS (o resolvedor nunca desempata)", () => {
    const s = { modality: "pregao", form: "eletronico", platform: "bll" };
    const r = resolve(s, [binding("b2", s), binding("b1", s)]);
    expect(r).toEqual({ status: "AMBIGUOUS", bindingIds: ["b1", "b2"] });
  });

  it("ADVERSARIAL cross-tenant: binding de outro tenant ⇒ INVALID (nunca ignorado em silêncio)", () => {
    const r = resolve({ modality: "pregao" }, [binding("bx", { modality: "pregao" }, { organizationId: ORG_B })]);
    expect(r.status).toBe("INVALID");
    // a revisão de outro tenant também é violação; sem nada de outro tenant, o pedido apenas não encontra binding
    expect(resolve({ modality: "pregao" }, [], ORG_B).status).toBe("INVALID");
    expect(resolveTemplateBinding({ organizationId: ORG_B, documentKind: "edital", scope: { modality: "pregao" }, asOf: ASOF }, [], []).status).toBe("NOT_BOUND");
  });

  it("escopo inválido no PEDIDO ⇒ INVALID (nada de normalizar por aproximação)", () => {
    for (const scope of [{ platform: "BLL" }, { platform: "bll " }, { form: "eletrônico" }, { platform: "a|b" }, { form: "" }, { platform: "a_b" }, { extra: "x" } as BindingScope]) {
      expect(resolve(scope, []).status, JSON.stringify(scope)).toBe("INVALID");
    }
  });

  it("normalizeScopeSlug só troca caixa e `_`; o que continuar inválido é recusado depois", () => {
    expect(normalizeScopeSlug(" Compras_Gov ")).toBe("compras-gov");
    expect(scopeIssues({ platform: normalizeScopeSlug("Compras_Gov") })).toEqual([]);
    expect(scopeIssues({ platform: normalizeScopeSlug("Portal Compras") }).length).toBeGreaterThan(0);
  });

  it("sameScope compara as 5 chaves (ausente só casa com ausente)", () => {
    expect(sameScope({ form: "eletronico" }, { form: "eletronico" })).toBe(true);
    expect(sameScope({ form: "eletronico" }, {})).toBe(false);
    expect(sameScope({ platform: "bll" }, { platform: "licitanet" })).toBe(false);
    expect(sameScope({ modality: "a", form: "b", platform: "c", regime: "d", criterion: "e" }, { modality: "a", form: "b", platform: "c", regime: "d", criterion: "e" })).toBe(true);
  });
});

describe("displayName da identidade (rótulo operacional, não regra jurídica)", () => {
  it("opcional; quando presente deve ser texto limpo e curto", () => {
    expect(validateTemplateIdentity(identity).ok).toBe(true);
    expect(validateTemplateIdentity({ ...identity, displayName: "Edital — Pregão eletrônico BLL" }).ok).toBe(true);
    for (const d of ["", " x", "x ", "a\nb", "x".repeat(161)]) expect(validateTemplateIdentity({ ...identity, displayName: d }).ok, JSON.stringify(d)).toBe(false);
  });
});

const BLL = MODEL_PACKAGES[0].catalog as VariableCatalog2;

describe("campos governados (governed-fields/1) — validados contra o CATÁLOGO da revisão (LiciGov não registra o certame)", () => {
  const certame = {
    modoDisputa: "aberto", casasDecimaisPreco: 2, casasDecimaisDesconto: 4, intervaloMinimoLances: "R$ 0,01", dataAbertura: "2026-11-05",
    horarioAbertura: "09:30", duracaoEtapaLances: { amount: 10, unit: "minute" }, enderecoEletronicoBll: "https://exemplo.gov.br/bll",
    "decisoes.formaJulgamento": "item",
  };

  it("aceita campos do catálogo (tipos normalizados) e recusa caminho desconhecido, valor de tipo errado e enum fora da lista", () => {
    const ok = validateGovernedSection(BLL, "PROCESS", "CERTAME_CONFIG", certame);
    expect(ok.ok).toBe(true);
    const cases: Array<Record<string, unknown>> = [
      { loginPlataforma: "x" },                       // caminho fora do catálogo
      { casasDecimaisPreco: "dois" },                 // tipo errado
      { modoDisputa: "fechado isolado" },             // enum fora do contrato
      { dataAbertura: "2026-13-45" },                 // data impossível
      { duracaoEtapaLances: { amount: 3, unit: "quinzena" } },
    ];
    for (const c of cases) expect(validateGovernedSection(BLL, "PROCESS", "CERTAME_CONFIG", c).ok, JSON.stringify(c)).toBe(false);
  });

  it("escopo: PROCESS aceita PROCESS/TR/ITEMS/CERTAME_CONFIG/NORMATIVE/BUDGET/LIFECYCLE; ORG aceita só POLICY/IDENTITY; RESULT nunca", () => {
    expect(validateGovernedSection(BLL, "ORG", "CERTAME_CONFIG", {}).ok).toBe(false);
    expect(validateGovernedSection(BLL, "PROCESS", "POLICY", {}).ok).toBe(false);
    expect(validateGovernedSection(BLL, "PROCESS", "RESULT", {}).ok).toBe(false);
    expect(validateGovernedSection(BLL, "ORG", "POLICY", {}).ok).toBe(true);
    expect(validateGovernedSection(BLL, "ORG", "IDENTITY", {}).ok).toBe(true);
  });

  it("caminhos de AUTORIDADE CANÔNICA nunca são decisão humana (processo, identidade, itens, estimativa, sigilo do orçamento)", () => {
    for (const [source, paths] of Object.entries(AUTHORITY_OWNED_PATHS)) {
      const scope = source === "IDENTITY" ? "ORG" : "PROCESS";
      for (const p of paths!) {
        if (!BLL.vars.some((v) => v.source === source && v.path === p)) continue;
        const r = validateGovernedSection(BLL, scope, source, { [p]: p === "ano" ? 2026 : p === "orcamentoSigilosoSimNao" ? true : p === "valorEstimado" ? 1 : p === "quadroItensContratacao" ? [] : "x" });
        expect(r.ok, `${source}.${p}`).toBe(false);
      }
    }
  });

  it("payload completo: seções + participação; participação só no escopo do processo", () => {
    const payload = { sections: { CERTAME_CONFIG: certame, ITEMS: { regimeParticipacao: "Ampla participação, com os benefícios da LC nº 123/2006" } }, participation: { default: "ampla", byLot: { L1: "exclusiva" }, byItem: { i3: "cota" } } };
    expect(validateGovernedPayload(BLL, "PROCESS", payload).ok).toBe(true);
    expect(validateGovernedPayload(BLL, "ORG", payload).ok).toBe(false);
    expect(validateGovernedPayload(BLL, "PROCESS", { ...payload, extra: 1 }).ok).toBe(false);
    expect(validateParticipation({ padrao: "x" }).ok).toBe(false);
  });

  it("participação: item > lote > padrão; ausente ⇒ null (nunca inferido)", () => {
    const p = { default: "ampla", byLot: { L1: "exclusiva-me-epp" }, byItem: { "item-3": "cota-reservada" } };
    expect(participationRegimeFor(p, { itemKey: "item-3", lotCode: "L1" })).toBe("cota-reservada");
    expect(participationRegimeFor(p, { itemKey: "item-9", lotCode: "L1" })).toBe("exclusiva-me-epp");
    expect(participationRegimeFor(p, { itemKey: "item-9", lotCode: null })).toBe("ampla");
    expect(participationRegimeFor(null, { itemKey: "x", lotCode: null })).toBeNull();
    expect(participationRegimeFor({ byLot: { L1: "x" } }, { itemKey: "i", lotCode: "L2" })).toBeNull();
  });

  it("applyFieldsToData monta objetos aninhados por caminho pontuado e recusa colisão", () => {
    const d: Record<string, unknown> = {};
    applyFieldsToData(d, { "decisoes.a": true, "decisoes.b": false, simples: 1 });
    expect(d).toEqual({ decisoes: { a: true, b: false }, simples: 1 });
    expect(() => applyFieldsToData(d, { decisoes: 1 })).toThrow();
    expect(() => applyFieldsToData(d, { simples: 2 })).toThrow();
  });

  it("codec: round-trip íntegro; adulteração de payload/hash/schema ⇒ null; determinístico", () => {
    const payload = { sections: { POLICY: { b: 2, a: "ç" } } };
    const enc = encodeGovernedPayload(GOVERNED_FIELDS_SCHEMA, payload);
    expect(enc.evidence).toHaveLength(3);
    expect(decodeGovernedPayload(enc.evidence, GOVERNED_FIELDS_SCHEMA)).toEqual({ payload, hash: enc.hash });
    expect(encodeGovernedPayload(GOVERNED_FIELDS_SCHEMA, { sections: { POLICY: { a: "ç", b: 2 } } }).hash).toBe(enc.hash);
    expect(decodeGovernedPayload(enc.evidence, "outro/1")).toBeNull();
    expect(decodeGovernedPayload(enc.evidence.map((e) => (e.startsWith("payload:") ? 'payload:{"sections":{}}' : e)), GOVERNED_FIELDS_SCHEMA)).toBeNull();
    expect(decodeGovernedPayload(enc.evidence.map((e) => (e.startsWith("hash:") ? `hash:${"0".repeat(64)}` : e)), GOVERNED_FIELDS_SCHEMA)).toBeNull();
    expect(decodeGovernedPayload([], GOVERNED_FIELDS_SCHEMA)).toBeNull();
  });
});

describe("catálogos: v1 INALTERADO (replay) + catálogo v2 por modelo", () => {
  it("o catálogo corrente de autoria é o v1; o catálogo v2 do BLL resolve por versão; versão desconhecida ⇒ null", () => {
    const port = createVariableCatalogPort();
    expect(CURRENT_TEMPLATE_CATALOG_VERSION).toBe("tpl-catalog/1");
    expect(port.current()).toBe(TEMPLATE_CATALOG_V1);
    expect(port.byVersion(TEMPLATE_CATALOG_V1.version)).toBe(TEMPLATE_CATALOG_V1);
    expect(port.byVersion(BLL.version)).toBe(MODEL_PACKAGES[0].catalog);
    expect(port.byVersion("tpl-catalog/999")).toBeNull();
    expect(TEMPLATE_CATALOG_V1.vars).toHaveLength(12);
  });

  it("o catálogo v2 do BLL declara todas as fontes e RESULT só com variáveis opcionais com texto governado", () => {
    const sources = new Set(BLL.vars.map((v) => v.source));
    for (const s of ["PROCESS", "TR", "ITEMS", "CERTAME_CONFIG", "POLICY", "BUDGET", "NORMATIVE", "IDENTITY", "LIFECYCLE", "RESULT"]) expect(sources.has(s as never), s).toBe(true);
    const result = BLL.vars.filter((v) => v.source === "RESULT");
    expect(result.length).toBeGreaterThan(0);
    for (const v of result) { expect(v.required, v.name).toBe(false); expect(v.requiredWhen, v.name).toBeUndefined(); expect(v.absentText, v.name).toBe("a preencher"); }
  });
});
