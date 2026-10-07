/**
 * Compilador do Modelo-Mestre — dialeto "real": notas multilinha, condicionais em bloco e INLINE (inclusive blocos que abrem com título),
 * seções/anexos condicionais, alíneas/sub-alíneas/sequência, cláusulas ordinais, títulos em negrito numerados, guards, estrutura do
 * arquivo-mestre (separadores/títulos de scaffolding) e auditoria de numeração. Mini-mestre SINTÉTICO.
 */
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../domain/canonicalJson";
import { createDraftRevision, transitionRevision } from "../../domain/institutionalTemplates";
import { composeTemplate } from "../../domain/institutionalTemplates/composer";
import { compileApprovedMaster, evaluateParityGate, type MasterMapping } from "../../domain/institutionalTemplates/masterCompiler";
import { ORG_A, canonicalSources2, catalog2, composeRequest2, identity2 } from "../helpers/institutionalTemplatesV2Fixture";

const MD = `# MODELO-MESTRE SINTÉTICO

[SYSTEM NOTE — NÃO EXPORTAR:
Nota multilinha com {{UTILIZA_SRP}}, {{DATA_DIV}} e {{ORC_SIG}}; campos {{CONTRATADO_*}} pós-homologação.

Linha em branco DENTRO da nota; SE valor > 5 ENTÃO executar algo — documentação, jamais executável.]

---

# PARTE 1 — TEXTO

## EDITAL Nº {{NUMERO}}

## 1. DO OBJETO

1.1. Objeto: {{OBJETO}}{{#SE_SRP}}, com registro de preços{{/SE_SRP}}.

1.2. Itens conforme o item 1.1 e a alínea "a" do item 1.3.

1.3. Regras:

a) primeira;

{{#SE_SRP}}
b) somente com SRP, ver Seção 2;

b.1) detalhe da alínea;
{{/SE_SRP}}

c) última.

{{#SE_SRP}}
## 2. DO SRP

2.1. Ata.
{{/SE_SRP}}

## 3. DO FIM

3.1. Fim; autorização: {{AUTORIZACAO}}.

---

# PARTE 2 — ANEXOS

## ANEXO I — CONTRATO

### CLÁUSULA PRIMEIRA — DO OBJETO

1.1. Cláusula.

{{#SE_SRP}}
### CLÁUSULA SEGUNDA — DO SRP

2.1. Ata de novo.
{{/SE_SRP}}

### CLÁUSULA TERCEIRA — DO FIM

3.1. Ver Cláusula Primeira.

## ANEXO II — PROPOSTA

**1. Identificação**

1. declaração A;

2. declaração B;
`;

const mapping: MasterMapping = {
  format: "tpl-master-mapping/2", modelKey: "MINI_REAL", sourceLogicalVersion: "0.0.1", catalogVersion: catalog2.version,
  dialect: {
    placeholder: "\\{\\{(?<name>[A-Z][A-Z0-9_]*)\\}\\}",
    conditionOpen: "^\\{\\{#(?<type>[A-Z][A-Z0-9_]*)\\}\\}$", conditionClose: "^\\{\\{/(?<type>[A-Z][A-Z0-9_]*)\\}\\}$",
    inlineConditionOpen: "\\{\\{#(?<type>[A-Z][A-Z0-9_]*)\\}\\}", inlineConditionClose: "\\{\\{/(?<type>[A-Z][A-Z0-9_]*)\\}\\}",
    systemNote: "^\\[SYSTEM NOTE", systemNoteEnd: "\\]\\s*$", systemNoteBlock: true, ignoreLine: "^---\\s*$",
    scaffoldingHeadings: "^(?:MODELO-MESTRE\\b|PARTE [12] —)",
    numberedHeading: "^(?<num>\\d+(?:\\.\\d+)*)\\.\\s+(?<title>\\S.*)$",
    ordinalHeading: "^(?<prefix>CLÁUSULA)\\s+(?<ordinal>[A-ZÀ-Ý]+(?: [A-ZÀ-Ý]+)*?)\\s+—\\s+(?<title>.+)$",
    boldNumberedHeading: "^\\*\\*(?<num>\\d+)\\.\\s+(?<title>.+?)\\*\\*$",
    decimalParagraph: "^(?<num>\\d+(?:\\.\\d+)+)\\.\\s+(?<text>.+)$",
    alphaParagraph: "^(?<letter>[a-z])\\)\\s+(?<text>.+)$",
    alphaSubParagraph: "^(?<letter>[a-z])\\.(?<sub>\\d+)\\)\\s+(?<text>.+)$",
    seqParagraph: "^(?<num>\\d+)\\.\\s+(?<text>.+)$",
    lineBreaks: "paragraph",
  },
  inputs: {
    NUMERO: { kind: "variable", var: "processo.numero" },
    OBJETO: { kind: "variable", var: "processo.objeto" },
    AUTORIZACAO: { kind: "variable", var: "dfd.justificativa" },
    UTILIZA_SRP: { kind: "control", var: "controle.utilizaSrp" },
    DATA_DIV: { kind: "control", var: "controle.dataDivulgacao" },
    ORC_SIG: { kind: "control", var: "controle.orcamentoSigiloso" },
  },
  conditions: { SE_SRP: { when: { op: "eq", var: "controle.utilizaSrp", value: true } } },
  exclusiveGroups: {},
  anchors: [
    { key: "obj.item", scope: "main", kind: "paragraph", literal: "1.1" },
    { key: "regras.item", scope: "main", kind: "paragraph", literal: "1.3" },
    { key: "regras.a", scope: "main", kind: "alpha", literal: "a", parent: "1.3" },
    { key: "secao.srp", scope: "main", kind: "section", literal: "2" },
    { key: "contrato.clausula.primeira", scope: "anexo-contrato", kind: "section", literal: "PRIMEIRA" },
  ],
  annexes: [
    { id: "anexo-contrato", role: "contrato", order: 1, title: "CONTRATO", headingMatch: "^ANEXO I —" },
    { id: "anexo-proposta", role: "proposta", order: 2, title: "PROPOSTA", headingMatch: "^ANEXO II —" },
  ],
  crossReferences: [
    { scope: "main", context: "o item ⟦1.1⟧ e a alínea \"⟦a⟧\" do item ⟦1.3⟧", targets: ["obj.item", "regras.a", "regras.item"], occurrences: 1 },
    { scope: "main", context: "Seção ⟦2⟧", targets: ["secao.srp"], occurrences: 1 },
    { scope: "anexo-contrato", context: "Cláusula ⟦Primeira⟧", targets: ["contrato.clausula.primeira"], occurrences: 1 },
  ],
  remissionScan: { pattern: "\\b(?:itens?|subitens?)\\s+\\d|\\bSeç(?:ão|ões)\\s+\\d|\\bCláusulas?\\s+[A-Z]|\\balíneas?\\s+\"[a-z]\"" },
  guards: [{ placeholder: "AUTORIZACAO", rationale: "Parágrafo só existe quando a autorização vier preenchida (regra governada)." }],
  requireCurrencyInMoneyHeaders: true,
  expectations: { inputs: 6, renderCapable: 3, controls: 3, conditionTypes: 1, conditionBlocks: 4 },
};

const compile = (md = MD, m: MasterMapping = mapping, auditLiterals = false) => compileApprovedMaster({ markdown: md, expectedSha256: sha256Hex(md), mapping: m, catalog: catalog2, auditLiterals });
const codes = (r: { ok: boolean; issues?: readonly { code: string }[] }): string[] => (r.ok ? [] : (r.issues ?? []).map((i) => i.code));

function composeAst(ast: Parameters<typeof createDraftRevision>[0]["ast"], srp: boolean, over: Record<string, unknown> = {}) {
  const d = createDraftRevision({ id: "tplrev_dialect", identity: identity2, revision: 1, ast, catalog: catalog2, sourceFormat: "NATIVE" });
  if (!d.ok) throw new Error(JSON.stringify(d.issues));
  const a = transitionRevision(d.value, { to: "APPROVED", approvalDecisionId: "d1" }, identity2, catalog2);
  if (!a.ok) throw new Error(JSON.stringify(a.issues));
  const p = transitionRevision(a.value, { to: "PUBLISHED", publishDecisionId: "d2" }, identity2, catalog2);
  if (!p.ok) throw new Error(JSON.stringify(p.issues));
  const revision = p.value;
  return composeTemplate(composeRequest2({
    revision, aiNarratives: [], pin: { identityId: revision.identityId, revisionId: revision.id, semanticHash: revision.semanticHash },
    sources: canonicalSources2(ORG_A, { CERTAME_CONFIG: { usesSrp: srp, criterion: "menor_preco" }, POLICY: { secretBudget: "NAO" }, DFD: { justification: "Autorização X" }, ...over }),
  }));
}

describe("dialeto real — estrutura e relatório", () => {
  it("compila; notas multilinha (inclusive com linha em branco) viram evidência; scaffolding/separadores são contabilizados", () => {
    const r = compile();
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.value.report).toMatchObject({
      mappedInputs: 6, renderCapableInputs: 3, controlInputs: 3, unknownPlaceholders: [], unmappedInputs: [], residualPlaceholders: 0,
      conditionBlocks: 4, inlineConditionBlocks: 1, balancedConditions: true, systemNotes: 1, systemNotesRendered: 0,
      ignoredLines: 2, scaffoldingLines: 3,
    });
    expect(r.value.report.noteOnlyInputs).toEqual(["DATA_DIV", "ORC_SIG", "UTILIZA_SRP"]);
    expect(r.value.report.noteNonNameForms).toEqual(["{{CONTRATADO_*}}"]);
    expect(r.value.systemNoteEvidence.length).toBeGreaterThanOrEqual(4);
    expect(evaluateParityGate(r.value.report, mapping).pass).toBe(true);
  });

  it("nenhum texto/ação de nota entra na AST; controles viram controlRef (nunca texto)", () => {
    const r = compile();
    if (!r.ok) throw new Error("falhou");
    const json = JSON.stringify(r.value.ast);
    for (const leak of ["executar algo", "documentação", "SYSTEM NOTE", "MODELO-MESTRE", "PARTE 1"]) expect(json).not.toContain(leak);
    expect(r.value.ast.root.filter((n) => n.t === "controlRef").map((n) => (n as { var: string }).var)).toEqual(["controle.dataDivulgacao", "controle.orcamentoSigiloso", "controle.utilizaSrp"]);
  });

  it("bloco que abre com título: a seção condicional é IRMÃ da anterior (não filha); anexo e cláusula condicionais idem", () => {
    const r = compile();
    if (!r.ok) throw new Error("falhou");
    const top = r.value.ast.root.filter((n) => n.t !== "controlRef");
    expect(top.map((n) => n.t)).toEqual(["heading", "section", "conditional", "section", "annex", "annex"]);
    const annex = top[4];
    if (annex.t !== "annex") throw new Error("anexo esperado");
    expect(annex.children.map((n) => n.t)).toEqual(["section", "conditional", "section"]);
  });

  it("condicional inline vira `when` dentro do parágrafo; guard envolve o parágrafo em `present`", () => {
    const r = compile();
    if (!r.ok) throw new Error("falhou");
    const json = JSON.stringify(r.value.ast);
    expect(json).toContain('"t":"when"');
    expect(json).toContain('"op":"present","var":"dfd.justificativa"');
  });

  it("falha fechada: marcação {{ }} residual, bloco inline desbalanceado, ordinal/alvo de âncora inexistente", () => {
    expect(codes(compile(MD.replace("{{NUMERO}}", "{{NUMERO"))).join()).toMatch(/PLACEHOLDER_RESIDUAL/);
    expect(codes(compile(MD.replace("{{/SE_SRP}}.", ".")))).toContain("CONDITION_UNBALANCED");
    const noAnchor: MasterMapping = { ...mapping, anchors: mapping.anchors.filter((a) => a.key !== "secao.srp") };
    expect(codes(compile(MD, noAnchor))).toContain("MAPPING_XREF_INVALID");
  });
});

describe("dialeto real — composição e auditoria de numeração", () => {
  it("SRP ligado: alíneas a)/b)/b.1)/c), seção 2 SRP, cláusulas 1ª–3ª, sequência simples no anexo, remissões resolvidas", () => {
    const c = compile();
    if (!c.ok) throw new Error("falhou");
    const r = composeAst(c.value.ast, true);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const t = r.value.content.text;
    expect(t).toContain("1.1. Objeto: Aquisição sintética de material de expediente, com registro de preços.");
    expect(t).toContain("1.2. Itens conforme o item 1.1 e a alínea \"a\" do item 1.3.");
    for (const l of ["a) primeira;", "b) somente com SRP, ver Seção 2;", "b.1) detalhe da alínea;", "c) última."]) expect(t).toContain(l);
    expect(t).toContain("## 2. DO SRP");
    expect(t).toContain("## 3. DO FIM");
    expect(t).toContain("3.1. Fim; autorização: Autorização X.");
    expect(t).toContain("### CLÁUSULA SEGUNDA — DO SRP");
    expect(t).toContain("### CLÁUSULA TERCEIRA — DO FIM");
    expect(t).toContain("3.1. Ver Cláusula Primeira.");
    expect(t).toContain("### 1. **Identificação**");
    expect(t).toContain("1\\. declaração A;");
    expect(t).toContain("2\\. declaração B;");
    expect(t).not.toMatch(/SYSTEM NOTE|NÃO EXPORTAR|\{\{|\}\}/);
  });

  it("SRP desligado: remissão à seção guardada some junto com o bloco; letras e cláusulas reordenam; guard suprime parágrafo sem a variável", () => {
    const c = compile();
    if (!c.ok) throw new Error("falhou");
    const r = composeAst(c.value.ast, false);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const t = r.value.content.text;
    expect(t).toContain("1.1. Objeto: Aquisição sintética de material de expediente.");
    expect(t).toContain("b) última.");
    expect(t).not.toContain("somente com SRP");
    expect(t).toContain("## 2. DO FIM");
    expect(t).toContain("### CLÁUSULA SEGUNDA — DO FIM");
    const noAuth = composeAst(c.value.ast, false, { DFD: {} });
    if (!noAuth.ok) throw new Error(JSON.stringify(noAuth.issues));
    expect(noAuth.value.content.text).not.toContain("autorização:");
  });

  it("auditoria: no cenário com blocos ativos, TODO rótulo automático é igual ao literal do texto-fonte (e as remissões também)", () => {
    const c = compile(MD, mapping, true);
    if (!c.ok) throw new Error(JSON.stringify(c.issues));
    const r = composeAst(c.value.ast, true);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    let checked = 0;
    for (const l of r.value.content.text.split("\n")) {
      for (const re of [/^(\d+(?:\.\d+)+)\. ⟦(\d+(?:\.\d+)+)⟧ /, /^([a-z](?:\.\d+)?)\) ⟦([a-z](?:\.\d+)?)⟧ /, /^(\d+)\\\. ⟦(\d+)⟧ /, /^#+ (\d+)\. ⟦(\d+)⟧ /, /^#+ CLÁUSULA ([A-ZÀ-Ý ]+?) — ⟦([A-ZÀ-Ý ]+)⟧ /]) {
        const m = re.exec(l);
        if (m) { checked += 1; expect(m[1], l).toBe(m[2]); }
      }
      for (const m of l.matchAll(/([^\s"(⟦]+)⟦=([^⟧]+)⟧/g)) { checked += 1; expect(m[1].toLowerCase(), l).toBe(m[2].toLowerCase()); }
    }
    expect(checked).toBeGreaterThanOrEqual(20);
  });

  it("determinismo: mesma entrada ⇒ mesma AST e hash; mudar só uma nota não muda a AST", () => {
    const a = compile(); const b = compile();
    if (!a.ok || !b.ok) throw new Error("falhou");
    expect(b.value.astSemanticHash).toBe(a.value.astSemanticHash);
    const c = compile(MD.replace("jamais executável", "texto diferente de documentação"));
    if (!c.ok) throw new Error("falhou");
    expect(c.value.astSemanticHash).toBe(a.value.astSemanticHash);
  });
});
