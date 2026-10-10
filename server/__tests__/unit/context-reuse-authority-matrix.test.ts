/**
 * CONTEXT_REUSE 2.0 — Authority Matrix, papéis, padrões institucionais, parâmetros estruturados do TR e reuso (puro, sem DB).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  AUTHORITY_CLASSES, AUTHORITY_MATRIX_VARIABLES, ROLE_KEYS, ROLE_VARIABLES, authorityEntryOf, isDefaultEligible, resolveRoleVariable,
  trSectionVariables, uncoveredVariables, validateRoleAssignments, type AuthorityClass,
} from "../../domain/institutionalTemplates/editalAuthorityMatrix";
import { classifyVariable } from "../../domain/institutionalTemplates/editalPreparationModel";
import { validateDefaults, validateGovernedPayload } from "../../domain/institutionalTemplates/governedSources";
import type { VariableCatalog2 } from "../../domain/institutionalTemplates";
import { conditionVariables } from "../../domain/institutionalTemplates/conditionalDsl2";
import {
  AUTHORITY_POLICY, factValueHash, isSourceAllowed, resolveCanonicalContext, type FactAssertion,
} from "../../domain/canonicalProcurementContext";
import { TR_PARAMS_DIGEST_RE, shortDigest, decodeTrParamValue, encodeTrParamValue, resolveTrParams, trParamPath, trParamsDigest, variableOfTrParamPath } from "../../domain/trStructuredParams";
import { buildContextReuse, profileFingerprint, trParamDefs, trParamProposals } from "../../services/institutionalTemplates/editalContextReuse";
import type { GovernedRecord } from "../../services/institutionalTemplates/governedFieldsStore";

const catalog = JSON.parse(readFileSync(path.resolve(__dirname, "../../domain/institutionalTemplates/models/edital-pregao-eletronico-bll/catalog.v2.json"), "utf8")) as VariableCatalog2;
const def = (name: string) => catalog.vars.find((v) => v.name === name)!;

describe("Authority Matrix — 100% explícita, sem fallback manual", () => {
  it("toda variável do catálogo BLL tem linha; nenhuma linha sobra; as 12 classes somam o total", () => {
    expect(uncoveredVariables(catalog.vars)).toEqual([]);
    const names = new Set(catalog.vars.map((v) => v.name));
    expect(AUTHORITY_MATRIX_VARIABLES.filter((n) => !names.has(n))).toEqual([]);
    const counts = Object.fromEntries(AUTHORITY_CLASSES.map((c) => [c, 0])) as Record<AuthorityClass, number>;
    for (const v of catalog.vars) counts[authorityEntryOf(v.name)!.cls]++;
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(catalog.vars.length);
    expect(catalog.vars).toHaveLength(185);
    // eslint-disable-next-line no-console
    console.log("[AUTHORITY MATRIX BLL]", JSON.stringify(counts));
    // o ETP é documento textual: nenhuma variável tem autoridade ETP estruturada (provado abaixo)
    expect(counts.UPSTREAM_ETP).toBe(0);
    expect(counts.POST_AWARD).toBe(20);
  });

  it("POST_AWARD ⇔ pos.*; CONDITIONAL ⇔ requiredWhen (exceto a estimativa, que é UPSTREAM_PRICE_RESEARCH)", () => {
    for (const v of catalog.vars) {
      const e = authorityEntryOf(v.name)!;
      expect(e.cls === "POST_AWARD", v.name).toBe(v.name.startsWith("pos."));
      if (v.name === "julgamento.valorEstimado") expect(e.cls).toBe("UPSTREAM_PRICE_RESEARCH");
      else expect(e.cls === "CONDITIONAL", v.name).toBe(!!v.requiredWhen);
    }
  });

  it("a entrada de cada condicional acompanha a autoridade do PAI: TR_SECTION só quando TODOS os pais são parâmetros do TR", () => {
    const trNames = new Set(trSectionVariables(catalog.vars));
    for (const v of catalog.vars) {
      const e = authorityEntryOf(v.name)!;
      if (e.cls !== "CONDITIONAL" || !v.requiredWhen) continue;
      const parents = conditionVariables(v.requiredWhen);
      if (e.entry === "TR_SECTION") for (const p of parents) expect(trNames.has(p), `${v.name} ← ${p}`).toBe(true);
    }
    // cada parâmetro do TR é tipo escalar editável (sem tabela/documento)
    for (const n of trSectionVariables(catalog.vars)) expect(["table", "document_ref"], n).not.toContain(def(n).type);
  });

  it("padrão institucional NUNCA para data do certame, objeto, quantidade, valor ou decisão jurídica casuística", () => {
    const eligible = catalog.vars.filter((v) => isDefaultEligible(v.name));
    expect(eligible.length).toBeGreaterThan(10);
    for (const v of eligible) {
      expect(["date", "datetime", "money", "table", "document_ref"], v.name).not.toContain(v.type);
      expect(v.name).not.toMatch(/objeto|quantidade|valorEstimado|numeroPregao|criterioJulgamento|formaJulgamento|utilizaSrp|inversaoFases|regimeParticipacao|tratamentoRegional|exclusivoMeEpp|cotaReservada|beneficioAfastado|subcontratacao|consorcio|exigeGarantia|exigeAmostra|prazoExecucao|prazoVigencia|localEntrega/);
      expect(["TRUE_PROCESS_DECISION", "UPSTREAM_TR"], v.name).toContain(authorityEntryOf(v.name)!.cls);
    }
    for (const n of ["processo.dataAbertura", "processo.dataEmissaoEdital", "controle.dataDivulgacaoPrevista", "julgamento.dataOrcamentoEstimado", "processo.objetoCompleto", "julgamento.valorEstimado", "decisao.consorcio"]) {
      expect(isDefaultEligible(n), n).toBe(false);
    }
  });

  it("classifyVariable herda a matriz: papéis ⇒ ORG_PROFILE (ORG_ROLE), parâmetros do TR ⇒ TR_PROJECTION (TR_PARAM)", () => {
    for (const v of catalog.vars) {
      const c = classifyVariable(v);
      const e = authorityEntryOf(v.name)!;
      expect(c.authority, v.name).toBe(e.cls);
      expect(c.entry, v.name).toBe(e.entry);
      if (ROLE_VARIABLES[v.name]) expect(c).toMatchObject({ class: "ORG_PROFILE", rule: "ORG_ROLE", scope: "ORG" });
      if (e.cls === "UPSTREAM_TR" && v.name !== "processo.objetoCompleto") expect(c).toMatchObject({ class: "TR_PROJECTION", rule: "TR_PARAM" });
    }
  });

  it("DFD/ETP/Processo: PROVA por código de que o ETP não tem dado estruturado e o DFD só afirma os fatos canônicos existentes", () => {
    // nenhum caminho do Contexto Canônico pertence EXCLUSIVAMENTE ao ETP/DFD, e o ETP nunca é a única fonte de algo que o modelo use
    for (const [p, sources] of Object.entries(AUTHORITY_POLICY)) {
      expect(sources.every((s) => s === "etp"), p).toBe(false);
      expect(sources.every((s) => s === "dfd" || s === "etp"), p).toBe(false);
    }
    expect(isSourceAllowed("tr.param.contratacao.prazoExecucao", "etp")).toBe(false);
    expect(isSourceAllowed("tr.param.contratacao.prazoExecucao", "dfd")).toBe(false);
    // o Processo só estrutura número, objeto e modalidade (schema); o DFD afirma unidade, responsável, PCA, prioridade e data desejada
    const schema = readFileSync(path.resolve(__dirname, "../../../drizzle/schema.ts"), "utf8");
    const proc = schema.slice(schema.indexOf('export const procurementProcessesTable'), schema.indexOf("Pilot Reset B2/B3 (0313) — ledger APPEND-ONLY"));
    for (const col of ["processNumber", "object", "modality"]) expect(proc).toContain(`${col}:`);
    expect(proc).not.toMatch(/prazo|localEntrega|formaPagamento|garantia|vigencia/i);
    const dfdPaths = Object.keys(AUTHORITY_POLICY).filter((k) => AUTHORITY_POLICY[k].includes("dfd")).sort();
    expect(dfdPaths).toEqual(["demand.requestingUnit", "demand.responsibleParty", "items.*.description", "items.*.plannedQuantity", "items.*.unit", "planning.desiredDate", "planning.pcaAlignment", "planning.priority"]);
  });
});

describe("Papéis institucionais", () => {
  const roles = {
    CHEFE_DO_EXECUTIVO: { name: "Fulano Prefeito", cargo: "Prefeito" },
    PREGOEIRO: { name: "Beltrano", cargo: "Pregoeiro", ato: "Portaria 1/2026", dataReferencia: "2026-01-02" },
    AUTORIDADE_SANCIONADORA: { name: "Ciclana", cargo: "Secretária" },
  } as const;

  it("projeção determinística por variável; Prefeito NÃO é presumido autoridade competente; um indivíduo pode ter vários papéis", () => {
    expect(resolveRoleVariable("instituicao.autoridadeCompetenteNome", roles, "2026-10-10")).toMatchObject({ state: "MISSING", role: "AUTORIDADE_COMPETENTE" });
    expect(resolveRoleVariable("instituicao.pregoeiroNome", roles, "2026-10-10")).toEqual({ state: "OK", value: "Beltrano", role: "PREGOEIRO" });
    expect(resolveRoleVariable("instituicao.pregoeiroPortaria", roles, "2026-10-10")).toMatchObject({ state: "OK", value: "Portaria 1/2026" });
    expect(resolveRoleVariable("sancoes.autoridadeSancionadora", roles, "2026-10-10")).toMatchObject({ state: "OK", value: "Ciclana, Secretária" });
    const same = { ...roles, AUTORIDADE_COMPETENTE: { name: "Fulano Prefeito", cargo: "Prefeito" }, ASSINANTE_DO_EDITAL: { name: "Fulano Prefeito", cargo: "Prefeito" } };
    expect(validateRoleAssignments(same).ok).toBe(true);
    expect(resolveRoleVariable("instituicao.signatarioEditalCargo", same, "2026-10-10")).toMatchObject({ state: "OK", value: "Prefeito" });
    expect(resolveRoleVariable("instituicao.nao.existe", roles, "2026-10-10")).toBeNull();
  });

  it("designação VENCIDA é STALE (nunca usada em silêncio); campo ausente do papel é MISSING", () => {
    const stale = { PREGOEIRO: { name: "Beltrano", ato: "P1", vigenciaAte: "2026-01-31" } };
    expect(resolveRoleVariable("instituicao.pregoeiroNome", stale, "2026-10-10")).toMatchObject({ state: "STALE" });
    expect(resolveRoleVariable("instituicao.pregoeiroNome", stale, "2026-01-31")).toMatchObject({ state: "OK" });   // vigência inclusiva
    expect(resolveRoleVariable("instituicao.autoridadeCompetenteCargo", { AUTORIDADE_COMPETENTE: { name: "X" } }, "2026-10-10")).toMatchObject({ state: "MISSING" });
  });

  it("validação: papel/campo desconhecido, nome obrigatório, datas reais, tamanhos", () => {
    expect(validateRoleAssignments({ PAPEL_X: { name: "a" } }).ok).toBe(false);
    expect(validateRoleAssignments({ PREGOEIRO: { cargo: "x" } }).ok).toBe(false);
    expect(validateRoleAssignments({ PREGOEIRO: { name: "a", extra: 1 } }).ok).toBe(false);
    expect(validateRoleAssignments({ PREGOEIRO: { name: "a", dataReferencia: "2026-02-30" } }).ok).toBe(false);
    expect(validateRoleAssignments({ PREGOEIRO: { name: "a", dataReferencia: "2026-02-28", vigenciaAte: "2027-12-31" } }).ok).toBe(true);
    expect(validateRoleAssignments({ PREGOEIRO: { name: "x".repeat(401) } }).ok).toBe(false);
    expect(validateRoleAssignments([]).ok).toBe(false);
    expect(ROLE_KEYS).toContain("CHEFE_DO_EXECUTIVO");
    for (const [name] of Object.entries(ROLE_VARIABLES)) expect(authorityEntryOf(name)!.cls, name).toBe("ORG_ROLE_PROFILE");
  });
});

describe("Padrões institucionais (validação do payload governado)", () => {
  it("escrita estrita: inelegível, tipo/valor inválido e variável desconhecida são recusados", () => {
    expect(validateDefaults(catalog, { "julgamento.modoDisputa": "aberto" }, "write").ok).toBe(true);
    for (const bad of [{ "processo.dataAbertura": "2026-12-01" }, { "julgamento.modoDisputa": "inexistente" }, { "variavel.x": 1 }, { "decisao.consorcio": "admite" }, { "sancoes.tabelaMultas": [] }]) {
      expect(validateDefaults(catalog, bad, "write").ok, JSON.stringify(bad)).toBe(false);
    }
  });
  it("leitura tolerante: incompatível é DESCARTADO e reportado; nomes de outro modelo são preservados fora do payload", () => {
    const r = validateDefaults(catalog, { "julgamento.modoDisputa": "inexistente", "contratacao.formaPagamento": "Em 30 dias", "outro.modelo.x": 1 }, "read");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({ "contratacao.formaPagamento": "Em 30 dias" });
      expect(r.rejected.map((x) => x.name)).toEqual(["julgamento.modoDisputa"]);
    }
  });
  it("payload: roles/defaults só no escopo ÓRGÃO; chaves desconhecidas são recusadas", () => {
    const payload = { sections: {}, roles: { PREGOEIRO: { name: "A" } }, defaults: { "julgamento.modoDisputa": "aberto" } };
    expect(validateGovernedPayload(catalog, "ORG", payload).ok).toBe(true);
    expect(validateGovernedPayload(catalog, "PROCESS", payload).ok).toBe(false);
    expect(validateGovernedPayload(catalog, "ORG", { sections: {}, outra: 1 }).ok).toBe(false);
  });
});

describe("Parâmetros estruturados do TR (procurement_context_facts, sem migration)", () => {
  const fact = (id: number, name: string, value: string | null, over: Partial<FactAssertion> = {}): FactAssertion => ({
    id, path: trParamPath(name), value, valueHash: factValueHash(value), sourceType: "tr", sourceId: "tr-params", sourceVersion: `rev:${id}`,
    status: "confirmed", actorUserId: 7, basisValueHash: null, createdAt: new Date(2026, 0, id).toISOString(), ...over,
  });
  const prazo = def("contratacao.prazoExecucao");
  const enc = (d: typeof prazo, v: unknown) => { const e = encodeTrParamValue(d, v); if (!e.ok) throw new Error(e.reason); return e.encoded; };

  it("somente a fonte `tr` afirma; IA (ai_draft) e as demais fontes nunca", () => {
    expect(isSourceAllowed("tr.param.contratacao.prazoExecucao", "tr")).toBe(true);
    for (const s of ["ai_draft", "user", "dfd", "etp", "process", "organization", "price_research", "intelligent_item", "approved_document"] as const) expect(isSourceAllowed("tr.param.contratacao.prazoExecucao", s), s).toBe(false);
    expect(variableOfTrParamPath("tr.param.contratacao.prazoExecucao")).toBe("contratacao.prazoExecucao");
    expect(variableOfTrParamPath("process.number")).toBeNull();
  });

  it("codifica o valor TIPADO e rejeita valor fora do contrato (nunca conserta)", () => {
    expect(encodeTrParamValue(prazo, { amount: 30, unit: "day" })).toMatchObject({ ok: true });
    expect(encodeTrParamValue(prazo, "três dias").ok).toBe(false);
    expect(encodeTrParamValue(prazo, { amount: -1, unit: "day" }).ok).toBe(false);
    const e = encodeTrParamValue(prazo, { unit: "day", amount: 30 });
    expect(e.ok && decodeTrParamValue(prazo, e.encoded)).toEqual({ ok: true, value: { amount: 30, unit: "day" } });
    expect(decodeTrParamValue(prazo, "não é json").ok).toBe(false);
    expect(decodeTrParamValue(prazo, 12 as never).ok).toBe(false);
    expect(decodeTrParamValue(def("decisao.consorcio"), JSON.stringify("valor-fora")).ok).toBe(false);
  });

  it("resolve SET/UNSET/INVALID/CONFLICT; a última afirmação da fonte vence; limpar volta a UNSET; digest estável e sensível ao valor", () => {
    const defs = [prazo, def("contratacao.localEntrega"), def("decisao.consorcio")];
    const a = fact(1, prazo.name, enc(prazo, { amount: 30, unit: "day" }));
    const b = fact(2, prazo.name, enc(prazo, { amount: 45, unit: "day" }));
    const r1 = resolveTrParams(defs, [a]);
    expect(r1.get(prazo.name)).toMatchObject({ status: "SET", value: { amount: 30, unit: "day" } });
    expect(r1.get("contratacao.localEntrega")!.status).toBe("UNSET");
    const r2 = resolveTrParams(defs, [a, b]);
    expect(r2.get(prazo.name)).toMatchObject({ status: "SET", value: { amount: 45, unit: "day" } });
    expect(resolveTrParams(defs, [a, b, fact(3, prazo.name, null)]).get(prazo.name)!.status).toBe("UNSET");
    expect(resolveTrParams(defs, [fact(1, "decisao.consorcio", JSON.stringify("valor-fora"))]).get("decisao.consorcio")!.status).toBe("INVALID");
    // mesmas entradas ⇒ mesmo digest, independente da ordem de leitura; valor diferente ⇒ digest diferente
    expect(trParamsDigest(resolveTrParams(defs, [a, b]))).toBe(trParamsDigest(resolveTrParams([...defs].reverse(), [a, b])));
    expect(trParamsDigest(r1)).not.toBe(trParamsDigest(r2));
    // autoridade = SHA-256 COMPLETO (64 hex); o curto existe só para exibição
    expect(trParamsDigest(r1)).toMatch(TR_PARAMS_DIGEST_RE);
    expect(trParamsDigest(r1)).toHaveLength(64);
    expect(shortDigest(trParamsDigest(r1))).toHaveLength(16);
    expect(TR_PARAMS_DIGEST_RE.test(shortDigest(trParamsDigest(r1)))).toBe(false);
    expect(TR_PARAMS_DIGEST_RE.test(trParamsDigest(r1).toUpperCase())).toBe(false);
    // fonte não autorizada é ignorada na resolução (defesa em profundidade)
    expect(resolveTrParams(defs, [fact(1, prazo.name, enc(prazo, { amount: 1, unit: "day" }), { sourceType: "ai_draft" })]).get(prazo.name)!.status).toBe("UNSET");
  });

  it("o Contexto Canônico do DFD é INALTERADO pelos parâmetros do TR (digest e versão idênticos)", () => {
    const base = {
      organizationId: 1, processId: "p", process: { number: "2026/1", object: "Objeto", responsibleUserId: 1, createdAt: "2026-01-01T00:00:00.000Z" },
      organization: { name: "Org", municipio: "Cidade", uf: "PR" }, intelligentItems: [],
    };
    const without = resolveCanonicalContext({ ...base, assertions: [] });
    const withTr = resolveCanonicalContext({ ...base, assertions: [fact(99, prazo.name, enc(prazo, { amount: 30, unit: "day" }))] });
    expect(withTr.digest).toBe(without.digest);
    expect(withTr.version).toBe(without.version);
  });
});

describe("Reuso de contexto (puro)", () => {
  const record = (over: Partial<GovernedRecord["raw"]> & { defaultsRejected?: { name: string; reason: string }[] }): GovernedRecord => ({
    payload: { sections: {}, ...(over.roles ? { roles: over.roles as never } : {}), ...(over.defaults ? { defaults: over.defaults } : {}), ...(over.defaultsRejected ? { defaultsRejected: over.defaultsRejected } : {}) },
    raw: { sections: {}, ...(over.roles ? { roles: over.roles } : {}), ...(over.defaults ? { defaults: over.defaults } : {}) }, hash: "h".repeat(64), revision: 3, decision: {} as never,
  });
  const prazo = def("contratacao.prazoExecucao");
  const fx = (value: string): FactAssertion => ({ id: 1, path: trParamPath(prazo.name), value, valueHash: factValueHash(value), sourceType: "tr", sourceId: "tr-params", sourceVersion: "rev:0", status: "confirmed", actorUserId: 1, basisValueHash: null, createdAt: new Date().toISOString() });

  it("papel OK vira valor; ausente/vencido vira PROBLEMA explícito (nunca valor); padrão só para decisão do certame elegível", () => {
    const rec = record({
      roles: { PREGOEIRO: { name: "Beltrano", ato: "P1" }, AUTORIDADE_COMPETENTE: { name: "Z", cargo: "C", vigenciaAte: "2020-01-01" } },
      defaults: { "julgamento.modoDisputa": "aberto", "contratacao.formaPagamento": "Em 30 dias" },
    });
    const r = buildContextReuse({ catalog, orgRecord: rec, trAssertions: [], asOf: "2026-10-10" });
    expect(r.values.get("instituicao.pregoeiroNome")).toMatchObject({ kind: "ORG_ROLE", value: "Beltrano" });
    expect(r.problems.get("instituicao.autoridadeCompetenteNome")).toMatchObject({ code: "ROLE_STALE" });
    expect(r.values.has("instituicao.autoridadeCompetenteNome")).toBe(false);
    expect(r.problems.get("sancoes.autoridadeSancionadora")).toMatchObject({ code: "ROLE_MISSING" });
    expect(r.values.get("julgamento.modoDisputa")).toMatchObject({ kind: "ORG_DEFAULT", value: "aberto" });
    // padrão de PARÂMETRO DO TR nunca é aplicado sozinho (só proposta para confirmação humana)
    expect(r.values.has("contratacao.formaPagamento")).toBe(false);
    expect(trParamProposals(catalog, rec).get("contratacao.formaPagamento")).toEqual({ value: "Em 30 dias", revision: 3 });
    expect(trParamProposals(catalog, rec).has("julgamento.modoDisputa")).toBe(false);
  });

  it("parâmetro do TR confirmado vence; INVALID não é aplicado; padrão incompatível vira problema", () => {
    const rec = record({ defaults: { "julgamento.modoDisputa": "aberto" }, defaultsRejected: [{ name: "julgamento.prazoValidadeProposta", reason: "tipo incompatível" }] });
    const ok = buildContextReuse({ catalog, orgRecord: rec, trAssertions: [fx(JSON.stringify({ amount: 5, unit: "day" }))], asOf: "2026-10-10" });
    expect(ok.values.get(prazo.name)).toMatchObject({ kind: "TR_PARAM", value: { amount: 5, unit: "day" } });
    expect(ok.problems.get("julgamento.prazoValidadeProposta")).toMatchObject({ code: "DEFAULT_INCOMPATIBLE" });
    const bad = buildContextReuse({ catalog, orgRecord: null, trAssertions: [fx("lixo")], asOf: "2026-10-10" });
    expect(bad.values.has(prazo.name)).toBe(false);
    expect(bad.problems.get(prazo.name)).toMatchObject({ code: "TR_PARAM_INVALID" });
    expect(trParamDefs(catalog).map((d) => d.name)).toContain(prazo.name);
  });

  it("fingerprint do perfil: nulo sem papéis/padrões (digest anterior preservado); muda com o ocupante e com o padrão", () => {
    expect(profileFingerprint(null)).toBeNull();
    expect(profileFingerprint(record({}))).toBeNull();
    const a = profileFingerprint(record({ roles: { PREGOEIRO: { name: "A" } } }));
    const b = profileFingerprint(record({ roles: { PREGOEIRO: { name: "B" } } }));
    const c = profileFingerprint(record({ roles: { PREGOEIRO: { name: "A" } }, defaults: { "julgamento.modoDisputa": "aberto" } }));
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(new Set([a, b, c]).size).toBe(3);
    expect(profileFingerprint(record({ roles: { PREGOEIRO: { name: "A" } } }))).toBe(a);
  });
});
