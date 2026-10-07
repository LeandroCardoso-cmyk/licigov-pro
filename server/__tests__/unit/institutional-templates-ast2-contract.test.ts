/**
 * Institutional Templates — contrato `tpl-ast/2` + `tpl-catalog/2` (domínio puro): replay v1 INTACTO, validação v2, catálogo v2,
 * DSL v2, valores canônicos e controles não renderizáveis. Fixture SINTÉTICA.
 */
import { describe, expect, it } from "vitest";
import {
  computeManifestHash, validateAnyCatalog, validateAnyTemplateAst, validateCondition2, validateVariableCatalog2, validateTemplateAst2,
  evaluateCondition2, referencedVariables2, templateRequirements2, VARIABLE_TYPES_2, VARIABLE_SOURCES_2,
  type TemplateAST2, type VariableCatalog2, type Cond2,
} from "../../domain/institutionalTemplates";
import { revisionSemanticHash } from "../../domain/institutionalTemplates/semanticHash";
import { composeTemplate } from "../../domain/institutionalTemplates/composer";
import { TEMPLATE_CATALOG_V1 } from "../../services/institutionalTemplates/catalogRegistry";
import {
  formatCnpj, formatDuration, formatScalar, isValidCnpjDigits, normalizeScalar, normalizeValue2,
} from "../../domain/institutionalTemplates/valueTypes2";
import { composeRequest, publishedRevision } from "../helpers/institutionalTemplatesFixture";
import { ast2, catalog2 } from "../helpers/institutionalTemplatesV2Fixture";

const codes = (r: { ok: boolean; issues?: readonly { code: string }[] }): string[] => (r.ok ? [] : (r.issues ?? []).map((i) => i.code));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const withRoot = (root: unknown[]): unknown => ({ schema: "tpl-ast/2", root });

describe("replay v1 — semântica de hash e composição INALTERADAS (goldens capturados do commit base)", () => {
  it("revisão publicada v1: hash semântico, hash de saída, hash do manifest e id do M1 idênticos aos do commit base", () => {
    const rev = publishedRevision();
    expect(rev.semanticHash).toBe("70710e132c69739a0a4812724779768990eed5b7a4f79afbb702a1fd670a915e");
    const r = composeTemplate(composeRequest());
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.value.manifest.composedOutputHash).toBe("aeac129bad1dd0f9237faeea16a9c1634e20b33aa48ad917a722aa0af8dbf6bf");
    expect(computeManifestHash(r.value.manifest)).toBe("04290ce2bdcecec3e3f9263c51c5f6724ce4108d74985cc856f095df029e12ab");
    expect(r.value.manifest.id).toBe("tplm1_c9fa121ec8ad395742");
  });

  it("AST v1 vazia e catálogo de produção tpl-catalog/1 não mudam", () => {
    expect(revisionSemanticHash({ ast: { schema: "tpl-ast/1", root: [] }, variableCatalogVersion: "tpl-catalog/1" }))
      .toBe("4a3199eaad14878d9b84821dbfe24ec8f0875eaf4ea2a0965088c0360a4916dc");
    expect(TEMPLATE_CATALOG_V1.version).toBe("tpl-catalog/1");
    expect(TEMPLATE_CATALOG_V1.vars).toHaveLength(12);
  });

  it("o despachante usa o validador v1 para AST v1 e recusa o cruzamento de versões (CATALOG_FORMAT_MISMATCH)", () => {
    const v1 = { schema: "tpl-ast/1", root: [{ t: "paragraph", inline: [{ t: "var", name: "processo.numero" }] }] };
    expect(validateAnyTemplateAst(v1, TEMPLATE_CATALOG_V1).ok).toBe(true);
    expect(codes(validateAnyTemplateAst(v1, catalog2))).toEqual(["CATALOG_FORMAT_MISMATCH"]);
    expect(codes(validateAnyTemplateAst(ast2, TEMPLATE_CATALOG_V1))).toEqual(["CATALOG_FORMAT_MISMATCH"]);
    expect(codes(validateAnyTemplateAst({ schema: "tpl-ast/9", root: [] }, TEMPLATE_CATALOG_V1))).toEqual(["AST_VERSION_UNSUPPORTED"]);
  });

  it("um nó exclusivo de v2 jamais é aceito por uma AST declarada v1", () => {
    const sneaky = { schema: "tpl-ast/1", root: [{ t: "annex", id: "a", role: "r", order: 1, title: [], children: [] }] };
    expect(validateAnyTemplateAst(sneaky, TEMPLATE_CATALOG_V1).ok).toBe(false);
  });
});

describe("catálogo v2", () => {
  it("o catálogo de fixture é válido e cobre os 17 tipos e as 13 fontes", () => {
    expect(validateVariableCatalog2(catalog2).ok).toBe(true);
    expect(new Set(catalog2.vars.map((v) => v.type))).toEqual(new Set(VARIABLE_TYPES_2));
    expect(new Set(catalog2.vars.map((v) => v.source))).toEqual(new Set(VARIABLE_SOURCES_2));
    expect(VARIABLE_TYPES_2).toHaveLength(17);
    expect(VARIABLE_SOURCES_2).toHaveLength(13);
  });

  it("recusa tipo/fonte desconhecidos, enum sem valores, tabela sem colunas, nome duplicado e path inválido", () => {
    const mk = (v: Record<string, unknown>): unknown => ({ ...clone(catalog2), vars: [{ name: "x.y", type: "string", source: "PROCESS", path: "p", required: false, renderable: true, ...v }] });
    for (const bad of [{ type: "blob" }, { source: "GENERIC_BAG" }, { type: "enum" }, { type: "table" }, { path: "a..b" }, { type: "list" }, { type: "document_ref" }]) {
      expect(validateAnyCatalog(mk(bad) as VariableCatalog2).ok, JSON.stringify(bad)).toBe(false);
    }
    const dup = clone(catalog2);
    dup.vars.push(dup.vars[0]);
    expect(validateVariableCatalog2(dup).ok).toBe(false);
  });

  it("controle (renderable=false) não pode ser tabela, lista nem referência a documento", () => {
    for (const type of ["table", "list", "document_ref"] as const) {
      const c = clone(catalog2);
      const target = c.vars.find((v) => v.type === type)!;
      (target as { renderable: boolean }).renderable = false;
      expect(validateVariableCatalog2(c).ok, type).toBe(false);
    }
  });

  it("requiredWhen: referência desconhecida, auto-referência, ciclo e variável já obrigatória são recusados", () => {
    const base = clone(catalog2);
    const ctl = base.vars.find((v) => v.name === "controle.dataDivulgacao")!;
    (ctl as { requiredWhen?: Cond2 }).requiredWhen = { op: "eq", var: "nao.existe", value: "SIM" };
    expect(validateVariableCatalog2(base).ok).toBe(false);
    (ctl as { requiredWhen?: Cond2 }).requiredWhen = { op: "present", var: "controle.dataDivulgacao" };
    expect(validateVariableCatalog2(base).ok).toBe(false);
    const cyc = clone(catalog2);
    const a = cyc.vars.find((v) => v.name === "processo.fator")!;
    const b = cyc.vars.find((v) => v.name === "processo.numeroLotes")!;
    (a as { requiredWhen?: Cond2 }).requiredWhen = { op: "present", var: "processo.numeroLotes" };
    (b as { requiredWhen?: Cond2 }).requiredWhen = { op: "present", var: "processo.fator" };
    expect(validateVariableCatalog2(cyc).ok).toBe(false);
    const req = clone(catalog2);
    (req.vars.find((v) => v.name === "controle.utilizaSrp") as { requiredWhen?: Cond2 }).requiredWhen = { op: "present", var: "processo.numero" };
    expect(validateVariableCatalog2(req).ok).toBe(false);
  });

  it("os 3 controles do Edital piloto são não renderizáveis; as demais variáveis do fixture são renderizáveis", () => {
    const controls = catalog2.vars.filter((v) => !v.renderable).map((v) => v.name).sort();
    expect(controls).toEqual(["controle.dataDivulgacao", "controle.orcamentoSigiloso", "controle.utilizaSrp"]);
    expect(catalog2.vars.filter((v) => v.renderable)).toHaveLength(catalog2.vars.length - 3);
  });
});

describe("AST v2 — validação", () => {
  it("a AST de fixture é válida e exige/expõe variáveis, docRefs, aiSlots e anexos", () => {
    const r = validateTemplateAst2(ast2, catalog2);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const vars = referencedVariables2(ast2);
    expect(vars).toContain("controle.utilizaSrp"); // controle usado em condição
    expect(vars).toContain("controle.dataDivulgacao"); // controle referenciado só em condição (requiredWhen vale)
    const req = templateRequirements2(ast2.root);
    expect(req.aiSlots).toEqual(["justificativa"]);
    expect(req.docRefs.map((d) => d.role)).toEqual(expect.arrayContaining(["termo-referencia", "anexo-tr-ref"]));
    expect(req.annexes.map((a) => a.id).sort()).toEqual(["anexo-modelo", "anexo-tr"]);
  });

  it("variável de controle em texto ⇒ CONTROL_ONLY_VARIABLE_RENDERED (parágrafo, título, tabela, cabeçalho de dataTable)", () => {
    const para = withRoot([{ t: "paragraph", inline: [{ t: "var", name: "controle.utilizaSrp" }] }]);
    const head = withRoot([{ t: "heading", level: 1, text: [{ t: "var", name: "controle.orcamentoSigiloso" }] }]);
    const tbl = withRoot([{ t: "table", header: [[{ t: "text", v: "A" }]], rows: [[[{ t: "var", name: "controle.utilizaSrp" }]]] }]);
    const dt = withRoot([{ t: "dataTable", tableKey: "q", source: "itens.quadro", columns: [{ key: "item", header: [{ t: "var", name: "controle.utilizaSrp" }] }] }]);
    for (const ast of [para, head, tbl, dt]) expect(codes(validateTemplateAst2(ast, catalog2))).toContain("CONTROL_ONLY_VARIABLE_RENDERED");
  });

  it("variável de controle é permitida em condição, choice e requiredWhen", () => {
    const ok = withRoot([
      { t: "conditional", when: { op: "and", of: [{ op: "eq", var: "controle.utilizaSrp", value: true }, { op: "present", var: "controle.dataDivulgacao" }] }, then: [{ t: "paragraph", inline: [{ t: "text", v: "x" }] }] },
    ]);
    expect(validateTemplateAst2(ok, catalog2).ok).toBe(true);
  });

  it("variável de tabela jamais em texto inline; dataTable só liga variável do tipo table com colunas do esquema", () => {
    const inline = withRoot([{ t: "paragraph", inline: [{ t: "var", name: "itens.quadro" }] }]);
    expect(codes(validateTemplateAst2(inline, catalog2))).toContain("TABLE_BINDING_INVALID");
    const notTable = withRoot([{ t: "dataTable", tableKey: "q", source: "processo.numero", columns: [{ key: "item", header: [{ t: "text", v: "I" }] }] }]);
    expect(codes(validateTemplateAst2(notTable, catalog2))).toContain("TABLE_BINDING_INVALID");
    const badCol = withRoot([{ t: "dataTable", tableKey: "q", source: "itens.quadro", columns: [{ key: "inexistente", header: [{ t: "text", v: "I" }] }] }]);
    expect(codes(validateTemplateAst2(badCol, catalog2))).toContain("TABLE_BINDING_INVALID");
    const unknown = withRoot([{ t: "dataTable", tableKey: "q", source: "nao.existe", columns: [] }]);
    expect(validateTemplateAst2(unknown, catalog2).ok).toBe(false);
  });

  it("xref: alvo desconhecido e alvo não numerado são recusados; âncora duplicada também", () => {
    const unk = withRoot([{ t: "paragraph", inline: [{ t: "xref", target: "nao.existe" }] }]);
    expect(codes(validateTemplateAst2(unk, catalog2))).toContain("XREF_TARGET_UNKNOWN");
    const notNum = withRoot([
      { t: "paragraph", anchor: undefined, inline: [{ t: "text", v: "a" }] },
      { t: "section", key: "s.nao", numbering: "none", children: [{ t: "paragraph", inline: [{ t: "xref", target: "s.nao" }] }] },
    ]);
    expect(validateTemplateAst2(notNum, catalog2).ok).toBe(false);
    const dup = withRoot([
      { t: "paragraph", numbered: true, anchor: "a.b", inline: [{ t: "text", v: "1" }] },
      { t: "paragraph", numbered: true, anchor: "a.b", inline: [{ t: "text", v: "2" }] },
    ]);
    expect(codes(validateTemplateAst2(dup, catalog2))).toContain("ANCHOR_DUPLICATE");
    const anchorNoNum = withRoot([{ t: "paragraph", anchor: "a.b", inline: [{ t: "text", v: "1" }] }]);
    expect(validateTemplateAst2(anchorNoNum, catalog2).ok).toBe(false);
  });

  it("anexo: id/role/order únicos, só na raiz, conteúdo não vazio", () => {
    const annex = (id: string, role: string, order: number) => ({ t: "annex", id, role, order, title: [{ t: "text", v: "T" }], children: [{ t: "paragraph", inline: [{ t: "text", v: "x" }] }] });
    expect(validateTemplateAst2(withRoot([annex("a", "r1", 1), annex("b", "r2", 2)]), catalog2).ok).toBe(true);
    // id de anexo e âncora dividem o mesmo espaço de nomes (o id é alvo de xref) ⇒ ANCHOR_DUPLICATE
    expect(codes(validateTemplateAst2(withRoot([annex("a", "r1", 1), annex("a", "r2", 2)]), catalog2))).toContain("ANCHOR_DUPLICATE");
    for (const dup of [[annex("a", "r1", 1), annex("b", "r1", 2)], [annex("a", "r1", 1), annex("b", "r2", 1)]]) {
      expect(codes(validateTemplateAst2(withRoot(dup), catalog2))).toContain("ANNEX_INVALID");
    }
    const nested = withRoot([{ t: "section", key: "s", numbering: "none", children: [annex("a", "r", 1)] }]);
    expect(codes(validateTemplateAst2(nested, catalog2))).toContain("ANNEX_INVALID");
    const empty = withRoot([{ t: "annex", id: "a", role: "r", order: 1, title: [{ t: "text", v: "T" }], children: [] }]);
    expect(codes(validateTemplateAst2(empty, catalog2))).toContain("ANNEX_INVALID");
  });

  it("docRef: só EXACT_PINNED com role/order; 'latest' e modos desconhecidos são recusados; role/order únicos", () => {
    const ref = (over: Record<string, unknown>) => ({ t: "docRef", kind: "TR", mode: "EXACT_PINNED", role: "r1", order: 1, ...over });
    expect(validateTemplateAst2(withRoot([ref({})]), catalog2).ok).toBe(true);
    for (const bad of [{ mode: "LATEST" }, { mode: "latest" }, { mode: undefined }, { kind: "OUTRO" }, { role: "" }, { order: 0 }, { order: 1.5 }]) {
      expect(codes(validateTemplateAst2(withRoot([ref(bad)]), catalog2)), JSON.stringify(bad)).toContain("DOCREF_INVALID");
    }
    expect(codes(validateTemplateAst2(withRoot([ref({}), ref({ order: 2 })]), catalog2))).toContain("DOCREF_INVALID"); // role repetido
    expect(codes(validateTemplateAst2(withRoot([ref({}), ref({ role: "r2" })]), catalog2))).toContain("DOCREF_INVALID"); // order repetida
  });

  it("choice: ≥ 2 ramos, chaves únicas, modo conhecido", () => {
    const br = (key: string) => ({ key, when: { op: "eq", var: "controle.utilizaSrp", value: true }, children: [{ t: "paragraph", inline: [{ t: "text", v: key }] }] });
    expect(validateTemplateAst2(withRoot([{ t: "choice", groupKey: "g", mode: "exactly-one", branches: [br("a"), br("b")] }]), catalog2).ok).toBe(true);
    for (const bad of [
      { t: "choice", groupKey: "g", mode: "exactly-one", branches: [br("a")] },
      { t: "choice", groupKey: "g", mode: "exactly-one", branches: [br("a"), br("a")] },
      { t: "choice", groupKey: "g", mode: "any", branches: [br("a"), br("b")] },
    ]) expect(codes(validateTemplateAst2(withRoot([bad]), catalog2))).toContain("CHOICE_INVALID");
  });

  it("chaves desconhecidas e nós desconhecidos são recusados (esquema fechado) e o limite de profundidade vale", () => {
    expect(validateTemplateAst2(withRoot([{ t: "paragraph", inline: [], extra: 1 }]), catalog2).ok).toBe(false);
    expect(codes(validateTemplateAst2(withRoot([{ t: "script", code: "x" }]), catalog2))).toContain("AST_UNKNOWN_NODE");
    let node: unknown = { t: "paragraph", inline: [{ t: "text", v: "x" }] };
    for (let i = 0; i < 40; i++) node = { t: "section", key: `s${i}`, numbering: "none", children: [node] };
    expect(codes(validateTemplateAst2(withRoot([node]), catalog2))).toContain("AST_DEPTH_EXCEEDED");
  });

  it("seção numerada automática exige título", () => {
    const r = validateTemplateAst2(withRoot([{ t: "section", key: "s", numbering: "auto", children: [{ t: "paragraph", inline: [{ t: "text", v: "x" }] }] }]), catalog2);
    expect(r.ok).toBe(false);
  });
});

describe("DSL v2", () => {
  const v = (cond: unknown) => validateCondition2(cond, catalog2);
  it("aceita booleano, enum válido, comparadores numéricos e present/absent de qualquer tipo", () => {
    expect(v({ op: "eq", var: "controle.utilizaSrp", value: true })).toEqual([]);
    expect(v({ op: "eq", var: "controle.orcamentoSigiloso", value: "SIM" })).toEqual([]);
    expect(v({ op: "gte", var: "processo.numeroLotes", value: 2 })).toEqual([]);
    expect(v({ op: "present", var: "itens.quadro" })).toEqual([]);
    expect(v({ op: "absent", var: "tr.referencia" })).toEqual([]);
  });

  it("recusa operando de tipo errado, enum fora do conjunto, comparador em não numérico, 'in' em booleano e chaves extras", () => {
    for (const bad of [
      { op: "eq", var: "controle.utilizaSrp", value: "SIM" },
      { op: "eq", var: "controle.orcamentoSigiloso", value: "TALVEZ" },
      { op: "gt", var: "processo.numero", value: 1 },
      { op: "in", var: "controle.utilizaSrp", values: [true] },
      { op: "eq", var: "controle.utilizaSrp", value: true, extra: 1 },
      { op: "eq", var: "nao.existe", value: 1 },
      { op: "regex", var: "processo.numero", value: ".*" },
    ]) expect(v(bad).length, JSON.stringify(bad)).toBeGreaterThan(0);
  });

  it("profundidade máxima 4", () => {
    let c: unknown = { op: "present", var: "processo.numero" };
    for (let i = 0; i < 5; i++) c = { op: "not", of: c };
    expect(v(c).map((i) => i.code)).toContain("CONDITION_DEPTH_EXCEEDED");
  });

  it("avaliação pura com trilha determinística; ausente ⇒ falso para eq e verdadeiro para absent", () => {
    const facts = { "controle.utilizaSrp": true, "processo.numeroLotes": 3 };
    const a = evaluateCondition2({ op: "and", of: [{ op: "eq", var: "controle.utilizaSrp", value: true }, { op: "gte", var: "processo.numeroLotes", value: 3 }] }, facts);
    const b = evaluateCondition2({ op: "and", of: [{ op: "eq", var: "controle.utilizaSrp", value: true }, { op: "gte", var: "processo.numeroLotes", value: 3 }] }, facts);
    expect(a.result).toBe(true);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(evaluateCondition2({ op: "eq", var: "controle.orcamentoSigiloso", value: "SIM" }, {}).result).toBe(false);
    expect(evaluateCondition2({ op: "absent", var: "controle.orcamentoSigiloso" }, {}).result).toBe(true);
  });
});

describe("valores canônicos do catálogo v2", () => {
  it("normaliza e recusa por tipo (nunca 'conserta')", () => {
    expect(normalizeScalar("integer", 3).ok).toBe(true);
    expect(normalizeScalar("integer", 3.5).ok).toBe(false);
    expect(normalizeScalar("money", 2550).ok).toBe(true);
    expect(normalizeScalar("money", 25.5).ok).toBe(false); // dinheiro é centavo inteiro
    expect(normalizeScalar("boolean", "true").ok).toBe(false);
    expect(normalizeScalar("date", "2026-02-30").ok).toBe(false);
    expect(normalizeScalar("date", "2026-02-28").ok).toBe(true);
    expect(normalizeScalar("time", "24:00").ok).toBe(false);
    expect(normalizeScalar("datetime", "2026-11-05T09:30").ok).toBe(true);
    expect(normalizeScalar("url", "javascript:alert(1)").ok).toBe(false);
    expect(normalizeScalar("percent", Number.NaN).ok).toBe(false);
    expect(normalizeScalar("cnpj", "11.222.333/0001-81")).toEqual({ ok: true, value: "11222333000181" });
    expect(normalizeScalar("cnpj", "11.222.333/0001-80").ok).toBe(false);
    expect(isValidCnpjDigits("11111111111111")).toBe(false);
  });

  it("duração, enum, lista, tabela e referência a documento", () => {
    const def = (name: string) => catalog2.vars.find((x) => x.name === name)!;
    expect(normalizeValue2(def("certame.prazoVigencia"), { amount: 12, unit: "month" }).ok).toBe(true);
    expect(normalizeValue2(def("certame.prazoVigencia"), { amount: -1, unit: "month" }).ok).toBe(false);
    expect(normalizeValue2(def("certame.prazoVigencia"), { amount: 1, unit: "fortnight" }).ok).toBe(false);
    expect(normalizeValue2(def("certame.criterio"), "menor_preco").ok).toBe(true);
    expect(normalizeValue2(def("certame.criterio"), "outro").ok).toBe(false);
    expect(normalizeValue2(def("etp.lotes"), ["a", "b"]).ok).toBe(true);
    expect(normalizeValue2(def("etp.lotes"), ["a", 2]).ok).toBe(false);
    expect(normalizeValue2(def("itens.quadro"), [{ item: 1, descricao: "x", quantidade: 1, precoUnitario: 10 }]).ok).toBe(true);
    expect(normalizeValue2(def("itens.quadro"), [{ item: 1, descricao: "x", quantidade: 1 }]).ok).toBe(false); // coluna obrigatória
    expect(normalizeValue2(def("tr.referencia"), { documentId: "d", lineageId: "l", version: 1, contentHash: "a".repeat(64), title: "TR" }).ok).toBe(true);
    expect(normalizeValue2(def("tr.referencia"), { documentId: "d", version: 1 }).ok).toBe(false);
  });

  it("formatação pt-BR determinística", () => {
    expect(formatScalar("money", 3060000)).toBe("R$ 30.600,00");
    expect(formatScalar("percent", 5.5)).toBe("5,5%");
    expect(formatScalar("number", 1200)).toBe("1.200");
    expect(formatScalar("number", 500.5)).toBe("500,5");
    expect(formatScalar("boolean", true)).toBe("Sim");
    expect(formatScalar("date", "2026-11-05")).toBe("05/11/2026");
    expect(formatScalar("time", "09:30")).toBe("09h30");
    expect(formatScalar("datetime", "2026-11-05T09:30")).toBe("05/11/2026 às 09h30");
    expect(formatCnpj("11222333000181")).toBe("11.222.333/0001-81");
    expect(formatDuration({ amount: 1, unit: "month" })).toBe("1 mês");
    expect(formatDuration({ amount: 12, unit: "month" })).toBe("12 meses");
    expect(formatDuration({ amount: 5, unit: "businessDay" })).toBe("5 dias úteis");
    expect(formatDuration({ amount: 1, unit: "businessDay" })).toBe("1 dia útil");
  });
});

describe("hash semântico v2", () => {
  it("é estável, depende da AST e do catálogo e usa a mesma função de hash do v1", () => {
    const h = (a: TemplateAST2, c: VariableCatalog2): string => revisionSemanticHash({ ast: a, variableCatalogVersion: c.version });
    expect(h(ast2, catalog2)).toBe(h(clone(ast2), catalog2));
    const changed = clone(ast2);
    (changed.root[0] as { level: number }).level = 2;
    expect(h(changed, catalog2)).not.toBe(h(ast2, catalog2));
    expect(h(ast2, { ...catalog2, version: "cat-v2-fixture/2" })).not.toBe(h(ast2, catalog2));
  });
});
