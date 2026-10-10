/**
 * PR #288 — CERTAME CONFIG AUTHORITY CLOSURE (puro, sem DB): auditoria dos campos do piloto, Perfil da plataforma, cronograma,
 * derivações de Itens (item × lote, regime de participação), data-base do orçamento e data de emissão atribuída pelo sistema.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import type { VariableCatalog2 } from "../../domain/institutionalTemplates";
import { authorityEntryOf } from "../../domain/institutionalTemplates/editalAuthorityMatrix";
import { classifyVariable } from "../../domain/institutionalTemplates/editalPreparationModel";
import {
  ALWAYS_DERIVED, CERTAME_AUDIT, COMBINATION_PREFIX, DERIVED_VARIABLES, PLATFORM_VARIABLES, SCHEDULE, deriveFormaJulgamento, deriveRegimeParticipacao,
  deriveSchedule, resolvePlatformVariable, validatePlatformProfiles,
} from "../../domain/institutionalTemplates/certameAuthority";
import { validateGovernedPayload, validateGovernedSection, validatePlatforms } from "../../domain/institutionalTemplates/governedSources";
import { buildContextReuse, profileFingerprint } from "../../services/institutionalTemplates/editalContextReuse";
import type { GovernedRecord } from "../../services/institutionalTemplates/governedFieldsStore";
import { brasiliaDateOf } from "../../db/priceResearchBaseDate";
import { compositionDateOf } from "../../services/institutionalTemplates/compositionDate";

const catalog = JSON.parse(readFileSync(path.resolve(__dirname, "../../domain/institutionalTemplates/models/edital-pregao-eletronico-bll/catalog.v2.json"), "utf8")) as VariableCatalog2;
const def = (n: string) => catalog.vars.find((v) => v.name === n)!;

const record = (over: { platforms?: Record<string, unknown>; process?: Record<string, Record<string, unknown>>; participation?: Record<string, unknown>; defaults?: Record<string, unknown> }, revision = 2): GovernedRecord => ({
  payload: { sections: over.process ?? {}, ...(over.platforms ? { platforms: over.platforms as never } : {}), ...(over.participation ? { participation: over.participation as never } : {}), ...(over.defaults ? { defaults: over.defaults } : {}) },
  raw: { sections: over.process ?? {}, ...(over.platforms ? { platforms: over.platforms } : {}), ...(over.defaults ? { defaults: over.defaults } : {}) }, hash: "h".repeat(64), revision, decision: {} as never,
});

describe("Auditoria dos campos do piloto real (CURRENT → CORRECT)", () => {
  it("cobre 1:1 as variáveis que eram TRUE_PROCESS_DECISION e a autoridade correta bate com a matriz", () => {
    const names = CERTAME_AUDIT.map((r) => r.variable);
    expect(new Set(names).size).toBe(names.length);
    for (const r of CERTAME_AUDIT) {
      expect(r.currentAuthority).toBe("TRUE_PROCESS_DECISION");
      expect(authorityEntryOf(r.variable)?.cls, r.variable).toBe(r.correctAuthority);
      expect(r.reason.length, r.variable).toBeGreaterThan(20);
      expect(r.entryPoint.length).toBeGreaterThan(0);
    }
    // nada que o piloto exibia ficou sem auditoria: toda variável CERTAME_CONFIG/SCHEDULE/PLATFORM/LIFECYCLE/ITEMS-derivada/BUDGET-derivada está na tabela
    const classes = ["CERTAME_CONFIG", "CERTAME_SCHEDULE", "PLATFORM_PROFILE", "LIFECYCLE_SYSTEM"];
    for (const v of catalog.vars) {
      const cls = authorityEntryOf(v.name)!.cls;
      const derivedFromOther = v.name in DERIVED_VARIABLES;
      if (classes.includes(cls) || derivedFromOther) expect(names, v.name).toContain(v.name);
    }
    expect(names).toHaveLength(27);
  });

  it("Perfil da plataforma, orçamento, itens e ciclo de vida NÃO são digitados no Edital; padrão institucional nunca para essas autoridades", () => {
    for (const n of ["processo.enderecoEletronicoBll", "processo.regulamentoBllVersao", "julgamento.dataOrcamentoEstimado", "decisao.formaJulgamento", "julgamento.regimeParticipacao", "processo.dataEmissaoEdital"]) {
      expect(ALWAYS_DERIVED(n), n).toBe(true);
      const c = classifyVariable(def(n));
      expect(c.rule === "PLATFORM" || c.rule === "DERIVED", n).toBe(true);
      expect(authorityEntryOf(n)!.defaultEligible, n).toBe(false);
    }
    // o cronograma derivável é decisão independente quando a plataforma não declara a regra
    for (const n of [SCHEDULE.fim, SCHEDULE.horarioFim, SCHEDULE.inicio]) expect(ALWAYS_DERIVED(n)).toBe(false);
  });
});

describe("Perfil da plataforma (BLL) — master data tenant-scoped e versionada", () => {
  const profile = { bll: { enderecoEletronico: "https://bllcompras.com", regulamentoVersao: "Regulamento BLL 2025-03", cronograma: { limitePropostas: "ABERTURA_DA_SESSAO" } } };

  it("valida forma e tipo; início na publicação exige horário; chave/campo desconhecido é recusado", () => {
    expect(validatePlatformProfiles(profile).ok).toBe(true);
    expect(validatePlatformProfiles({ bll: { cronograma: { inicioPropostas: "PUBLICACAO" } } }).ok).toBe(false);
    expect(validatePlatformProfiles({ bll: { cronograma: { inicioPropostas: "PUBLICACAO", horarioInicioPropostas: "08:00" } } }).ok).toBe(true);
    expect(validatePlatformProfiles({ bll: { x: 1 } }).ok).toBe(false);
    expect(validatePlatformProfiles({ "BLL ": {} }).ok).toBe(false);
    expect(validatePlatformProfiles({ bll: { cronograma: { limitePropostas: "OUTRA" } } }).ok).toBe(false);
    expect(validatePlatforms(catalog, { bll: { enderecoEletronico: "não é url" } }).ok).toBe(false);
    expect(validatePlatforms(catalog, profile).ok).toBe(true);
  });

  it("o payload aceita `platforms` só no escopo ÓRGÃO; a escrita humana do mesmo caminho no Edital é recusada (DERIVED_AUTHORITY_OWNED)", () => {
    expect(validateGovernedPayload(catalog, "ORG", { sections: {}, platforms: profile }).ok).toBe(true);
    expect(validateGovernedPayload(catalog, "PROCESS", { sections: {}, platforms: profile }).ok).toBe(false);
    const w = validateGovernedSection(catalog, "PROCESS", "CERTAME_CONFIG", { enderecoEletronicoBll: "https://x.example" }, "write");
    expect(w.ok).toBe(false);
    if (!w.ok) expect(w.issues[0].message).toMatch(/DERIVED_AUTHORITY_OWNED/);
    // leitura tolera o valor legado (preservado como história, ignorado pela composição)
    expect(validateGovernedSection(catalog, "PROCESS", "CERTAME_CONFIG", { enderecoEletronicoBll: "https://x.example" }, "read").ok).toBe(true);
    for (const [src, path_, name] of [["ITEMS", "regimeParticipacao", "julgamento.regimeParticipacao"], ["BUDGET", "dataOrcamentoEstimado", "julgamento.dataOrcamentoEstimado"], ["LIFECYCLE", "dataEmissaoEdital", "processo.dataEmissaoEdital"], ["CERTAME_CONFIG", "decisoes.formaJulgamento", "decisao.formaJulgamento"]] as const) {
      expect(validateGovernedSection(catalog, "PROCESS", src, { [path_]: name === "julgamento.regimeParticipacao" ? def(name).enumValues![0] : name === "decisao.formaJulgamento" ? "item" : "2026-01-01" }, "write").ok, name).toBe(false);
    }
  });

  it("resolve por variável; ausente ⇒ MISSING apontando o Perfil da plataforma", () => {
    expect(resolvePlatformVariable("processo.enderecoEletronicoBll", profile)).toMatchObject({ state: "OK", value: "https://bllcompras.com" });
    expect(resolvePlatformVariable("processo.regulamentoBllVersao", profile)).toMatchObject({ state: "OK", value: "Regulamento BLL 2025-03" });
    expect(resolvePlatformVariable("processo.regulamentoBllVersao", {})).toMatchObject({ state: "MISSING" });
    expect(resolvePlatformVariable("processo.numeroPregao", profile)).toBeNull();
    expect(Object.keys(PLATFORM_VARIABLES)).toEqual(["processo.enderecoEletronicoBll", "processo.regulamentoBllVersao"]);
  });

  it("reuso: valor do perfil vence; revisão nova do perfil muda a origem e o fingerprint; sem perfil o fingerprint anterior é preservado", () => {
    const r1 = buildContextReuse({ catalog, orgRecord: record({ platforms: profile }, 4), trAssertions: [], asOf: "2026-10-10" });
    expect(r1.values.get("processo.enderecoEletronicoBll")).toMatchObject({ kind: "PLATFORM", value: "https://bllcompras.com" });
    expect(r1.values.get("processo.enderecoEletronicoBll")!.origin.ref).toMatchObject({ revision: 4, platform: "bll" });
    const none = buildContextReuse({ catalog, orgRecord: null, trAssertions: [], asOf: "2026-10-10" });
    expect(none.problems.get("processo.enderecoEletronicoBll")).toMatchObject({ code: "PLATFORM_MISSING", fix: "PLATFORM_PROFILE" });
    expect(none.values.has("processo.enderecoEletronicoBll")).toBe(false);
    const a = profileFingerprint(record({ platforms: profile }));
    const b = profileFingerprint(record({ platforms: { bll: { ...profile.bll, regulamentoVersao: "Regulamento BLL 2025-09" } } }));
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).not.toBe(b);
    expect(profileFingerprint(record({}))).toBeNull();
  });
});

describe("Cronograma do certame — só regras DECLARADAS derivam; nada é inventado", () => {
  const known = { [SCHEDULE.divulgacao]: "2026-11-03", [SCHEDULE.abertura]: "2026-11-20", [SCHEDULE.horarioAbertura]: "09:00" };

  it("sem regra declarada nada é derivado", () => {
    expect(deriveSchedule(undefined, known).size).toBe(0);
    expect(deriveSchedule({}, known).size).toBe(0);
  });
  it("limite das propostas = sessão (data e horário) somente com a regra; início = publicação somente com regra E horário", () => {
    const d = deriveSchedule({ limitePropostas: "ABERTURA_DA_SESSAO", inicioPropostas: "PUBLICACAO", horarioInicioPropostas: "08:30" }, known);
    expect(d.get(SCHEDULE.fim)?.value).toBe("2026-11-20");
    expect(d.get(SCHEDULE.horarioFim)?.value).toBe("09:00");
    expect(d.get(SCHEDULE.inicio)?.value).toBe("2026-11-03T08:30");
    expect(deriveSchedule({ inicioPropostas: "PUBLICACAO" }, known).size).toBe(0);                       // sem horário declarado
    expect(deriveSchedule({ limitePropostas: "ABERTURA_DA_SESSAO" }, { [SCHEDULE.horarioAbertura]: "09:00" }).has(SCHEDULE.fim)).toBe(false);   // base ausente
  });
  it("reuso: a regra da plataforma deriva dos valores do processo; sem regra, os campos seguem independentes (sem valor)", () => {
    const process = { PROCESS: { dataDivulgacaoPrevista: "2026-11-03" }, CERTAME_CONFIG: { dataAbertura: "2026-11-20", horarioAbertura: "09:00" } };
    const withRule = buildContextReuse({ catalog, orgRecord: record({ platforms: { bll: { cronograma: { limitePropostas: "ABERTURA_DA_SESSAO" } } } }), trAssertions: [], asOf: "2026-10-10", processRecord: record({ process }) });
    expect(withRule.values.get(SCHEDULE.fim)).toMatchObject({ kind: "SCHEDULE", value: "2026-11-20" });
    expect(withRule.values.get(SCHEDULE.horarioFim)).toMatchObject({ kind: "SCHEDULE", value: "09:00" });
    expect(withRule.values.has(SCHEDULE.inicio)).toBe(false);
    const without = buildContextReuse({ catalog, orgRecord: record({ platforms: { bll: { enderecoEletronico: "https://bllcompras.com" } } }), trAssertions: [], asOf: "2026-10-10", processRecord: record({ process }) });
    expect(without.values.has(SCHEDULE.fim)).toBe(false);
  });
  it("o horário da sessão vindo de PADRÃO institucional alimenta a derivação", () => {
    const org = record({ defaults: { "processo.horarioAbertura": "10:00" }, platforms: { bll: { cronograma: { limitePropostas: "ABERTURA_DA_SESSAO" } } } });
    const r = buildContextReuse({ catalog, orgRecord: org, trAssertions: [], asOf: "2026-10-10", processRecord: record({}) });
    expect(r.values.get("processo.horarioAbertura")).toMatchObject({ kind: "ORG_DEFAULT", value: "10:00" });
    expect(r.values.get(SCHEDULE.horarioFim)).toMatchObject({ kind: "SCHEDULE", value: "10:00" });
  });
});

describe("Itens: item × lote e regime de participação derivados", () => {
  const it_ = (key: string, lot: string | null) => ({ key, lotId: lot ? `L-${lot}` : null, lotCode: lot });
  const regimes = def("julgamento.regimeParticipacao").enumValues!;

  it("forma de julgamento: todos em lote ⇒ lote; nenhum ⇒ item; misto ⇒ ambíguo (fail closed); vazio ⇒ EMPTY", () => {
    expect(deriveFormaJulgamento([it_("a", "1"), it_("b", "1")])).toEqual({ state: "OK", value: "lote" });
    expect(deriveFormaJulgamento([it_("a", null), it_("b", null)])).toEqual({ state: "OK", value: "item" });
    expect(deriveFormaJulgamento([it_("a", "1"), it_("b", null)]).state).toBe("AMBIGUOUS");
    expect(deriveFormaJulgamento([]).state).toBe("EMPTY");
  });
  it("regime: único regime ⇒ ele; regimes distintos ⇒ combinação do modelo; item sem regime ⇒ MISSING; regime fora do enum ⇒ INVALID", () => {
    const [ampla, exclusiva] = regimes;
    expect(deriveRegimeParticipacao({ default: ampla }, [it_("a", null), it_("b", null)], regimes)).toEqual({ state: "OK", value: ampla, combined: false });
    const mixed = deriveRegimeParticipacao({ default: ampla, byItem: { b: exclusiva } }, [it_("a", null), it_("b", null)], regimes);
    expect(mixed).toMatchObject({ state: "OK", combined: true });
    expect(mixed.state === "OK" && mixed.value.startsWith(COMBINATION_PREFIX)).toBe(true);
    expect(deriveRegimeParticipacao({ byLot: { "1": exclusiva } }, [it_("a", "1"), it_("b", "2")], regimes)).toMatchObject({ state: "MISSING", missingItems: 1 });
    expect(deriveRegimeParticipacao(null, [it_("a", null)], regimes).state).toBe("MISSING");
    expect(deriveRegimeParticipacao({ default: "inventado" }, [it_("a", null)], regimes).state).toBe("INVALID");
    expect(deriveRegimeParticipacao({ default: regimes[regimes.length - 1] }, [it_("a", null)], regimes).state).toBe("INVALID");   // "combinação" nunca é escolha direta
    expect(deriveRegimeParticipacao({ default: ampla }, [], regimes).state).toBe("MISSING");
    // precedência item > lote > padrão
    expect(deriveRegimeParticipacao({ default: ampla, byLot: { "1": exclusiva }, byItem: { a: ampla } }, [it_("a", "1"), it_("b", "1")], regimes)).toMatchObject({ combined: true });
  });
  it("reuso: itens ambíguos/ausentes viram PROBLEMA na origem (Itens), nunca valor", () => {
    const amb = buildContextReuse({ catalog, orgRecord: null, trAssertions: [], asOf: "2026-10-10", items: [it_("a", "1"), it_("b", null)], processRecord: record({}) });
    expect(amb.problems.get("decisao.formaJulgamento")).toMatchObject({ code: "ITEMS_AMBIGUOUS", fix: "ITEMS" });
    expect(amb.values.has("decisao.formaJulgamento")).toBe(false);
    expect(amb.problems.get("julgamento.regimeParticipacao")).toMatchObject({ code: "ITEMS_MISSING", fix: "ITEMS" });
    const ok = buildContextReuse({ catalog, orgRecord: null, trAssertions: [], asOf: "2026-10-10", items: [it_("a", "1"), it_("b", "1")], processRecord: record({ participation: { default: regimes[0] } }) });
    expect(ok.values.get("decisao.formaJulgamento")).toMatchObject({ kind: "ITEMS", value: "lote" });
    expect(ok.values.get("julgamento.regimeParticipacao")).toMatchObject({ kind: "ITEMS", value: regimes[0] });
    const unavailable = buildContextReuse({ catalog, orgRecord: null, trAssertions: [], asOf: "2026-10-10", items: null, processRecord: record({}) });
    expect(unavailable.problems.get("decisao.formaJulgamento")).toMatchObject({ code: "ITEMS_MISSING" });
  });
});

describe("Data-base do orçamento e data de emissão (autoridade do sistema)", () => {
  it("data-base vem da Pesquisa de Preços; ausente ⇒ pendência NA Pesquisa de Preços; data inválida nunca é aceita", () => {
    const ok = buildContextReuse({ catalog, orgRecord: null, trAssertions: [], asOf: "2026-10-10", budgetDate: "2026-09-15" });
    expect(ok.values.get("julgamento.dataOrcamentoEstimado")).toMatchObject({ kind: "BUDGET", value: "2026-09-15" });
    for (const bad of [null, undefined, "2026-02-30", "15/09/2026"]) {
      const r = buildContextReuse({ catalog, orgRecord: null, trAssertions: [], asOf: "2026-10-10", budgetDate: bad as never });
      expect(r.values.has("julgamento.dataOrcamentoEstimado")).toBe(false);
      expect(r.problems.get("julgamento.dataOrcamentoEstimado")).toMatchObject({ code: "BUDGET_DATE_MISSING", fix: "PRICE_RESEARCH" });
    }
  });
  it("a data de emissão é atribuída pelo sistema a partir do evento de composição (nunca de entrada humana) e é estável", () => {
    const r = buildContextReuse({ catalog, orgRecord: null, trAssertions: [], asOf: "2026-10-10", compositionDate: "2026-10-09" });
    expect(r.values.get("processo.dataEmissaoEdital")).toMatchObject({ kind: "LIFECYCLE", value: "2026-10-09" });
    // calendário de Brasília: 23:30 em Brasília de 09/10 é 02:30Z de 10/10
    expect(compositionDateOf("2026-10-10T02:30:00.000Z")).toBe("2026-10-09");
    expect(compositionDateOf("2026-10-10T12:00:00.000Z")).toBe("2026-10-10");
    expect(() => compositionDateOf("lixo")).toThrow();
  });
  it("brasiliaDateOf converte created_at UTC para o calendário de Brasília", () => {
    expect(brasiliaDateOf("2026-09-15 01:00:00.000")).toBe("2026-09-14");
    expect(brasiliaDateOf("2026-09-15 12:00:00")).toBe("2026-09-15");
    expect(brasiliaDateOf("inválido")).toBeNull();
  });
});
