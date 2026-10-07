/**
 * Institutional Templates — extensões do `tpl-ast/2` exigidas pelo mestre real: condicional e aiSlot INLINE, alíneas e
 * sub-itens automáticos, sequência simples, cláusulas ordinais, âncora repetida só em ramos excludentes, colunas condicionais,
 * `controlRef`, `absentText` e duração em minutos. Fixture SINTÉTICA.
 */
import { describe, expect, it } from "vitest";
import {
  validateAnyTemplateAst, validateTemplateAst2, referencedVariables2, templateRequirements2,
  type TemplateAST2, type TemplateNode2, type VariableCatalog2,
} from "../../domain/institutionalTemplates";
import { composeTemplate, PENDING_AI_SLOT_MARK, type TemplateComposeRequest } from "../../domain/institutionalTemplates/composer";
import { alphaLabel, ordinalFeminine } from "../../domain/institutionalTemplates/composer2";
import { formatDuration, normalizeValue2 } from "../../domain/institutionalTemplates/valueTypes2";
import { validateVariableCatalog2 } from "../../domain/institutionalTemplates/variableCatalog2";
import { ORG_A, ROWS, canonicalSources2, catalog2, composeRequest2, publishedRevision2 } from "../helpers/institutionalTemplatesV2Fixture";

const codes = (r: { ok: boolean; issues?: readonly { code: string }[] }): string[] => (r.ok ? [] : (r.issues ?? []).map((i) => i.code));
const T = (v: string) => ({ t: "text", v }) as const;
const withRoot = (root: unknown[]): unknown => ({ schema: "tpl-ast/2", root });

const catalogX: VariableCatalog2 = {
  ...catalog2,
  vars: [
    ...catalog2.vars,
    { name: "x.prazo", type: "duration", source: "POLICY", path: "prazo", required: false, renderable: true, absentText: "a preencher" },
    { name: "x.nota", type: "string", source: "POLICY", path: "nota", required: false, renderable: true, absentText: "(a preencher)" },
    { name: "x.controleObrigatorio", type: "boolean", source: "POLICY", path: "obrigatorio", required: true, renderable: false },
  ],
};

function compose(root: TemplateNode2[], over: Partial<TemplateComposeRequest> = {}, sources = canonicalSources2(ORG_A, { POLICY: { secretBudget: "NAO", preferenceMargin: 5.5, obrigatorio: true, prazo: { amount: 30, unit: "minute" } } })) {
  const ast: TemplateAST2 = { schema: "tpl-ast/2", root };
  const v = validateAnyTemplateAst(ast, catalogX);
  if (!v.ok) throw new Error(JSON.stringify(v.issues));
  const revision = publishedRevision2({ ast, id: `tplrev_x${root.length}${JSON.stringify(root).length}`, catalog: catalogX });
  return composeTemplate(composeRequest2({ revision, catalog: catalogX, aiNarratives: [], sources, pin: { identityId: revision.identityId, revisionId: revision.id, semanticHash: revision.semanticHash }, ...over }));
}
const text = (r: ReturnType<typeof compose>): string => { if (!r.ok) throw new Error(JSON.stringify(r.issues)); return r.value.content.text; };

describe("validação das extensões", () => {
  it("condicional/aiSlot INLINE: condição validada pelo catálogo, slot único e variável de controle continua proibida em texto", () => {
    const ok = withRoot([{ t: "paragraph", inline: [T("a "), { t: "when", when: { op: "eq", var: "controle.utilizaSrp", value: true }, then: [T("b")] }, { t: "aiSlot", slotKey: "s1", maxTokens: 20, instructionsKey: "k.s1" }] }]);
    expect(validateTemplateAst2(ok, catalogX).ok).toBe(true);
    expect(codes(validateTemplateAst2(withRoot([{ t: "paragraph", inline: [{ t: "when", when: { op: "eq", var: "nao.existe", value: true }, then: [T("b")] }] }]), catalogX))).toContain("UNKNOWN_VARIABLE");
    expect(validateTemplateAst2(withRoot([{ t: "paragraph", inline: [{ t: "aiSlot", slotKey: "s1", maxTokens: 20, instructionsKey: "k" }, { t: "aiSlot", slotKey: "s1", maxTokens: 20, instructionsKey: "k" }] }]), catalogX).ok).toBe(false);
    expect(codes(validateTemplateAst2(withRoot([{ t: "paragraph", inline: [{ t: "when", when: { op: "present", var: "processo.numero" }, then: [{ t: "var", name: "controle.utilizaSrp" }] }] }]), catalogX))).toContain("CONTROL_ONLY_VARIABLE_RENDERED");
    const a: TemplateAST2 = ok as TemplateAST2;
    expect(referencedVariables2(a)).toContain("controle.utilizaSrp");
    expect(templateRequirements2(a.root).aiSlots).toEqual(["s1"]);
  });

  it("parágrafo: numbered booleano/alpha/seq e level limitado por tipo", () => {
    const p = (extra: Record<string, unknown>) => withRoot([{ t: "paragraph", inline: [T("x")], ...extra }]);
    for (const good of [{ numbered: true, level: 3 }, { numbered: "alpha", level: 2 }, { numbered: "seq" }, { numbered: "alpha" }]) expect(validateTemplateAst2(p(good), catalogX).ok, JSON.stringify(good)).toBe(true);
    for (const bad of [{ numbered: "roman" }, { numbered: "alpha", level: 3 }, { numbered: "seq", level: 2 }, { level: 2 }, { numbered: true, level: 4 }, { numbered: false, anchor: "a.b" }]) {
      expect(validateTemplateAst2(p(bad), catalogX).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("seção ordinal: exige numbering auto; labelPrefix só com style ordinal", () => {
    const sec = (extra: Record<string, unknown>) => withRoot([{ t: "section", key: "s", numbering: "auto", title: [T("T")], children: [{ t: "paragraph", inline: [T("x")] }], ...extra }]);
    expect(validateTemplateAst2(sec({ style: "ordinal", labelPrefix: "CLÁUSULA" }), catalogX).ok).toBe(true);
    expect(validateTemplateAst2(sec({ labelPrefix: "CLÁUSULA" }), catalogX).ok).toBe(false);
    expect(validateTemplateAst2(sec({ style: "roman" }), catalogX).ok).toBe(false);
    expect(validateTemplateAst2(withRoot([{ t: "section", key: "s", numbering: "none", style: "ordinal", children: [{ t: "paragraph", inline: [T("x")] }] }]), catalogX).ok).toBe(false);
  });

  it("a MESMA âncora só pode repetir em ramos que nunca coexistem (choice/condicional×senão)", () => {
    const para = (anchor: string) => ({ t: "paragraph", numbered: true, anchor, inline: [T("x")] });
    const cond = { op: "eq", var: "controle.utilizaSrp", value: true };
    const choice = { t: "choice", groupKey: "g", mode: "exactly-one", branches: [{ key: "a", when: cond, children: [para("dup")] }, { key: "b", when: { op: "eq", var: "controle.utilizaSrp", value: false }, children: [para("dup")] }] };
    expect(validateTemplateAst2(withRoot([choice]), catalogX).ok).toBe(true);
    expect(validateTemplateAst2(withRoot([{ t: "conditional", when: cond, then: [para("dup")], else: [para("dup")] }]), catalogX).ok).toBe(true);
    expect(codes(validateTemplateAst2(withRoot([{ t: "conditional", when: cond, then: [para("dup")] }, para("dup")]), catalogX))).toContain("ANCHOR_DUPLICATE");
    expect(codes(validateTemplateAst2(withRoot([{ t: "conditional", when: cond, then: [para("dup")] }, { t: "conditional", when: cond, then: [para("dup")] }]), catalogX))).toContain("ANCHOR_DUPLICATE");
  });

  it("coluna condicional da dataTable é validada; controlRef exige controle", () => {
    const dt = (col: Record<string, unknown>) => withRoot([{ t: "dataTable", tableKey: "q", source: "itens.quadro", columns: [{ key: "item", header: [T("Item")], ...col }] }]);
    expect(validateTemplateAst2(dt({ when: { op: "eq", var: "controle.utilizaSrp", value: true } }), catalogX).ok).toBe(true);
    expect(validateTemplateAst2(dt({ when: { op: "eq", var: "nao.existe", value: true } }), catalogX).ok).toBe(false);
    expect(validateTemplateAst2(withRoot([{ t: "controlRef", var: "controle.utilizaSrp" }]), catalogX).ok).toBe(true);
    expect(validateTemplateAst2(withRoot([{ t: "controlRef", var: "processo.numero" }]), catalogX).ok).toBe(false);
    expect(codes(validateTemplateAst2(withRoot([{ t: "controlRef", var: "nao.existe" }]), catalogX))).toContain("UNKNOWN_VARIABLE");
  });

  it("catálogo: absentText só em variável opcional e renderizável; duração aceita minutos", () => {
    expect(validateVariableCatalog2(catalogX).ok).toBe(true);
    const bad = { ...catalogX, vars: [...catalogX.vars, { name: "x.y", type: "string" as const, source: "POLICY" as const, path: "y", required: true, renderable: true, absentText: "a preencher" }] };
    expect(validateVariableCatalog2(bad).ok).toBe(false);
    expect(normalizeValue2(catalogX.vars.find((v) => v.name === "x.prazo")!, { amount: 15, unit: "minute" }).ok).toBe(true);
    expect(formatDuration({ amount: 1, unit: "minute" })).toBe("1 minuto");
    expect(formatDuration({ amount: 30, unit: "minute" })).toBe("30 minutos");
  });
});

describe("composição das extensões", () => {
  it("alíneas automáticas: restart a cada item decimal; condicional que remove uma alínea NÃO deixa lacuna; sub-alínea b.1)", () => {
    const item = (extra: Record<string, unknown>, body: string) => ({ t: "paragraph", inline: [T(body)], ...extra }) as unknown as TemplateNode2;
    const root: TemplateNode2[] = [{
      t: "section", key: "s1", numbering: "auto", title: [T("DA PROPOSTA")], children: [
        item({ numbered: true, anchor: "s1.p1" }, "A proposta conterá:"),
        item({ numbered: "alpha" }, "o preço;"),
        { t: "conditional", when: { op: "eq", var: "controle.utilizaSrp", value: true }, then: [item({ numbered: "alpha", anchor: "s1.p1.b" }, "a marca (opcional);"), item({ numbered: "alpha", level: 2 }, "detalhe da marca;")] },
        item({ numbered: "alpha", anchor: "s1.p1.c" }, "as demais informações."),
        item({ numbered: true }, "Segundo item."),
        item({ numbered: "alpha" }, "reinicia em a)."),
        item({ numbered: true, level: 2 }, "Sub-item do segundo."),
        item({ numbered: true, level: 3 }, "Sub-sub-item."),
        item({ numbered: true, anchor: "s1.p3" }, "Terceiro item."),
        item({}, "Remissão: ver a alínea \""),
      ],
    }];
    (root[0] as { children: TemplateNode2[] }).children.push(
      item({}, "x"), // parágrafo comum não numera
    );
    const on = text(compose(root, { sources: canonicalSources2(ORG_A, { CERTAME_CONFIG: { usesSrp: true, criterion: "menor_preco" }, POLICY: { secretBudget: "NAO", obrigatorio: true } }) }));
    expect(on).toContain("1.1. A proposta conterá:");
    expect(on).toContain("a) o preço;");
    expect(on).toContain("b) a marca (opcional);");
    expect(on).toContain("b.1) detalhe da marca;");
    expect(on).toContain("c) as demais informações.");
    expect(on).toContain("1.2. Segundo item.");
    expect(on).toContain("a) reinicia em a).");
    expect(on).toContain("1.2.1. Sub-item do segundo.");
    expect(on).toContain("1.2.1.1. Sub-sub-item.");
    expect(on).toContain("1.3. Terceiro item.");
    const off = text(compose(root, { sources: canonicalSources2(ORG_A, { CERTAME_CONFIG: { usesSrp: false, criterion: "menor_preco" }, POLICY: { secretBudget: "NAO", obrigatorio: true } }) }));
    expect(off).toContain("b) as demais informações."); // sem lacuna: a letra "c" some junto com o bloco
    expect(off).not.toContain("c) as demais");
  });

  it("xref para alínea resolve a letra; para seção ordinal resolve 'Segunda'; clausulas renumeram com condicional", () => {
    const clause = (key: string, title: string, children: TemplateNode2[]): TemplateNode2 => ({ t: "section", key, numbering: "auto", style: "ordinal", labelPrefix: "CLÁUSULA", title: [T(title)], children });
    const root: TemplateNode2[] = [
      { t: "annex", id: "anexo-c", role: "contrato", order: 1, title: [T("Minuta")], children: [
        clause("c.objeto", "DO OBJETO", [{ t: "paragraph", numbered: true, inline: [T("Objeto.")] }]),
        { t: "conditional", when: { op: "eq", var: "controle.utilizaSrp", value: true }, then: [clause("c.srp", "DO SRP", [{ t: "paragraph", numbered: true, inline: [T("Registro.")] }])] },
        clause("c.preco", "DO PREÇO", [
          { t: "paragraph", numbered: true, anchor: "c.preco.1", inline: [T("Preço.")] },
          { t: "paragraph", numbered: "alpha", anchor: "c.preco.1.a", inline: [T("alínea.")] },
          { t: "paragraph", numbered: true, inline: [T("Conforme a Cláusula "), { t: "xref", target: "c.objeto" }, T(", item "), { t: "xref", target: "c.preco.1" }, T(", alínea \""), { t: "xref", target: "c.preco.1.a" }, T("\".")] },
        ]),
      ] },
    ];
    const srpOn = text(compose(root, { sources: canonicalSources2(ORG_A, { CERTAME_CONFIG: { usesSrp: true, criterion: "menor_preco" }, POLICY: { secretBudget: "NAO", obrigatorio: true } }) }));
    expect(srpOn).toContain("### CLÁUSULA PRIMEIRA — DO OBJETO");
    expect(srpOn).toContain("### CLÁUSULA SEGUNDA — DO SRP");
    expect(srpOn).toContain("### CLÁUSULA TERCEIRA — DO PREÇO");
    expect(srpOn).toContain("3.1. Preço.");
    expect(srpOn).toContain("3.2. Conforme a Cláusula Primeira, item 3.1, alínea \"a\".");
    const srpOff = text(compose(root, { sources: canonicalSources2(ORG_A, { CERTAME_CONFIG: { usesSrp: false, criterion: "menor_preco" }, POLICY: { secretBudget: "NAO", obrigatorio: true } }) }));
    expect(srpOff).toContain("### CLÁUSULA SEGUNDA — DO PREÇO");
    expect(srpOff).toContain("2.2. Conforme a Cláusula Primeira, item 2.1, alínea \"a\".");
    expect(srpOff).not.toContain("DO SRP");
  });

  it("ordinais por extenso (1–99) e letras", () => {
    expect([1, 9, 10, 11, 21, 23, 40, 99].map(ordinalFeminine)).toEqual(["PRIMEIRA", "NONA", "DÉCIMA", "DÉCIMA PRIMEIRA", "VIGÉSIMA PRIMEIRA", "VIGÉSIMA TERCEIRA", "QUADRAGÉSIMA", "NONAGÉSIMA NONA"]);
    expect([1, 2, 26, 27, 28].map(alphaLabel)).toEqual(["a", "b", "z", "aa", "ab"]);
  });

  it("sequência simples escapa o ponto (nunca vira item de lista Markdown) e reinicia por escopo", () => {
    const root: TemplateNode2[] = [
      { t: "annex", id: "anx-1", role: "r1", order: 1, title: [T("A")], children: [{ t: "paragraph", numbered: "seq", inline: [T("primeira")] }, { t: "paragraph", numbered: "seq", inline: [T("segunda")] }] },
      { t: "annex", id: "anx-2", role: "r2", order: 2, title: [T("B")], children: [{ t: "paragraph", numbered: "seq", inline: [T("recomeça")] }] },
    ];
    const t = text(compose(root));
    expect(t).toContain("1\\. primeira");
    expect(t).toContain("2\\. segunda");
    expect(t).toMatch(/ANEXO II — B\n\n1\\\. recomeça/);
  });

  it("condicional inline escolhe o trecho sem espaços sobrando; aiSlot inline: pendente sem narrativa, texto com narrativa (humanAccepted=false)", () => {
    const para: TemplateNode2 = { t: "paragraph", inline: [T("Texto "), { t: "when", when: { op: "eq", var: "controle.utilizaSrp", value: true }, then: [T("com SRP, ")] }, T("fim. Justificativa: "), { t: "aiSlot", slotKey: "j", maxTokens: 20, instructionsKey: "k.j" }, T(".")] };
    const srp = (v: boolean) => canonicalSources2(ORG_A, { CERTAME_CONFIG: { usesSrp: v, criterion: "menor_preco" }, POLICY: { secretBudget: "NAO", obrigatorio: true } });
    expect(text(compose([para], {}, srp(true)))).toContain(`Texto com SRP, fim. Justificativa: ${PENDING_AI_SLOT_MARK("j")}.`);
    expect(text(compose([para], {}, srp(false)))).toContain(`Texto fim. Justificativa: ${PENDING_AI_SLOT_MARK("j")}.`);
    const withAi = compose([para], { aiNarratives: [{ organizationId: ORG_A, slotKey: "j", executionId: "e1", text: "Proposta de justificativa.\nSegunda linha." }] }, srp(false));
    expect(text(withAi)).toContain("Justificativa: Proposta de justificativa. Segunda linha..");
    if (!withAi.ok) throw new Error("falhou");
    expect(withAi.value.manifest.aiNarratives).toMatchObject([{ slotKey: "j", humanAccepted: false }]);
    // slot dentro de ramo excluído não é registrado no M1
    const none = compose([para], { aiNarratives: [] }, srp(false));
    expect(none.ok).toBe(true);
  });

  it("coluna condicional: valor estimado some do quadro quando a condição é falsa (nunca vaza)", () => {
    const root: TemplateNode2[] = [{ t: "dataTable", tableKey: "q", source: "itens.quadro", columns: [
      { key: "item", header: [T("Item")] },
      { key: "precoUnitario", header: [T("Preço unitário (R$)")], when: { op: "eq", var: "controle.orcamentoSigiloso", value: "NAO" } },
    ] }];
    const open = text(compose(root, {}, canonicalSources2(ORG_A, { POLICY: { secretBudget: "NAO", obrigatorio: true } })));
    expect(open).toContain("| Item | Preço unitário (R$) |");
    expect(open).toContain("R$ 25,50");
    const secret = text(compose(root, {}, canonicalSources2(ORG_A, { POLICY: { secretBudget: "SIM", obrigatorio: true }, ITEMS: { rows: ROWS } })));
    expect(secret).toContain("| Item |");
    expect(secret).not.toContain("Preço unitário");
    expect(secret).not.toContain("25,50");
  });

  it("controlRef: controle obrigatório ausente ⇒ MISSING_REQUIRED mesmo sem estar em texto/condição; presente ⇒ nunca renderizado", () => {
    const root: TemplateNode2[] = [{ t: "controlRef", var: "x.controleObrigatorio" }, { t: "paragraph", inline: [T("corpo")] }];
    const missing = compose(root, {}, canonicalSources2(ORG_A, { POLICY: { secretBudget: "NAO" } }));
    expect(codes(missing)).toContain("MISSING_REQUIRED");
    const ok = compose(root);
    expect(text(ok)).toBe("corpo\n");
  });

  it("absentText governado substitui a marca [REVISAR] de valor opcional ausente; duração em minutos formata", () => {
    const root: TemplateNode2[] = [{ t: "paragraph", inline: [T("Prazo: "), { t: "var", name: "x.prazo" }, T("; nota: "), { t: "var", name: "x.nota" }, T(".")] }];
    const t = text(compose(root));
    expect(t).toContain("Prazo: 30 minutos; nota: (a preencher).");
    const absent = text(compose(root, {}, canonicalSources2(ORG_A, { POLICY: { secretBudget: "NAO", obrigatorio: true } })));
    expect(absent).toContain("Prazo: a preencher; nota: (a preencher).");
    expect(absent).not.toContain("REVISAR");
  });

  it("anexo: parágrafos numerados reiniciam por anexo e seções internas usam título de nível 3", () => {
    const root: TemplateNode2[] = [
      { t: "section", key: "corpo", numbering: "auto", title: [T("CORPO")], children: [{ t: "paragraph", numbered: true, inline: [T("do corpo")] }] },
      { t: "annex", id: "anx", role: "r", order: 1, title: [T("Anexo")], children: [
        { t: "section", key: "anx.s", numbering: "auto", title: [T("DO OBJETO")], children: [{ t: "paragraph", numbered: true, inline: [T("do anexo")] }] },
      ] },
    ];
    const t = text(compose(root));
    expect(t).toContain("## 1. CORPO");
    expect(t).toContain("1.1. do corpo");
    expect(t).toContain("## ANEXO I — Anexo");
    expect(t).toContain("### 1. DO OBJETO");
    expect(t).toContain("1.1. do anexo");
  });
});
