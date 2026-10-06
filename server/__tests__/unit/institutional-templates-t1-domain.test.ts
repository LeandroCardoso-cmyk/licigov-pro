/**
 * Institutional Document Templates — T1 (domínio puro). Sem DB, sem rede, sem IA.
 * Fixture SINTÉTICA mínima (não reproduz o Modelo-Mestre nem texto jurídico).
 */
import { readdirSync, readFileSync } from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computeManifestHash, computeRevalidationResultHash, createDraftRevision, deriveIssuanceManifest, evaluateCondition,
  manifestRevisionIssues, MAX_AST_DEPTH, REVISION_STATUSES, resolveTemplateBinding, revisionDeletionIssues, revisionSemanticHash, revisionUpdateIssues,
  sameOrganizationIssues, sealGenerationManifest, templateCanonicalJson, transitionRevision, validateCondition,
  validateManifest, validateTemplateAst, validateTemplateIdentity, validateVariableCatalog,
  type CanonicalRevalidationRecord, type Cond, type GenerationManifest, type TemplateAST, type TemplateBinding,
  type TemplateIdentity, type TemplateRevision, type VariableCatalog,
} from "../../domain/institutionalTemplates";

const ORG_A = 960901;
const ORG_B = 960902;
const H = (c: string): string => c.repeat(64).slice(0, 64);

const catalog: VariableCatalog = {
  version: "cat-test/1",
  vars: [
    { name: "processo.numero", type: "string", source: "PROCESS", path: "number", required: true },
    { name: "objeto", type: "string", source: "TR", path: "object", required: true },
    { name: "srp", type: "enum", source: "PARAMS", path: "srp", required: true },
    { name: "valorEstimado", type: "money", source: "ITEMS", path: "estimatedTotalCents", required: false },
  ],
};

const ast: TemplateAST = {
  schema: "tpl-ast/1",
  root: [
    { t: "heading", level: 1, text: [{ t: "text", v: "Edital nº " }, { t: "var", name: "processo.numero" }] },
    { t: "section", key: "objeto", children: [{ t: "paragraph", inline: [{ t: "var", name: "objeto" }] }] },
    { t: "conditional", when: { op: "eq", var: "srp", value: "SIM" }, then: [{ t: "paragraph", inline: [{ t: "text", v: "Bloco SRP." }] }] },
    { t: "docRef", kind: "TR", mode: "EXACT_PINNED" },
    { t: "annex", id: "anexo-i", title: [{ t: "text", v: "Anexo I" }], children: [{ t: "docRef", kind: "TR", mode: "EXACT_PINNED" }] },
    { t: "aiSlot", slotKey: "justificativa", maxTokens: 800, instructionsKey: "edital.justificativa" },
  ],
};

const identity: TemplateIdentity = {
  id: "tplid_a1", organizationId: ORG_A, documentKind: "edital", slug: "edital-pregao", createdAt: "2026-10-01T00:00:00Z", createdByUserId: 7,
};

function draft(over: Partial<{ id: string; ast: TemplateAST; identity: TemplateIdentity }> = {}): TemplateRevision {
  const r = createDraftRevision({ id: over.id ?? "tplrev_a1", identity: over.identity ?? identity, revision: 1, ast: over.ast ?? ast, catalog, sourceFormat: "NATIVE" });
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}

function published(id = "tplrev_a1"): TemplateRevision {
  const a = transitionRevision(draft({ id }), { to: "APPROVED", approvalDecisionId: "dec_approve" }, identity, catalog);
  if (!a.ok) throw new Error(JSON.stringify(a.issues));
  const p = transitionRevision(a.value, { to: "PUBLISHED", publishDecisionId: "dec_publish" }, identity, catalog);
  if (!p.ok) throw new Error(JSON.stringify(p.issues));
  return p.value;
}

const codes = (r: { ok: boolean; issues?: readonly { code: string }[] }): string[] => (r.ok ? [] : (r.issues ?? []).map((i) => i.code));

describe("tenant identity", () => {
  it("organizationId é obrigatório (sem NULL = global, sem PLATFORM_GLOBAL)", () => {
    expect(validateTemplateIdentity(identity).ok).toBe(true);
    for (const bad of [null, undefined, 0, -1, 1.5, "960901"]) {
      expect(codes(validateTemplateIdentity({ ...identity, organizationId: bad as unknown as number }))).toContain("ORGANIZATION_REQUIRED");
    }
  });

  it("relação entre organizações diferentes é sempre CROSS_TENANT_REFERENCE", () => {
    expect(sameOrganizationIssues({ organizationId: ORG_A }, { organizationId: ORG_A }, "x")).toEqual([]);
    expect(sameOrganizationIssues({ organizationId: ORG_A }, { organizationId: ORG_B }, "x").map((i) => i.code)).toEqual(["CROSS_TENANT_REFERENCE"]);
  });

  it("revisão de outra organização não se associa à identidade", () => {
    const foreign = { ...draft(), organizationId: ORG_B };
    const r = transitionRevision(foreign, { to: "APPROVED", approvalDecisionId: "d1" }, identity, catalog);
    expect(codes(r)).toContain("CROSS_TENANT_REFERENCE");
  });
});

describe("revision state contracts", () => {
  it("toda revisão nova nasce DRAFT; import nunca nasce publicado", () => {
    expect(draft().status).toBe("DRAFT");
    const r = createDraftRevision({ id: "tplrev_x", identity, revision: 1, ast, catalog, sourceFormat: "DOCX_IMPORT", requestedStatus: "PUBLISHED" });
    expect(codes(r)).toEqual(["IMPORT_MUST_START_AS_DRAFT"]);
  });

  it("APPROVED ≠ PUBLISHED: não existe DRAFT → PUBLISHED e cada passo exige a sua decisão", () => {
    const d = draft();
    expect(codes(transitionRevision(d, { to: "PUBLISHED", publishDecisionId: "p" }, identity, catalog))).toEqual(["REVISION_TRANSITION_INVALID"]);
    expect(codes(transitionRevision(d, { to: "APPROVED", approvalDecisionId: "" }, identity, catalog))).toEqual(["DECISION_REQUIRED"]);
    const a = transitionRevision(d, { to: "APPROVED", approvalDecisionId: "dec_1" }, identity, catalog);
    expect(a.ok && a.value.status).toBe("APPROVED");
    if (!a.ok) return;
    expect(codes(transitionRevision(a.value, { to: "PUBLISHED", publishDecisionId: "dec_1" }, identity, catalog))).toEqual(["DECISION_REQUIRED"]);
    const p = transitionRevision(a.value, { to: "PUBLISHED", publishDecisionId: "dec_2" }, identity, catalog);
    expect(p.ok && p.value.status).toBe("PUBLISHED");
  });

  it("PUBLISHED → DEPRECATED; DEPRECATED é terminal", () => {
    const r = transitionRevision(published(), { to: "DEPRECATED" }, identity, catalog);
    expect(r.ok && r.value.status).toBe("DEPRECATED");
    if (!r.ok) return;
    for (const to of ["APPROVED", "PUBLISHED", "DEPRECATED"] as const) {
      const t = to === "APPROVED" ? { to, approvalDecisionId: "x" } : to === "PUBLISHED" ? { to, publishDecisionId: "y" } : { to };
      expect(codes(transitionRevision(r.value, t, identity, catalog))).toEqual(["REVISION_TRANSITION_INVALID"]);
    }
  });

  it("estado aprovado/publicado sem decisão registrada é inválido", () => {
    const forged = { ...draft(), status: "PUBLISHED" as const };
    const r = transitionRevision(forged, { to: "DEPRECATED" }, identity, catalog);
    expect(codes(r)).toEqual(expect.arrayContaining(["DECISION_REQUIRED"]));
  });
});

describe("lifecycle canônico (decisão R-5)", () => {
  it("o lifecycle é exatamente DRAFT → APPROVED → PUBLISHED → DEPRECATED", () => {
    expect(REVISION_STATUSES).toEqual(["DRAFT", "APPROVED", "PUBLISHED", "DEPRECATED"]);
  });

  it("estado fora do lifecycle (ex.: sinônimo RETIRED ou IN_REVIEW) é recusado", () => {
    for (const status of ["RETIRED", "IN_REVIEW"]) {
      const forged = { ...published(), status } as unknown as TemplateRevision;
      expect(codes(transitionRevision(forged, { to: "DEPRECATED" }, identity, catalog))).toContain("REVISION_TRANSITION_INVALID");
      const viaApproval = { ...draft(), status } as unknown as TemplateRevision;
      expect(codes(transitionRevision(viaApproval, { to: "APPROVED", approvalDecisionId: "d" }, identity, catalog))).toContain("REVISION_TRANSITION_INVALID");
    }
  });

  it("DEPRECATED ≠ INVALID: revisão depreciada continua válida para manifests históricos", () => {
    const dep = transitionRevision(published(), { to: "DEPRECATED" }, identity, catalog);
    if (!dep.ok) throw new Error("fixture");
    const m = sealGenerationManifest({
      stage: "GENERATION", id: "man_h1", organizationId: ORG_A, generatedDocumentId: "gd_h1",
      templateIdentityId: identity.id, templateRevisionId: dep.value.id, templateSemanticHash: dep.value.semanticHash,
      hashVersion: "tpl-hash/1", catalogVersion: catalog.version, sources: [], officialDocRefs: [], conditionalDecisions: [],
      aiNarratives: [], annexes: [], identityFingerprint: "ifp_h", composedOutputHash: H("4"), createdAt: "2026-10-01T00:00:00Z",
    });
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(manifestRevisionIssues(m.value, dep.value)).toEqual([]);
    expect(revisionDeletionIssues(dep.value, 1).map((i) => i.code)).toEqual(["REVISION_IN_USE"]);
  });
});

describe("immutability rules", () => {
  const changedAst: TemplateAST = { ...ast, root: [...ast.root, { t: "paragraph", inline: [{ t: "text", v: "novo" }] }] };

  it("revisão PUBLISHED recusa mudança de conteúdo; mudança = nova revisão", () => {
    const p = published();
    const after = { ...p, ast: changedAst, semanticHash: revisionSemanticHash({ ast: changedAst, variableCatalogVersion: catalog.version }) };
    expect(revisionUpdateIssues(p, after).map((i) => i.code)).toEqual(expect.arrayContaining(["REVISION_IMMUTABLE"]));
  });

  it("DRAFT aceita mudança de conteúdo; identidade e tenant nunca mudam", () => {
    const d = draft();
    expect(revisionUpdateIssues(d, { ...d, ast: changedAst })).toEqual([]);
    expect(revisionUpdateIssues(d, { ...d, organizationId: ORG_B }).map((i) => i.code)).toContain("CROSS_TENANT_REFERENCE");
    expect(revisionUpdateIssues(d, { ...d, revision: 2 }).map((i) => i.code)).toContain("REVISION_IMMUTABLE");
    expect(revisionUpdateIssues(d, { ...d, status: "PUBLISHED" }).map((i) => i.code)).toContain("REVISION_TRANSITION_INVALID");
  });

  it("revisão usada por manifest nunca é removida; contagem desconhecida falha fechado", () => {
    expect(revisionDeletionIssues(draft(), 0)).toEqual([]);
    expect(revisionDeletionIssues(draft(), 3).map((i) => i.code)).toEqual(["REVISION_IN_USE"]);
    expect(revisionDeletionIssues(draft(), Number.NaN).map((i) => i.code)).toEqual(["REVISION_IN_USE"]);
  });
});

describe("AST whitelist", () => {
  const withRoot = (root: unknown[]): unknown => ({ schema: "tpl-ast/1", root });

  it("AST válido passa", () => {
    expect(validateTemplateAst(ast, catalog).ok).toBe(true);
  });

  it.each([
    ["nó desconhecido", [{ t: "script", code: "alert(1)" }], "AST_UNKNOWN_NODE"],
    ["referência externa (fetch/link)", [{ t: "include", href: "https://exemplo.invalid/x" }], "AST_UNKNOWN_NODE"],
    ["tipo herdado do protótipo", [{ t: "constructor" }], "AST_UNKNOWN_NODE"],
    ["inline desconhecido", [{ t: "paragraph", inline: [{ t: "html", v: "<b>x</b>" }] }], "AST_UNKNOWN_NODE"],
    ["propriedade extra (fonte declarada pelo template)", [{ t: "paragraph", inline: [{ t: "var", name: "objeto", source: "ITEMS" }] }], "AST_INVALID"],
    ["função como valor", [{ t: "paragraph", inline: [{ t: "text", v: () => "x" }] }], "AST_INVALID"],
    ["docRef sem pin exato", [{ t: "docRef", kind: "TR", mode: "LATEST" }], "AST_INVALID"],
    ["render mode no docRef", [{ t: "docRef", kind: "TR", mode: "EXACT_PINNED", renderMode: "EMBEDDED" }], "AST_INVALID"],
    ["nível de título fora da faixa", [{ t: "heading", level: 5, text: [] }], "AST_INVALID"],
    ["slot de IA duplicado", [
      { t: "aiSlot", slotKey: "s1", maxTokens: 10, instructionsKey: "k" },
      { t: "aiSlot", slotKey: "s1", maxTokens: 10, instructionsKey: "k" },
    ], "AST_INVALID"],
  ])("rejeita %s", (_label, root, code) => {
    expect(codes(validateTemplateAst(withRoot(root as unknown[]), catalog))).toContain(code);
  });

  it("schema desconhecido e propriedades extras na raiz são rejeitados", () => {
    expect(codes(validateTemplateAst({ schema: "tpl-ast/2", root: [] }, catalog))).toEqual(["AST_INVALID"]);
    expect(codes(validateTemplateAst({ schema: "tpl-ast/1", root: [], eval: "x" }, catalog))).toEqual(["AST_INVALID"]);
    expect(codes(validateTemplateAst(JSON.parse('{"schema":"tpl-ast/1","root":[],"__proto__":{"x":1}}'), catalog))).toEqual(["AST_INVALID"]);
  });

  it("abuso de profundidade é rejeitado (MAX_AST_DEPTH: guarda técnica, não regra jurídica)", () => {
    expect(MAX_AST_DEPTH).toBe(32);
    let node: unknown = { t: "paragraph", inline: [{ t: "text", v: "x" }] };
    for (let i = 0; i < 40; i++) node = { t: "section", key: `s${i}`, children: [node] };
    expect(codes(validateTemplateAst(withRoot([node]), catalog))).toContain("AST_DEPTH_EXCEEDED");
  });

  it("texto que parece código é só literal (nunca executado)", () => {
    const r = validateTemplateAst(withRoot([{ t: "paragraph", inline: [{ t: "text", v: "${process.exit()} <script> SELECT 1; fetch('http://x')" }] }]), catalog);
    expect(r.ok).toBe(true);
  });
});

describe("variable validation", () => {
  it("catálogo é contrato versionado: nomes únicos, fonte e tipo do contrato", () => {
    expect(validateVariableCatalog(catalog).ok).toBe(true);
    const dup = { ...catalog, vars: [...catalog.vars, catalog.vars[0]] };
    expect(codes(validateVariableCatalog(dup))).toContain("CATALOG_INVALID");
    const badSource = { ...catalog, vars: [{ ...catalog.vars[0], source: "AI" as never }] };
    expect(codes(validateVariableCatalog(badSource))).toContain("CATALOG_INVALID");
    expect(codes(validateVariableCatalog({ ...catalog, version: "" }))).toContain("CATALOG_INVALID");
  });

  it("variável desconhecida falha fechado no texto e na condição", () => {
    const inText: TemplateAST = { schema: "tpl-ast/1", root: [{ t: "paragraph", inline: [{ t: "var", name: "quantidadeInventada" }] }] };
    expect(codes(validateTemplateAst(inText, catalog))).toEqual(["UNKNOWN_VARIABLE"]);
    const inCond: TemplateAST = { schema: "tpl-ast/1", root: [{ t: "conditional", when: { op: "present", var: "naoExiste" }, then: [] }] };
    expect(codes(validateTemplateAst(inCond, catalog))).toEqual(["UNKNOWN_VARIABLE"]);
  });

  it("variável desconhecida impede até a criação do DRAFT (import → AST candidato → validação → DRAFT)", () => {
    const bad: TemplateAST = { schema: "tpl-ast/1", root: [{ t: "paragraph", inline: [{ t: "var", name: "x.y" }] }] };
    const r = createDraftRevision({ id: "tplrev_b", identity, revision: 1, ast: bad, catalog, sourceFormat: "MARKDOWN_IMPORT" });
    expect(codes(r)).toContain("UNKNOWN_VARIABLE");
  });

  it("revisão avaliada contra outro catálogo é recusada", () => {
    const other = { ...catalog, version: "cat-test/2" };
    expect(codes(transitionRevision(draft(), { to: "APPROVED", approvalDecisionId: "d" }, identity, other))).toContain("CATALOG_VERSION_MISMATCH");
  });
});

describe("conditional DSL", () => {
  it.each([
    ["operador fora da DSL", { op: "regex", var: "objeto", value: ".*" }, "CONDITION_INVALID"],
    ["operador herdado do protótipo", { op: "constructor" }, "CONDITION_INVALID"],
    ["propriedade extra", { op: "eq", var: "srp", value: "SIM", fn: "x" }, "CONDITION_INVALID"],
    ["operando de tipo errado", { op: "eq", var: "valorEstimado", value: "100" }, "CONDITION_INVALID"],
    ["in vazio", { op: "in", var: "srp", values: [] }, "CONDITION_INVALID"],
    ["and vazio", { op: "and", of: [] }, "CONDITION_INVALID"],
    ["variável desconhecida", { op: "present", var: "nada" }, "UNKNOWN_VARIABLE"],
  ])("rejeita %s", (_l, cond, code) => {
    expect(validateCondition(cond, catalog).map((i) => i.code)).toContain(code);
  });

  it("profundidade > 4 é rejeitada", () => {
    let c: unknown = { op: "present", var: "srp" };
    for (let i = 0; i < 4; i++) c = { op: "not", of: c };
    expect(validateCondition(c, catalog).map((i) => i.code)).toEqual(["CONDITION_DEPTH_EXCEEDED"]);
    let ok4: unknown = { op: "present", var: "srp" };
    for (let i = 0; i < 3; i++) ok4 = { op: "not", of: ok4 };
    expect(validateCondition(ok4, catalog)).toEqual([]);
  });

  it("avaliação é pura, determinística e explicável (trilha completa, sem curto-circuito)", () => {
    const cond: Cond = { op: "or", of: [{ op: "eq", var: "srp", value: "SIM" }, { op: "in", var: "srp", values: ["NAO"] }, { op: "absent", var: "valorEstimado" }] };
    const facts = Object.freeze({ srp: "SIM", valorEstimado: 1000 });
    const a = evaluateCondition(cond, facts);
    const b = evaluateCondition(cond, facts);
    expect(a).toEqual(b);
    expect(a.result).toBe(true);
    expect(a.trace.map((s) => s.path)).toEqual(["when.of[0]", "when.of[1]", "when.of[2]", "when"]);
    expect(evaluateCondition({ op: "not", of: { op: "present", var: "srp" } }, { srp: "" }).result).toBe(true);
    expect(evaluateCondition({ op: "ne", var: "srp", value: "SIM" }, {}).result).toBe(true);
  });
});

describe("semantic hashing", () => {
  afterEach(() => vi.useRealTimers());

  it("mesmo AST semântico ⇒ mesmo hash, independente da ordem das chaves", () => {
    const reordered = JSON.parse(JSON.stringify(ast, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v)));
    expect(templateCanonicalJson(reordered)).toBe(templateCanonicalJson(ast));
    expect(revisionSemanticHash({ ast: reordered, variableCatalogVersion: "v" })).toBe(revisionSemanticHash({ ast, variableCatalogVersion: "v" }));
  });

  it("strings em NFC e -0 normalizados (tpl-hash/1)", () => {
    const nfc = "Licitação".normalize("NFC");
    const nfd = "Licitação".normalize("NFD");
    expect(nfc).not.toBe(nfd);
    expect(revisionSemanticHash({ ast: { s: nfc }, variableCatalogVersion: "v" })).toBe(revisionSemanticHash({ ast: { s: nfd }, variableCatalogVersion: "v" }));
    expect(templateCanonicalJson({ n: -0 })).toBe(templateCanonicalJson({ n: 0 }));
  });

  it("mudança semântica ⇒ hash muda (AST, catálogo, versão de hash)", () => {
    const base = revisionSemanticHash({ ast, variableCatalogVersion: "v1" });
    const changed: TemplateAST = { ...ast, root: ast.root.slice(1) };
    expect(revisionSemanticHash({ ast: changed, variableCatalogVersion: "v1" })).not.toBe(base);
    expect(revisionSemanticHash({ ast, variableCatalogVersion: "v2" })).not.toBe(base);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hash não depende do relógio", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
    const a = draft().semanticHash;
    vi.setSystemTime(new Date("2031-06-30T12:00:00Z"));
    expect(draft().semanticHash).toBe(a);
  });

  it("semanticHash adulterado é detectado", () => {
    const d = draft();
    expect(codes(transitionRevision({ ...d, semanticHash: H("a") }, { to: "APPROVED", approvalDecisionId: "d" }, identity, catalog))).toContain("HASH_INVALID");
  });
});

describe("binding determinístico e pin exato", () => {
  const req = { organizationId: ORG_A, documentKind: "edital" as const, scope: { modality: "pregao" }, asOf: "2026-10-05T12:00:00Z" };
  const binding = (over: Partial<TemplateBinding> = {}): TemplateBinding => ({
    id: "bind_1", organizationId: ORG_A, documentKind: "edital", scope: { modality: "pregao" }, identityId: identity.id,
    pinnedRevisionId: "tplrev_a1", active: true, effectiveFrom: "2026-10-01T00:00:00Z", ...over,
  });

  it("resolve para a revisão PUBLISHED exata", () => {
    const r = resolveTemplateBinding(req, [binding()], [published()]);
    expect(r.status).toBe("RESOLVED");
    expect(r.status === "RESOLVED" && r.revision.id).toBe("tplrev_a1");
  });

  it("sem pin: nunca 'última PUBLISHED' (INV-TPL-03) — falha fechada", () => {
    const r = resolveTemplateBinding(req, [binding({ pinnedRevisionId: undefined })], [published()]);
    expect(r.status === "INVALID" && r.issues.map((i) => i.code)).toEqual(["BINDING_REVISION_NOT_PINNED"]);
  });

  it("NOT_BOUND, AMBIGUOUS, vigência futura e escopo exato", () => {
    expect(resolveTemplateBinding(req, [], [published()]).status).toBe("NOT_BOUND");
    expect(resolveTemplateBinding(req, [binding({ effectiveFrom: "2026-12-01T00:00:00Z" })], [published()]).status).toBe("NOT_BOUND");
    expect(resolveTemplateBinding(req, [binding({ scope: { modality: "pregao", regime: "x" } })], [published()]).status).toBe("NOT_BOUND");
    expect(resolveTemplateBinding(req, [binding({ active: false })], [published()]).status).toBe("NOT_BOUND");
    const amb = resolveTemplateBinding(req, [binding({ id: "bind_2" }), binding({ id: "bind_1" })], [published()]);
    expect(amb).toEqual({ status: "AMBIGUOUS", bindingIds: ["bind_1", "bind_2"] });
  });

  it("revisão fixada não publicada ou de outra identidade é recusada", () => {
    const approved = transitionRevision(draft(), { to: "APPROVED", approvalDecisionId: "d" }, identity, catalog);
    if (!approved.ok) throw new Error("fixture");
    const r = resolveTemplateBinding(req, [binding()], [approved.value]);
    expect(r.status === "INVALID" && r.issues[0].code).toBe("BINDING_REVISION_NOT_PUBLISHED");
    const r2 = resolveTemplateBinding(req, [binding({ identityId: "outra" })], [published()]);
    expect(r2.status === "INVALID" && r2.issues[0].code).toBe("BINDING_INVALID");
  });

  it("binding ou revisão de outra organização ⇒ INVALID (nunca ignorado em silêncio)", () => {
    const r = resolveTemplateBinding(req, [binding({ organizationId: ORG_B })], [published()]);
    expect(r.status === "INVALID" && r.issues.map((i) => i.code)).toContain("CROSS_TENANT_REFERENCE");
    const r2 = resolveTemplateBinding(req, [binding()], [{ ...published(), organizationId: ORG_B }]);
    expect(r2.status === "INVALID" && r2.issues.map((i) => i.code)).toContain("CROSS_TENANT_REFERENCE");
  });

  it("asOf é input explícito em ISO-8601 UTC", () => {
    expect(resolveTemplateBinding({ ...req, asOf: "ontem" }, [binding()], [published()]).status).toBe("INVALID");
  });
});

describe("manifest validation, pin exato e replay", () => {
  const rev = published();
  const generationDraft = (): Omit<GenerationManifest, "manifestHash"> => ({
    stage: "GENERATION", id: "man_g1", organizationId: ORG_A, generatedDocumentId: "gd_1",
    templateIdentityId: identity.id, templateRevisionId: rev.id, templateSemanticHash: rev.semanticHash,
    hashVersion: "tpl-hash/1", catalogVersion: catalog.version,
    sources: [{ key: "tr", digest: "srcd:tr=abcdef123456" }, { key: "itens", digest: "srcd:itens=0123456789ab" }],
    officialDocRefs: [{ role: "ANEXO_I", order: 1, documentId: "od_tr1", lineageId: "lin_tr", version: 3, contentHash: H("1"), title: "Termo de Referência" }],
    conditionalDecisions: [{ nodePath: "root[2]", result: true, traceHash: H("2") }],
    aiNarratives: [{ slotKey: "justificativa", executionId: "exec_1", outputHash: H("3"), humanAccepted: true }],
    annexes: [{ id: "anexo-i", contentHash: H("1") }],
    identityFingerprint: "ifp_1", composedOutputHash: H("4"), createdAt: "2026-10-05T12:00:00Z",
  });
  const sealed = (): GenerationManifest => {
    const r = sealGenerationManifest(generationDraft());
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    return r.value;
  };
  const revalidation = (over: Partial<CanonicalRevalidationRecord> = {}): CanonicalRevalidationRecord => {
    const base: CanonicalRevalidationRecord = {
      status: "PASSED", validatorVersion: "canonical-revalidation/1",
      checkedAuthorities: [{ authority: "itens", sourceVersion: "3", sourceHash: H("5") }],
      protectedNodes: [{ nodeId: "itens-table", expectedFragmentHash: H("6"), found: true }],
      structuralDeviations: [], resultHash: "", checkedAt: "2026-10-06T09:00:00Z", ...over,
    };
    return { ...base, resultHash: computeRevalidationResultHash(base) };
  };

  it("M1 selado é válido e consistente com a revisão exata", () => {
    const m = sealed();
    expect(validateManifest(m).ok).toBe(true);
    expect(manifestRevisionIssues(m, rev)).toEqual([]);
  });

  it("replay: mesmo conteúdo semântico ⇒ mesmo manifestHash; id/createdAt fora do hash", () => {
    const a = sealed();
    const b = sealGenerationManifest({ ...generationDraft(), id: "man_outro", createdAt: "2030-01-01T00:00:00Z" });
    expect(b.ok && b.value.manifestHash).toBe(a.manifestHash);
  });

  it("adulteração do conteúdo ⇒ MANIFEST_HASH_MISMATCH", () => {
    const m = sealed();
    expect(codes(validateManifest({ ...m, composedOutputHash: H("9") }))).toContain("MANIFEST_HASH_MISMATCH");
  });

  it("referência oficial sem pin completo, com render mode, ou fonte sem srcd: é recusada", () => {
    const base = generationDraft();
    const noHash = sealGenerationManifest({ ...base, officialDocRefs: [{ ...base.officialDocRefs[0], contentHash: "" }] });
    expect(codes(noHash)).toContain("REFERENCE_NOT_PINNED");
    const withRender = sealGenerationManifest({ ...base, officialDocRefs: [{ ...base.officialDocRefs[0], renderMode: "EMBEDDED" } as never] });
    expect(codes(withRender)).toContain("MANIFEST_INVALID");
    const badSource = sealGenerationManifest({ ...base, sources: [{ key: "tr", digest: "latest" }] });
    expect(codes(badSource)).toContain("REFERENCE_NOT_PINNED");
  });

  it("manifest × revisão: outra organização, outra revisão ou hash divergente são recusados", () => {
    const m = sealed();
    expect(manifestRevisionIssues({ ...m, organizationId: ORG_B }, rev).map((i) => i.code)).toContain("CROSS_TENANT_REFERENCE");
    expect(manifestRevisionIssues({ ...m, templateRevisionId: "tplrev_zz" }, rev).map((i) => i.code)).toContain("REFERENCE_NOT_PINNED");
    expect(manifestRevisionIssues({ ...m, templateSemanticHash: H("8") }, rev).map((i) => i.code)).toContain("MANIFEST_HASH_MISMATCH");
    expect(manifestRevisionIssues(m, draft()).map((i) => i.code)).toContain("BINDING_REVISION_NOT_PUBLISHED");
  });

  it("M2 derivado: sem edição os hashes coincidem; M1 permanece intacto (insert-only)", () => {
    const m1 = sealed();
    const snapshot = JSON.stringify(m1);
    const m2 = deriveIssuanceManifest(m1, { id: "man_i1", createdAt: "2026-10-06T10:00:00Z", documentContentHash: m1.composedOutputHash, humanEditRefs: [], canonicalRevalidation: revalidation() });
    expect(m2.ok).toBe(true);
    expect(m2.ok && m2.value.derivedFromManifestId).toBe("man_g1");
    expect(JSON.stringify(m1)).toBe(snapshot);
  });

  it("edição humana: conteúdo emitido pode divergir do composto só com humanEditRefs que o expliquem", () => {
    const m1 = sealed();
    const edited = H("7");
    const semRef = deriveIssuanceManifest(m1, { id: "man_i2", createdAt: "x", documentContentHash: edited, humanEditRefs: [], canonicalRevalidation: revalidation() });
    expect(codes(semRef)).toContain("MANIFEST_INVALID");
    const comRef = deriveIssuanceManifest(m1, { id: "man_i2", createdAt: "x", documentContentHash: edited, humanEditRefs: [{ editRef: "edit_1", resultingContentHash: edited }], canonicalRevalidation: revalidation() });
    expect(comRef.ok).toBe(true);
  });

  it("revalidação canônica: checkedAt fora dos hashes; resultHash adulterado e desvio sem reconhecimento são recusados", () => {
    const m1 = sealed();
    const a = deriveIssuanceManifest(m1, { id: "i", createdAt: "x", documentContentHash: m1.composedOutputHash, humanEditRefs: [], canonicalRevalidation: revalidation() });
    const b = deriveIssuanceManifest(m1, { id: "i", createdAt: "x", documentContentHash: m1.composedOutputHash, humanEditRefs: [], canonicalRevalidation: revalidation({ checkedAt: "2031-01-01T00:00:00Z" }) });
    expect(a.ok && b.ok && a.value.manifestHash === b.value.manifestHash).toBe(true);
    expect(a.ok && b.ok && a.value.canonicalRevalidation.resultHash === b.value.canonicalRevalidation.resultHash).toBe(true);

    const tampered = { ...revalidation(), resultHash: H("e") };
    expect(codes(deriveIssuanceManifest(m1, { id: "i", createdAt: "x", documentContentHash: m1.composedOutputHash, humanEditRefs: [], canonicalRevalidation: tampered }))).toContain("MANIFEST_HASH_MISMATCH");

    const noAck = revalidation({ status: "PASSED_WITH_ACKNOWLEDGED_STRUCTURAL_DEVIATIONS", structuralDeviations: [{ blockId: "srp", kind: "INCLUDED_BLOCK_REMOVED", acknowledgmentRef: "" }] });
    expect(codes(deriveIssuanceManifest(m1, { id: "i", createdAt: "x", documentContentHash: m1.composedOutputHash, humanEditRefs: [], canonicalRevalidation: noAck }))).toContain("DECISION_REQUIRED");

    const failed = { ...revalidation(), status: "FAILED" as never };
    expect(codes(deriveIssuanceManifest(m1, { id: "i", createdAt: "x", documentContentHash: m1.composedOutputHash, humanEditRefs: [], canonicalRevalidation: { ...failed, resultHash: computeRevalidationResultHash(failed) } }))).toContain("MANIFEST_INVALID");
  });

  it("documento emitido não carrega narrativa de IA sem aceite humano", () => {
    const base = generationDraft();
    const m1 = sealGenerationManifest({ ...base, aiNarratives: [{ ...base.aiNarratives[0], humanAccepted: false }] });
    expect(m1.ok).toBe(true);
    if (!m1.ok) return;
    const m2 = deriveIssuanceManifest(m1.value, { id: "i", createdAt: "x", documentContentHash: m1.value.composedOutputHash, humanEditRefs: [], canonicalRevalidation: revalidation() });
    expect(codes(m2)).toContain("MANIFEST_INVALID");
  });

  it("computeManifestHash é estável entre chamadas", () => {
    const m = sealed();
    expect(computeManifestHash(m)).toBe(computeManifestHash(JSON.parse(JSON.stringify(m))));
  });
});

describe("arquitetura: domínio puro e fronteiras", () => {
  const dir = path.resolve(__dirname, "../../domain/institutionalTemplates");
  const sources = readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => ({ f, code: readFileSync(path.join(dir, f), "utf8") }));

  it("sem I/O, relógio, aleatoriedade, execução dinâmica ou IA", () => {
    const forbidden = [
      /from\s+["'](?:fs|path|http|https|net|child_process|node:[a-z_]+)["']/, /from\s+["'][^"']*(?:\/db|\/routers|\/services|_core|drizzle|storage|llm)[^"']*["']/,
      /Date\.now\s*\(/, /new Date\s*\(/, /Math\.random/, /randomUUID/, /\beval\s*\(/, /new Function\s*\(/, /\bfetch\s*\(/, /require\s*\(/,
    ];
    for (const { f, code } of sources) {
      for (const re of forbidden) expect({ f, hit: re.test(code) }).toEqual({ f, hit: false });
    }
  });

  it("sem orquestração de publicação nem dependência do /templates legado", () => {
    const outOfScope = /PNCPPublication|PublicationProfile|publishedAt|publicationUrl|numeroControlePNCP|publicationStatus|documentTemplateService|document_templates|PLATFORM_GLOBAL\s*[:=]/;
    for (const { f, code } of sources) expect({ f, hit: outOfScope.test(code) }).toEqual({ f, hit: false });
  });
});
