/**
 * DADOS DE PUBLICAÇÃO DIFERIDOS (DEFERRED_PUBLICATION) — domínio puro, sem DB.
 *
 *  R1   Revisão 1 (publicada) INTOCADA: hash congelado, arquivos congelados, comportamento de composição inalterado (campos ainda obrigatórios).
 *  R2   Revisão 2 CANDIDATA: derivada da Revisão 1 SÓ pela política de completude dos 7 dados de publicação; mesma AST; não registrável
 *       pela API; nunca devolvida como pacote vigente.
 *  CAT  validação do metadado `completionPolicy` (nunca em obrigatório / requiredWhen; texto governado quando renderizável).
 *  PUB  composição sem número/cronograma (PUB1–PUB3, PUB6–PUB8), manifest DEFERRED × RESOLVED, determinismo e hashes distintos (PUB14).
 *  READ PublicationReadiness (PUB17–PUB19) e projeção estável.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyDraftHumanState, classifyTemplateDraftHumanState } from "../../domain/draftRegeneration";
import { draftContentHash } from "../../domain/generatedDocument";
import {
  createDraftRevision, transitionRevision, validateVariableCatalog2, validateManifest,
  type TemplateAST2, type VariableCatalog2, type VariableDef2,
} from "../../domain/institutionalTemplates";
import { composeTemplate, type TemplateComposeRequest } from "../../domain/institutionalTemplates/composer";
import type { ModelRules } from "../../domain/institutionalTemplates/modelRules";
import { revisionSemanticHash } from "../../domain/institutionalTemplates/semanticHash";
import {
  PUBLICATION_FIELDS, PUBLICATION_VARIABLES, projectPublicationSchedule,
} from "../../domain/institutionalTemplates/publicationSchedule";
import { DEFERRED_PUBLICATION_TEXT, isDeferredPublication, supportsGovernedDraftRecomposition } from "../../domain/institutionalTemplates/variableCatalog2";
import { MODEL_PACKAGES, getModelPackage, getModelPackageVersion, BLL_MODEL_KEY } from "../../services/institutionalTemplates/modelPackages";
import { MODEL_REGISTRATION_PRESETS } from "../../services/institutionalTemplates/modelRegistrationService";
import { createVariableCatalogPort } from "../../services/institutionalTemplates/catalogRegistry";
import { BLL_MODEL_DIR, BLL_ORG, BASE_SCENARIO, bllCatalog, bllIdentity, bllSources, bllTrPin } from "../helpers/institutionalTemplatesBllHarness";

const R2_DIR = path.resolve(BLL_MODEL_DIR, "..", "edital-pregao-eletronico-bll-1.0.2");
const read = (dir: string, f: string) => readFileSync(path.join(dir, f), "utf8");
const json = <T>(dir: string, f: string) => JSON.parse(read(dir, f)) as T;
const sha = (dir: string, f: string) => createHash("sha256").update(readFileSync(path.join(dir, f))).digest("hex");

const ast = json<TemplateAST2>(BLL_MODEL_DIR, "ast.json");
const r2Catalog = json<VariableCatalog2>(R2_DIR, "catalog.v2.json");

/** Valores DISTINTOS e reconhecíveis para os dados de publicação (nunca coincidem com as amostras de outros campos). */
const PUBLICATION_VALUES: Record<string, unknown> = {
  "processo.numeroPregao": "0457", "controle.dataDivulgacaoPrevista": "2027-02-01", "processo.dataAbertura": "2027-03-17", "processo.horarioAbertura": "10:45",
  "processo.dataInicioRecebimentoPropostas": "2027-02-03T08:15", "processo.dataFimRecebimentoPropostas": "2027-03-16", "processo.horarioFimRecebimentoPropostas": "17:20",
};

function revisionFor(catalog: VariableCatalog2) {
  const d = createDraftRevision({ id: "tplrev_bll", identity: bllIdentity, revision: 1, ast, catalog, sourceFormat: "NATIVE" });
  if (!d.ok) throw new Error(`rascunho inválido: ${JSON.stringify(d.issues).slice(0, 500)}`);
  const a = transitionRevision(d.value, { to: "APPROVED", approvalDecisionId: "dec_a" }, bllIdentity, catalog);
  if (!a.ok) throw new Error(JSON.stringify(a.issues));
  const p = transitionRevision(a.value, { to: "PUBLISHED", publishDecisionId: "dec_p" }, bllIdentity, catalog);
  if (!p.ok) throw new Error(JSON.stringify(p.issues));
  return p.value;
}
function request(catalog: VariableCatalog2, values: Record<string, unknown>, omit: readonly string[]): TemplateComposeRequest {
  const revision = revisionFor(catalog);
  return {
    organizationId: BLL_ORG, identity: bllIdentity, revision, catalog,
    pin: { identityId: revision.identityId, revisionId: revision.id, semanticHash: revision.semanticHash },
    sources: bllSources({ ...BASE_SCENARIO, ...values }, BLL_ORG, omit), officialDocuments: { TR: bllTrPin() }, aiNarratives: [],
    identityFingerprint: "fp-bll", generatedDocumentId: "gdoc_bll_1", createdAt: "2026-10-07T12:00:00.000Z",
  };
}
const compose = (catalog: VariableCatalog2, values: Record<string, unknown>, omit: readonly string[] = [], modelRules?: ModelRules) =>
  composeTemplate({ ...request(catalog, values, omit), ...(modelRules ? { modelRules } : {}) });
/** Só a regra de ordem das datas (as demais dependem de autoridades que o harness unitário não modela). */
const DATE_ORDER_ONLY: ModelRules = (() => {
  const all = json<ModelRules>(R2_DIR, "rules.json");
  return { ...all, rules: all.rules.filter((x) => x.id === "R_ABERTURA_APOS_DIVULGACAO") } as ModelRules;
})();
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`composição falhou: ${JSON.stringify((r as { issues?: unknown }).issues).slice(0, 800)}`);
  return r as Extract<T, { ok: true }>;
};

describe("R1 — Revisão 1 publicada permanece EXATAMENTE igual", () => {
  const FROZEN: Record<string, string> = {
    "approvedPackage.json": "325af88ab2dba54b6a9e24ebc17d3e96b85d5292c46abed00d1edd2dae664d8a",
    "ast.json": "f416477f36d50168d7e3835d011fe53b563b8b0351409a37fa68b0a917624e11",
    "catalog.v2.json": "deb5685d514e504f72b12bd33bfdab39b92048c59060c9cbe3ea6d01313fdaa1",
    "mapping.json": "eea7bd0e9e65db60018bfad6f7945bd040136930239f46c2aab0f1177ac47a20",
    "provenance.json": "8be7e28c464f19d34e90e5b227572eced55b45eed5e0a43ff1e47c0465342750",
    "report.json": "f944ceab2d3d8c66e99cb52e8d9f2405c7d84776867377be062211d76af2f0f8",
    "rules.json": "0c945120e346b7d4112ff42578a2f0028ebd674ae0c51e3373f3c5cd7b59b7c2",
  };
  it("arquivos do pacote da Revisão 1 congelados (SHA-256) e hash semântico da AST = e62297e1…", () => {
    for (const [f, h] of Object.entries(FROZEN)) expect(sha(BLL_MODEL_DIR, f), f).toBe(h);
    expect(revisionSemanticHash({ ast, variableCatalogVersion: bllCatalog.version })).toBe("e62297e16e4d3c2e0bbef5d288f1a0e675675c4d741f6b2afe1d5c265431da5d");
    expect(json<{ astSemanticHash: string }>(BLL_MODEL_DIR, "report.json").astSemanticHash).toBe("e62297e16e4d3c2e0bbef5d288f1a0e675675c4d741f6b2afe1d5c265431da5d");
    expect(bllCatalog.version).toBe("edital-pregao-eletronico-bll/1.0.1-draft.c2");
  });
  it("na Revisão 1 os 7 dados continuam OBRIGATÓRIOS e sem política (nada mudou semanticamente)", () => {
    for (const name of PUBLICATION_VARIABLES) {
      const def = bllCatalog.vars.find((v) => v.name === name)!;
      expect(def.required, name).toBe(true);
      expect(def.completionPolicy, name).toBeUndefined();
    }
  });
  it("Revisão 1: faltar o número do pregão ou uma data BLOQUEIA a composição (comportamento publicado preservado)", () => {
    const r = compose(bllCatalog, {}, ["processo.numeroPregao"]);
    expect(r.ok).toBe(false);
    expect(JSON.stringify((r as { issues: unknown }).issues)).toContain("MISSING_REQUIRED");
    // e o manifest da Revisão 1 não carrega o campo novo (hashes de manifests existentes intactos)
    const full = ok(compose(bllCatalog, {}));
    expect("deferredPublication" in full.value.manifest).toBe(false);
  });
});

describe("R2 — Revisão 2 CANDIDATA (1.0.2-draft)", () => {
  it("é derivada da Revisão 1 SÓ pela política dos 7 dados de publicação (catálogo, regras, AST, mapeamento)", () => {
    const byName = (c: VariableCatalog2) => new Map(c.vars.map((v) => [v.name, v] as const));
    const a = byName(bllCatalog); const b = byName(r2Catalog);
    expect([...b.keys()]).toEqual([...a.keys()]);                       // mesmas variáveis, mesma ordem
    const changed = [...b.keys()].filter((n) => JSON.stringify(a.get(n)) !== JSON.stringify(b.get(n)));
    expect(changed.sort()).toEqual([...PUBLICATION_VARIABLES].sort());   // EXATAMENTE os 7
    for (const n of changed) {
      const { required: _r, completionPolicy: _c, absentText: _t, ...rest1 } = a.get(n)! as VariableDef2 & { absentText?: string };
      const { required: r2req, completionPolicy, absentText: _t2, ...rest2 } = b.get(n)! as VariableDef2 & { absentText?: string };
      expect(rest2, n).toEqual(rest1);                                   // nada além de required/completionPolicy/absentText
      expect(r2req).toBe(false);
      expect(completionPolicy).toBe("DEFERRED_PUBLICATION");
    }
    expect(r2Catalog.version).toBe("edital-pregao-eletronico-bll/1.0.2-draft.c3");
    expect(validateVariableCatalog2(r2Catalog).ok).toBe(true);
    const r1Rules = json<{ rules: unknown; catalogVersion: string }>(BLL_MODEL_DIR, "rules.json"); const r2Rules = json<{ rules: unknown; catalogVersion: string }>(R2_DIR, "rules.json");
    expect(r2Rules.rules).toEqual(r1Rules.rules);
    expect(r2Rules.catalogVersion).toBe(r2Catalog.version);
  });
  it("o conjunto DEFERRED do catálogo = PUBLICATION_VARIABLES; só controles não têm texto; todo renderizável tem o texto governado", () => {
    const deferred = r2Catalog.vars.filter(isDeferredPublication).map((v) => v.name).sort();
    expect(deferred).toEqual([...PUBLICATION_VARIABLES].sort());
    expect(PUBLICATION_FIELDS).toHaveLength(7);
    for (const v of r2Catalog.vars.filter(isDeferredPublication)) {
      if (v.renderable) expect((v as { absentText?: string }).absentText, v.name).toBe(DEFERRED_PUBLICATION_TEXT);
      else expect(v.name).toBe("controle.dataDivulgacaoPrevista");
    }
  });
  it("mesma AST ⇒ o hash semântico da revisão muda SÓ pela versão do catálogo (ast intocada)", () => {
    const h2 = revisionSemanticHash({ ast, variableCatalogVersion: r2Catalog.version });
    expect(h2).toBe(json<{ astSemanticHash: string }>(R2_DIR, "report.json").astSemanticHash);
    expect(h2).not.toBe("e62297e16e4d3c2e0bbef5d288f1a0e675675c4d741f6b2afe1d5c265431da5d");
    expect(h2).toBe("33ee30bc76b79fa92dfe7952e5e6fbce1c5e830d8da9227d3333bac68a63c0cd");
  });
  it("é CANDIDATA: fora dos presets de registro, não vigente em getModelPackage, registrada no registro de código por versão", () => {
    const r2 = getModelPackageVersion(BLL_MODEL_KEY, "1.0.2-draft")!;
    expect(r2.candidate).toBe(true);
    expect(getModelPackage(BLL_MODEL_KEY)!.provenance.sourceLogicalVersion).toBe("1.0.1-draft");
    expect(getModelPackage(BLL_MODEL_KEY)!.candidate).toBeUndefined();
    expect(MODEL_REGISTRATION_PRESETS.map((p) => p.sourceLogicalVersion)).toEqual(["1.0.1-draft"]);
    expect(MODEL_PACKAGES.filter((p) => p.modelKey === BLL_MODEL_KEY)).toHaveLength(2);
    const port = createVariableCatalogPort();
    expect(port.byVersion(bllCatalog.version)).not.toBeNull();
    expect(port.byVersion(r2Catalog.version)).not.toBeNull();
  });
});

describe("CAT — validação do metadado completionPolicy", () => {
  const v = (over: Record<string, unknown>): VariableCatalog2 => ({
    format: "tpl-catalog/2", version: "t/1",
    vars: [{ name: "processo.x", type: "string", source: "PROCESS", path: "x", required: false, renderable: true, absentText: "A DEFINIR", completionPolicy: "DEFERRED_PUBLICATION", ...over } as VariableDef2],
  });
  it("aceita variável opcional com texto governado (ou controle sem texto)", () => {
    expect(validateVariableCatalog2(v({})).ok).toBe(true);
    expect(validateVariableCatalog2(v({ renderable: false, absentText: undefined })).ok).toBe(true);
  });
  it("recusa política em obrigatório, com requiredWhen, renderável sem texto e valor desconhecido", () => {
    const bad = (over: Record<string, unknown>) => { const r = validateVariableCatalog2(v(over)); return r.ok ? "" : JSON.stringify(r.issues); };
    expect(bad({ required: true, absentText: undefined })).toContain("completionPolicy");
    expect(bad({ requiredWhen: { op: "present", var: "processo.x" } })).toContain("completionPolicy");
    expect(bad({ absentText: undefined })).toContain("absentText");
    expect(bad({ completionPolicy: "OUTRA" })).toContain("completionPolicy");
  });
});

describe("PUB — composição SEM dados de publicação (Revisão 2)", () => {
  const NUMBER = ["processo.numeroPregao"];
  const SCHEDULE = PUBLICATION_VARIABLES.filter((n) => n !== "processo.numeroPregao");
  const only = (omit: readonly string[]) => Object.fromEntries(Object.entries(PUBLICATION_VALUES).filter(([k]) => !omit.includes(k)));
  const fmt = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

  it("PUB1 — sem número do pregão ⇒ geração permitida; o número NÃO é inventado", () => {
    const r = ok(compose(r2Catalog, only(NUMBER), NUMBER));
    expect(r.value.content.text).toContain(`EDITAL DE PREGÃO ELETRÔNICO Nº ${DEFERRED_PUBLICATION_TEXT}/`);
    expect(r.value.content.text).not.toContain("0457");
    expect(r.value.manifest.deferredPublication).toContainEqual({ variable: "processo.numeroPregao", status: "DEFERRED" });
  });
  it("PUB2 — sem todas as datas/horários ⇒ geração permitida", () => {
    ok(compose(r2Catalog, only(SCHEDULE), SCHEDULE));
  });
  it("PUB3 — sem número E sem datas ⇒ geração permitida; todos os 7 DEFERRED no manifest (PUB6)", () => {
    const r = ok(compose(r2Catalog, {}, PUBLICATION_VARIABLES));
    const refs = r.value.manifest.deferredPublication!;
    expect(refs.map((x) => x.variable)).toEqual([...PUBLICATION_VARIABLES].sort());
    expect(refs.every((x) => x.status === "DEFERRED" && x.valueHash === undefined)).toBe(true);
    expect(validateManifest(r.value.manifest).ok).toBe(true);
  });
  it("PUB7/PUB8 — nenhuma data nem número fictícios: sem fallback de data corrente, sequência ou 'último + 1'", () => {
    const r = ok(compose(r2Catalog, {}, PUBLICATION_VARIABLES));
    const text = r.value.content.text;
    const today = new Date(); const dd = (n: number) => String(n).padStart(2, "0");
    for (const d of [`${dd(today.getDate())}/${dd(today.getMonth() + 1)}/${today.getFullYear()}`, `${today.getFullYear()}-${dd(today.getMonth() + 1)}-${dd(today.getDate())}`]) {
      // a única data possível seria a das AMOSTRAS de outros campos; a data corrente nunca é usada
      if (d !== "05/11/2026") expect(text).not.toContain(d);
    }
    for (const v of Object.values(PUBLICATION_VALUES)) expect(text).not.toContain(typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? fmt(v) : String(v));
    expect(text).toContain(DEFERRED_PUBLICATION_TEXT);
    expect(text).not.toMatch(/\[REVISAR[^\]]*(numeroPregao|dataAbertura|horarioAbertura|RecebimentoPropostas)/);     // ausência esperada NÃO é [REVISAR]
    expect(text).not.toMatch(/\[REVISAR: processo\.(numeroPregao|data|horario)/);
  });
  it("valores reais presentes ⇒ usados normalmente (RESOLVED com valueHash, sem texto diferido)", () => {
    const r = ok(compose(r2Catalog, PUBLICATION_VALUES));
    const text = r.value.content.text;
    expect(text).not.toContain(DEFERRED_PUBLICATION_TEXT);
    expect(text).toContain("Nº 0457/");
    expect(text).toContain(fmt("2027-03-17"));
    expect(text).toContain("10h45");
    const refs = r.value.manifest.deferredPublication!;
    expect(refs.every((x) => x.status === "RESOLVED" && /^[0-9a-f]{64}$/.test(x.valueHash ?? ""))).toBe(true);
    expect(refs).toHaveLength(7);
  });
  it("parcial: cada dado é DEFERRED ou RESOLVED individualmente, em ordem determinística", () => {
    const omit = ["processo.dataAbertura", "processo.horarioAbertura"];
    const r = ok(compose(r2Catalog, only(omit), omit));
    const st = Object.fromEntries(r.value.manifest.deferredPublication!.map((x) => [x.variable, x.status]));
    expect(st["processo.dataAbertura"]).toBe("DEFERRED"); expect(st["processo.horarioAbertura"]).toBe("DEFERRED");
    expect(st["processo.numeroPregao"]).toBe("RESOLVED");
    expect(Object.keys(st)).toEqual([...Object.keys(st)].sort());
  });
  it("PUB14 — versão A (sem dados) × versão B (com dados): conteúdo e hashes DIFERENTES; cada composição é determinística (replay)", () => {
    const a1 = ok(compose(r2Catalog, {}, PUBLICATION_VARIABLES)); const a2 = ok(compose(r2Catalog, {}, PUBLICATION_VARIABLES));
    const b1 = ok(compose(r2Catalog, PUBLICATION_VALUES)); const b2 = ok(compose(r2Catalog, PUBLICATION_VALUES));
    expect(a1.value.composedOutputHash).toBe(a2.value.composedOutputHash);
    expect(a1.value.manifest.manifestHash).toBe(a2.value.manifest.manifestHash);
    expect(b1.value.composedOutputHash).toBe(b2.value.composedOutputHash);
    expect(a1.value.composedOutputHash).not.toBe(b1.value.composedOutputHash);
    expect(a1.value.manifest.manifestHash).not.toBe(b1.value.manifest.manifestHash);
  });
  it("as regras do modelo seguem válidas com dado ausente (dateOrder só se aplica com as DUAS datas); com ambas, a ordem continua exigida", () => {
    ok(compose(r2Catalog, { "processo.dataAbertura": "2027-03-17" }, ["controle.dataDivulgacaoPrevista"], DATE_ORDER_ONLY));
    ok(compose(r2Catalog, { "controle.dataDivulgacaoPrevista": "2027-02-01", "processo.dataAbertura": "2027-03-17" }, [], DATE_ORDER_ONLY));
    const bad = compose(r2Catalog, { "controle.dataDivulgacaoPrevista": "2027-03-20", "processo.dataAbertura": "2027-03-17" }, [], DATE_ORDER_ONLY);
    expect(bad.ok).toBe(false);
  });
  it("Revisão 2 não altera nenhuma OUTRA obrigatoriedade: faltar um campo não-diferido continua bloqueando", () => {
    const r = compose(r2Catalog, {}, ["processo.numeroPregao", "julgamento.valorEstimado"]);
    expect(r.ok).toBe(false);
    expect(JSON.stringify((r as { issues: unknown }).issues)).toContain("julgamento.valorEstimado");
  });
});

describe("manifest — registro de dados diferidos", () => {
  it("só entra quando o catálogo declara (Rev1 sem a chave); valida forma, unicidade e ordem", () => {
    const r = ok(compose(r2Catalog, {}, PUBLICATION_VARIABLES));
    const m = r.value.manifest;
    const tamper = (d: unknown) => validateManifest({ ...m, deferredPublication: d } as never);
    expect(tamper([{ variable: "a", status: "RESOLVED" }]).ok).toBe(false);                 // RESOLVED exige valueHash
    expect(tamper([{ variable: "a", status: "DEFERRED", valueHash: "a".repeat(64) }]).ok).toBe(false);   // DEFERRED não tem valor
    expect(tamper([{ variable: "b", status: "DEFERRED" }, { variable: "a", status: "DEFERRED" }]).ok).toBe(false);   // ordem
    expect(tamper([{ variable: "a", status: "DEFERRED" }, { variable: "a", status: "DEFERRED" }]).ok).toBe(false);   // unicidade
  });
});

describe("READ — PublicationReadiness e projeção (PUB17–PUB19)", () => {
  it("PUB17 — sem dados: complete=false, os 7 ausentes em ordem fixa; projeção toda null (nada inventado)", () => {
    const { schedule, readiness } = projectPublicationSchedule({});
    expect(readiness.complete).toBe(false);
    expect(readiness.missing).toEqual(PUBLICATION_FIELDS.map((f) => f.role));
    expect(Object.values(schedule).every((v) => v === null)).toBe(true);
  });
  it("PUB18 — parcial: complete=false e `missing` determinístico", () => {
    const p = projectPublicationSchedule({ "processo.numeroPregao": "0457", "processo.dataAbertura": "2027-03-17" });
    expect(p.readiness.complete).toBe(false);
    expect(p.readiness.missing).toEqual(["dataDivulgacaoPrevista", "horarioSessao", "inicioRecebimentoPropostas", "dataLimitePropostas", "horarioLimitePropostas"]);
    expect(p.schedule.numeroPregao).toBe("0457");
    expect(p.schedule.dataSessao).toBe("2027-03-17");
    expect(projectPublicationSchedule({ "processo.numeroPregao": "0457", "processo.dataAbertura": "2027-03-17" }).readiness.missing).toEqual(p.readiness.missing);
  });
  it("PUB19 — todos preenchidos: complete=true, missing vazio; string vazia/branco NÃO conta como preenchido", () => {
    const p = projectPublicationSchedule(PUBLICATION_VALUES);
    expect(p.readiness).toMatchObject({ complete: true, total: 7, missing: [] });
    expect(projectPublicationSchedule({ ...PUBLICATION_VALUES, "processo.numeroPregao": "  " }).readiness.complete).toBe(false);
  });
});

describe("LEGAL — a composição não depende de parecer/autorização jurídica (guarda estrutural)", () => {
  const roots = ["server/services/institutionalTemplates", "server/domain/institutionalTemplates"].map((r) => path.resolve(r));
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const full = path.join(dir, f);
    return statSync(full).isDirectory() ? files(full) : /\.ts$/.test(f) ? [full] : [];
  });
  it("nenhum módulo da composição/preparação importa serviços, rotas ou tabelas de parecer jurídico", () => {
    const offenders = roots.flatMap(files).filter((f) => /from\s+["'][^"']*(legalOpinion|legal_opinion|directProcurement|legalReference)[^"']*["']/i.test(readFileSync(f, "utf8")));
    // `legalReference` (base normativa Lei 14.133) é insumo de conteúdo, não gate; só o módulo de parecer é proibido
    expect(offenders.filter((f) => /legalOpinion|legal_opinion/i.test(readFileSync(f, "utf8")))).toEqual([]);
  });
  it("o catálogo da Revisão 2 não tem variável de parecer jurídico e nenhuma condição depende dele", () => {
    expect(r2Catalog.vars.filter((v) => /legalOpinion|parecerJuridico|parecer\./i.test(v.name))).toEqual([]);
    expect(JSON.stringify(r2Catalog.vars.map((v) => v.requiredWhen ?? null))).not.toMatch(/legalOpinion|parecerJuridico|parecer\./i);
  });
});

describe("RECOMPOSIÇÃO — capability derivada da SEMÂNTICA do catálogo + classificação do rascunho composto", () => {
  it("CAP — Revisão 1 (sem completionPolicy) NÃO tem a capability; Revisão 2 (DEFERRED_PUBLICATION) TEM; nunca por número/versão", () => {
    expect(supportsGovernedDraftRecomposition(bllCatalog)).toBe(false);
    expect(supportsGovernedDraftRecomposition(r2Catalog)).toBe(true);
    expect(supportsGovernedDraftRecomposition({ vars: [] })).toBe(false);
    // derivada SÓ do metadado: remover o metadado de uma cópia do catálogo da Revisão 2 desliga a capability, e adicioná-lo à Revisão 1 liga
    const stripped = { ...r2Catalog, vars: r2Catalog.vars.map((v) => { const { completionPolicy: _c, ...rest } = v as Record<string, unknown>; return rest; }) };
    expect(supportsGovernedDraftRecomposition(stripped as never)).toBe(false);
    expect(supportsGovernedDraftRecomposition({ ...bllCatalog, vars: [...bllCatalog.vars, { completionPolicy: "DEFERRED_PUBLICATION" }] } as never)).toBe(true);
  });
  it("CAP — o código da capability não referencia número de revisão nem versão lógica", () => {
    const src = ["server/domain/institutionalTemplates/variableCatalog2.ts", "server/services/institutionalTemplates/templateCompositionService.ts"]
      .map((f) => readFileSync(path.resolve(f), "utf8")).join("\n");
    expect(src).not.toMatch(/1\.0\.2-draft|revisionNumber\s*===|revision\.revision\s*===\s*2|\.c3/);
  });
  const doc = { content: "texto composto", sources: ["origem:template", "tpl-m1:m1"] };
  const edit = (operation: string, content = doc.content) => ({ operation, actorUserId: 1, newContentHash: draftContentHash(content), createdAt: "2026-10-12T00:00:00Z" });
  it("composição do sistema (template_compose) com hash igual ao último do ledger NÃO é conteúdo humano — só no classificador de modelo", () => {
    expect(classifyTemplateDraftHumanState(doc, edit("template_compose")).human).toBe(false);
    expect(classifyDraftHumanState(doc, edit("template_compose")).human).toBe(true);        // classificador legado INALTERADO
  });
  it("edição humana posterior, ou conteúdo divergente do ledger, é conteúdo humano (nunca sobrescrever em silêncio)", () => {
    expect(classifyTemplateDraftHumanState(doc, edit("human_edit")).human).toBe(true);
    expect(classifyTemplateDraftHumanState({ ...doc, content: "outro texto" }, edit("template_compose")).human).toBe(true);
  });
});
