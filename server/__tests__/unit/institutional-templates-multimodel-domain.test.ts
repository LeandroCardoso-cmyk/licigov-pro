/**
 * Lane A (multi-modelo) — domínio puro: escopo exato (modalidade/forma/plataforma/regime/critério), fontes governadas
 * (certame-config/1, política, codec de payload) e catálogo v2. Sem DB, sem relógio, sem IA.
 */
import { describe, it, expect } from "vitest";
import {
  BINDING_SCOPE_KEYS, normalizeScopeSlug, resolveTemplateBinding, sameScope, scopeIssues, validateTemplateIdentity,
  validateCertameConfig, validatePolicyPayload, participationRegimeFor, encodeGovernedPayload, decodeGovernedPayload,
  CERTAME_CONFIG_SCHEMA, POLICY_PAYLOAD_SCHEMA,
  type BindingScope, type TemplateBinding,
} from "../../domain/institutionalTemplates";
import { createVariableCatalogPort, CURRENT_TEMPLATE_CATALOG_VERSION, TEMPLATE_CATALOG_V1, TEMPLATE_CATALOG_V2 } from "../../services/institutionalTemplates/catalogRegistry";
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

describe("certame-config/1 — contrato FECHADO (LiciGov não registra o certame na plataforma)", () => {
  const valid = {
    schema: CERTAME_CONFIG_SCHEMA, disputeMode: "aberto-fechado", openClosedRule: "regra-x", decimalPlaces: 2,
    minimumBidInterval: { kind: "AMOUNT_CENTS", value: 100 }, stageDurationMinutes: 10, extensionRule: "automatica", extensionMinutes: 2,
    schedule: { abertura: { date: "2026-11-05", time: "09:00" }, disputa: { date: "2026-11-05", time: "10:00" } },
    operationalWindows: [{ key: "manha", startTime: "08:00", endTime: "12:00" }],
    participation: { default: "ampla", byLot: { L1: "exclusiva-me-epp" }, byItem: { "item-3": "cota-reservada" } },
  };

  it("aceita a configuração completa e rejeita campo desconhecido", () => {
    expect(validateCertameConfig(valid).ok).toBe(true);
    const r = validateCertameConfig({ ...valid, loginPlataforma: "x" });
    expect(r.ok).toBe(false);
  });

  it("rejeita schema errado, decimais fora de faixa, intervalo inválido, janela invertida/duplicada e data impossível", () => {
    const cases: Array<Record<string, unknown>> = [
      { ...valid, schema: "certame-config/2" },
      { ...valid, decimalPlaces: 5 },
      { ...valid, minimumBidInterval: { kind: "OUTRO", value: 1 } },
      { ...valid, minimumBidInterval: { kind: "AMOUNT_CENTS", value: 0 } },
      { ...valid, stageDurationMinutes: 0 },
      { ...valid, operationalWindows: [{ key: "a", startTime: "12:00", endTime: "08:00" }] },
      { ...valid, operationalWindows: [{ key: "a", startTime: "08:00", endTime: "09:00" }, { key: "a", startTime: "10:00", endTime: "11:00" }] },
      { ...valid, schedule: { abertura: { date: "2026-13-45" } } },
      { ...valid, participation: { padrao: "x" } },
      "texto", null, [],
    ];
    for (const c of cases) expect(validateCertameConfig(c).ok, JSON.stringify(c)).toBe(false);
  });

  it("regime de participação: item > lote > padrão; ausente ⇒ null (nunca inferido)", () => {
    const cfg = validateCertameConfig(valid);
    if (!cfg.ok) throw new Error("fixture");
    expect(participationRegimeFor(cfg.value, { itemKey: "item-3", lotCode: "L1" })).toBe("cota-reservada");
    expect(participationRegimeFor(cfg.value, { itemKey: "item-9", lotCode: "L1" })).toBe("exclusiva-me-epp");
    expect(participationRegimeFor(cfg.value, { itemKey: "item-9", lotCode: null })).toBe("ampla");
    expect(participationRegimeFor(null, { itemKey: "item-9", lotCode: "L1" })).toBeNull();
    const semPadrao = validateCertameConfig({ schema: CERTAME_CONFIG_SCHEMA, participation: { byLot: { L1: "x" } } });
    if (!semPadrao.ok) throw new Error("fixture");
    expect(participationRegimeFor(semPadrao.value, { itemKey: "i", lotCode: "L2" })).toBeNull();
  });
});

describe("política institucional e codec do payload governado", () => {
  it("política: objeto PLANO de escalares com chaves seguras", () => {
    expect(validatePolicyPayload({ prazo_impugnacao_dias: 3, exige_garantia: false, pregoeiro: "Fulano" }).ok).toBe(true);
    for (const p of [{}, { a: { b: 1 } }, { a: null }, { "a.b": 1 }, { a: "" }, { a: Number.NaN }, [], "x"]) expect(validatePolicyPayload(p).ok, JSON.stringify(p)).toBe(false);
  });

  it("codec: round-trip íntegro; adulteração de payload/hash/schema ⇒ null", () => {
    const payload = { b: 2, a: "ç" };
    const enc = encodeGovernedPayload(POLICY_PAYLOAD_SCHEMA, payload);
    expect(enc.evidence).toHaveLength(3);
    expect(decodeGovernedPayload(enc.evidence, POLICY_PAYLOAD_SCHEMA)).toEqual({ payload, hash: enc.hash });
    // determinismo: ordem das chaves não muda o hash
    expect(encodeGovernedPayload(POLICY_PAYLOAD_SCHEMA, { a: "ç", b: 2 }).hash).toBe(enc.hash);
    expect(decodeGovernedPayload(enc.evidence, CERTAME_CONFIG_SCHEMA)).toBeNull();
    expect(decodeGovernedPayload(enc.evidence.map((e) => (e.startsWith("payload:") ? 'payload:{"a":"x","b":2}' : e)), POLICY_PAYLOAD_SCHEMA)).toBeNull();
    expect(decodeGovernedPayload(enc.evidence.map((e) => (e.startsWith("hash:") ? `hash:${"0".repeat(64)}` : e)), POLICY_PAYLOAD_SCHEMA)).toBeNull();
    expect(decodeGovernedPayload([], POLICY_PAYLOAD_SCHEMA)).toBeNull();
  });
});

describe("catálogo v2 (tpl-catalog/2) — v1 preservado, novas fontes registradas", () => {
  it("v1 e v2 coexistem; a corrente é a v2; revisões antigas continuam resolvendo a v1", () => {
    const port = createVariableCatalogPort();
    expect(CURRENT_TEMPLATE_CATALOG_VERSION).toBe(TEMPLATE_CATALOG_V2.version);
    expect(port.current().version).toBe("tpl-catalog/2");
    expect(port.byVersion(TEMPLATE_CATALOG_V1.version)).toBe(TEMPLATE_CATALOG_V1);
    expect(port.byVersion("tpl-catalog/999")).toBeNull();
  });

  it("v2 ⊇ v1 (mesmos nomes e definições) e acrescenta ITEMS/BUDGET/CERTAME_CONFIG/NORMATIVE/LIFECYCLE", () => {
    const v1 = new Map(TEMPLATE_CATALOG_V1.vars.map((v) => [v.name, v]));
    const v2 = new Map(TEMPLATE_CATALOG_V2.vars.map((v) => [v.name, v]));
    for (const [n, v] of v1) expect(v2.get(n), n).toEqual(v);
    const sources = new Set(TEMPLATE_CATALOG_V2.vars.map((v) => v.source));
    for (const s of ["ITEMS", "BUDGET", "CERTAME_CONFIG", "NORMATIVE", "LIFECYCLE"]) expect(sources.has(s as never), s).toBe(true);
    expect(sources.has("RESULT" as never)).toBe(false);   // RESULT falha fechada: sem variável no catálogo
    expect(v2.size).toBeGreaterThan(v1.size);
  });
});
