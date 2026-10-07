/**
 * Institutional Templates — compilador determinístico do Modelo-Mestre aprovado (domínio puro) + gate de paridade estrutural.
 * Fixture SINTÉTICA (mini-mestre): o compilador é genérico; nenhum modelo (BLL/Pregão/eletrônico) está no código.
 */
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../domain/canonicalJson";
import { createDraftRevision, transitionRevision } from "../../domain/institutionalTemplates";
import { composeTemplate } from "../../domain/institutionalTemplates/composer";
import {
  compileApprovedMaster, compileAndVerifyMaster, evaluateParityGate, validateMasterMapping, type MasterMapping,
} from "../../domain/institutionalTemplates/masterCompiler";
import {
  catalog2, canonicalSources2, composeRequest2, identity2, trPin2, ORG_A,
} from "../helpers/institutionalTemplatesV2Fixture";
import { MINI_MD, MINI_SHA, miniMapping } from "../helpers/institutionalTemplatesMiniMaster";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const codes = (r: { ok: boolean; issues?: readonly { code: string }[] }): string[] => (r.ok ? [] : (r.issues ?? []).map((i) => i.code));

function compile(md = MINI_MD, mapping: MasterMapping = miniMapping, sha: string | null = null) {
  return compileApprovedMaster({ markdown: md, expectedSha256: sha ?? sha256Hex(md), mapping, catalog: catalog2 });
}
function ok(md = MINI_MD, mapping: MasterMapping = miniMapping) {
  const r = compile(md, mapping);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}
const withMapping = (patch: (m: Record<string, unknown>) => void): MasterMapping => { const m = clone(miniMapping) as unknown as Record<string, unknown>; patch(m); return m as unknown as MasterMapping; };

describe("compilador do Modelo-Mestre — proveniência e determinismo", () => {
  it("compila o mini-mestre; a AST passa nas MESMAS regras de validação do runtime", () => {
    const c = ok();
    expect(c.ast.schema).toBe("tpl-ast/2");
    expect(c.provenance).toMatchObject({ sourceSha256: MINI_SHA, modelKey: "MODELO_SINTETICO", sourceLogicalVersion: "0.0.1-fixture", catalogVersion: catalog2.version });
    expect(c.provenance.mappingSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sha256 divergente do snapshot aprovado ⇒ SOURCE_HASH_MISMATCH (nada é compilado)", () => {
    expect(codes(compile(MINI_MD, miniMapping, "0".repeat(64)))).toEqual(["SOURCE_HASH_MISMATCH"]);
    expect(codes(compile(MINI_MD.replace("Texto do modelo.", "Texto do modelo!"), miniMapping, MINI_SHA))).toEqual(["SOURCE_HASH_MISMATCH"]);
  });

  it("mesma entrada ⇒ mesma AST e mesmo hash semântico (repetível), sem relógio/aleatório", () => {
    const a = ok();
    const b = ok();
    expect(JSON.stringify(b.ast)).toBe(JSON.stringify(a.ast));
    expect(b.astSemanticHash).toBe(a.astSemanticHash);
    expect(b.provenance).toEqual(a.provenance);
    expect(a.astSemanticHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a ordem das chaves do mapeamento não altera a AST; mudar o MD ou o mapeamento muda o hash", () => {
    const a = ok();
    const reordered = { ...miniMapping, inputs: Object.fromEntries(Object.entries(miniMapping.inputs).reverse()) } as MasterMapping;
    expect(ok(MINI_MD, reordered).astSemanticHash).toBe(a.astSemanticHash);
    expect(ok(MINI_MD.replace("Texto do modelo.", "Outro texto."), miniMapping).astSemanticHash).not.toBe(a.astSemanticHash);
    const m2 = JSON.parse(JSON.stringify(miniMapping).split("julgamento.criterio").join("outro.ancora")) as MasterMapping;
    expect(ok(MINI_MD, m2).astSemanticHash).not.toBe(a.astSemanticHash);
  });

  it("o hash semântico compilado é o mesmo da revisão criada a partir da AST (replay)", () => {
    const c = ok();
    const r = createDraftRevision({ id: "tplrev_mm", identity: identity2, revision: 1, ast: c.ast, catalog: catalog2, sourceFormat: "NATIVE" });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.value.semanticHash).toBe(c.astSemanticHash);
  });
});

describe("paridade estrutural (parametrizada pelo mapeamento)", () => {
  const c = ok();
  it("12 entradas mapeadas = 9 renderizáveis + 3 controles; 0 desconhecidas; 0 sem ocorrência", () => {
    expect(c.report).toMatchObject({ mappedInputs: 12, renderCapableInputs: 9, controlInputs: 3, unknownPlaceholders: [], unmappedInputs: [] });
  });
  it("4 tipos de bloco condicional usados e mapeados; balanceados; nenhum sem uso", () => {
    expect(c.report.conditionTypesUsed).toEqual(["ORC_ABERTO", "ORC_SIGILOSO", "SRP_SIM", "VISITA_SIM"]);
    expect(c.report).toMatchObject({ conditionTypesMapped: 4, conditionTypesUnused: [], conditionBlocks: 4, balancedConditions: true, exclusiveGroups: 1 });
  });
  it("notas do sistema excluídas (evidência com hash por linha); placeholders das notas contabilizados", () => {
    expect(c.report.systemNotes).toBe(1); // 1 nota (2 linhas de evidência)
    expect(c.report.systemNotesRendered).toBe(0);
    expect(c.systemNoteEvidence.map((e) => e.line)).toEqual([5, 6]);
    expect(c.report.placeholderOccurrences.systemNote).toBe(3);
    expect(c.report.placeholderOccurrences.text).toBeGreaterThan(8);
  });
  it("gate passa; remissões: 4 substituídas por xref, 0 sem mapeamento", () => {
    expect(evaluateParityGate(c.report, miniMapping)).toEqual({ pass: true, failures: [] });
    expect(c.report.crossReferences).toMatchObject({ entries: 3, replaced: 4, unmappedRemissions: 0 });
    expect(compileAndVerifyMaster({ markdown: MINI_MD, expectedSha256: MINI_SHA, mapping: miniMapping, catalog: catalog2 }).ok).toBe(true);
  });
  it("o gate falha quando as contagens esperadas divergem (nenhum número é fixo no código)", () => {
    const wrong = { ...miniMapping, expectations: { inputs: 13, renderCapable: 10, controls: 3, conditionTypes: 5 } } as MasterMapping;
    const g = evaluateParityGate(c.report, wrong);
    expect(g.pass).toBe(false);
    expect(g.failures.length).toBeGreaterThanOrEqual(3);
    expect(codes(compileAndVerifyMaster({ markdown: MINI_MD, expectedSha256: MINI_SHA, mapping: wrong, catalog: catalog2 }))).toContain("PARITY_GATE_FAILED");
  });
});

describe("falha fechada do compilador", () => {
  it("placeholder desconhecido ⇒ PLACEHOLDER_UNKNOWN", () => {
    expect(codes(compile(MINI_MD.replace("{{OBJETO}}", "{{OBJETO_DESCONHECIDO}}")))).toContain("PLACEHOLDER_UNKNOWN");
  });

  it("entrada mapeada sem nenhuma ocorrência ⇒ passa a compilação mas o gate acusa 'sem ocorrência'; allowAbsent a explicita", () => {
    const extra = withMapping((m) => { (m.inputs as Record<string, unknown>).FANTASMA = { kind: "variable", var: "dfd.justificativa" }; (m.expectations as { inputs: number; renderCapable: number }).inputs = 13; (m.expectations as { renderCapable: number }).renderCapable = 10; });
    const r = ok(MINI_MD, extra);
    expect(r.report.unmappedInputs).toEqual(["FANTASMA"]);
    expect(evaluateParityGate(r.report, extra).failures.join(" ")).toContain("FANTASMA");
    const allowed = withMapping((m) => { (m.inputs as Record<string, unknown>).FANTASMA = { kind: "variable", var: "dfd.justificativa", allowAbsent: true }; (m.expectations as { inputs: number; renderCapable: number }).inputs = 13; (m.expectations as { renderCapable: number }).renderCapable = 10; });
    expect(evaluateParityGate(ok(MINI_MD, allowed).report, allowed).pass).toBe(true);
  });

  it("bloco condicional desbalanceado / fechamento divergente / tipo sem mapeamento", () => {
    expect(codes(compile(MINI_MD.replace("[[FIM SRP_SIM]]", "")))).toContain("CONDITION_UNBALANCED");
    expect(codes(compile(MINI_MD.replace("[[FIM SRP_SIM]]", "[[FIM ORC_ABERTO]]")))).toContain("CONDITION_CLOSE_MISMATCH");
    expect(codes(compile(MINI_MD.replace("[[FIM VISITA_SIM]]\n", "[[FIM VISITA_SIM]]\n\n[[FIM VISITA_SIM]]\n")))).toContain("CONDITION_UNBALANCED");
    expect(codes(compile(MINI_MD.replace("[[SE SRP_SIM]]", "[[SE TIPO_NOVO]]").replace("[[FIM SRP_SIM]]", "[[FIM TIPO_NOVO]]")))).toContain("CONDITION_TYPE_UNMAPPED");
  });

  it("controle em texto ⇒ CONTROL_ONLY_PLACEHOLDER_IN_TEXT; aiSlot/dataTable/docRef só como parágrafo inteiro", () => {
    expect(codes(compile(MINI_MD.replace("{{NOME_ORGAO}}", "{{UTILIZA_SRP}}")))).toContain("CONTROL_ONLY_PLACEHOLDER_IN_TEXT");
    expect(codes(compile(MINI_MD.replace("{{QUADRO_ITENS}}", "Quadro: {{QUADRO_ITENS}}")))).toContain("PLACEHOLDER_POSITION_INVALID");
    // aiSlot no meio de uma frase é permitido (campo "Propõe" inline) e vira slot inline governado
    const inlineAi = ok(MINI_MD.replace("{{JUSTIFICATIVA}}", "Justificativa: {{JUSTIFICATIVA}}."));
    expect(JSON.stringify(inlineAi.ast)).toContain('"t":"aiSlot","slotKey":"justificativa"');
  });

  it("remissão literal sem xref governada ⇒ UNMAPPED_REMISSION; contagem divergente ⇒ XREF_COUNT_MISMATCH", () => {
    expect(codes(compile(MINI_MD.replace("Texto do modelo.", "Conforme o item 9.9 do edital.")))).toContain("UNMAPPED_REMISSION");
    const wrongCount = withMapping((m) => { (m.crossReferences as { occurrences: number }[])[0].occurrences = 3; });
    expect(codes(compile(MINI_MD, wrongCount))).toContain("XREF_COUNT_MISMATCH");
  });

  it("grupo exclusivo incompleto ⇒ EXCLUSIVE_GROUP_INCOMPLETE; ramo alternativo em grupo exclusivo recusado", () => {
    // membro isolado do grupo é só um condicional simples; duplicata adjacente (mesmo membro 2x) é grupo incompleto
    const single = MINI_MD.replace(/\[\[SE ORC_ABERTO\]\][\s\S]*?\[\[FIM ORC_ABERTO\]\]\n\n/, "");
    expect(compile(single).ok).toBe(true);
    const dup = MINI_MD.replace("[[SE ORC_ABERTO]]", "[[SE ORC_SIGILOSO]]").replace("[[FIM ORC_ABERTO]]", "[[FIM ORC_SIGILOSO]]");
    expect(codes(compile(dup))).toContain("EXCLUSIVE_GROUP_INCOMPLETE");
    const els = MINI_MD.replace("2.3 O orçamento é sigiloso.\n", "2.3 O orçamento é sigiloso.\n\n[[SENAO]]\n\nX\n");
    expect(codes(compile(els))).toContain("EXCLUSIVE_GROUP_ELSE");
  });

  it("âncora mapeada que não existe no texto ⇒ ANCHOR_NOT_FOUND", () => {
    const m = withMapping((x) => { (x.anchors as unknown[]).push({ key: "nao.existe", scope: "main", kind: "paragraph", literal: "9.9" }); });
    expect(codes(compile(MINI_MD, m))).toContain("ANCHOR_NOT_FOUND");
  });

  it("achado de fidelidade: coluna monetária sem '(R$)' no cabeçalho ⇒ DATATABLE_MONEY_HEADER_MISSING_CURRENCY", () => {
    const m = withMapping((x) => { ((x.inputs as Record<string, { columns: { key: string; header: string }[] }>).QUADRO_ITENS).columns[3].header = "Preço unitário"; });
    expect(codes(compile(MINI_MD, m))).toContain("DATATABLE_MONEY_HEADER_MISSING_CURRENCY");
  });

  it("validação do mapeamento: catálogo divergente, regex inválida, grupo nomeado ausente, entrada fora do catálogo, controle vs variável", () => {
    expect(validateMasterMapping({ ...miniMapping, catalogVersion: "outro/1" }, catalog2).map((i) => i.code)).toContain("MAPPING_CATALOG_MISMATCH");
    expect(validateMasterMapping(withMapping((m) => { (m.dialect as { placeholder: string }).placeholder = "(["; }), catalog2).map((i) => i.code)).toContain("MAPPING_DIALECT_INVALID");
    expect(validateMasterMapping(withMapping((m) => { (m.dialect as { placeholder: string }).placeholder = "\\{\\{(?<nome>X)\\}\\}"; }), catalog2).map((i) => i.code)).toContain("MAPPING_DIALECT_INVALID");
    expect(validateMasterMapping(withMapping((m) => { (m.inputs as Record<string, unknown>).X = { kind: "variable", var: "nao.existe" }; }), catalog2).map((i) => i.code)).toContain("MAPPING_INPUT_UNKNOWN_VARIABLE");
    expect(validateMasterMapping(withMapping((m) => { (m.inputs as Record<string, unknown>).UTILIZA_SRP = { kind: "variable", var: "controle.utilizaSrp" }; }), catalog2).map((i) => i.code)).toContain("MAPPING_INPUT_KIND_MISMATCH");
    expect(validateMasterMapping(withMapping((m) => { (m.inputs as Record<string, unknown>).OBJETO = { kind: "control", var: "processo.objeto" }; }), catalog2).map((i) => i.code)).toContain("MAPPING_INPUT_KIND_MISMATCH");
    expect(codes(compile(MINI_MD, { ...miniMapping, catalogVersion: "outro/1" }))).toContain("MAPPING_CATALOG_MISMATCH");
  });
});

describe("estrutura compilada", () => {
  const c = ok();
  const root = c.ast.root;
  const find = (nodes: readonly unknown[], pred: (n: Record<string, unknown>) => boolean): Record<string, unknown>[] => {
    const out: Record<string, unknown>[] = [];
    const walk = (x: unknown): void => {
      if (Array.isArray(x)) { x.forEach(walk); return; }
      if (x && typeof x === "object") { const o = x as Record<string, unknown>; if (pred(o)) out.push(o); Object.values(o).forEach(walk); }
    };
    walk(nodes);
    return out;
  };

  it("grupo exclusivo vira `choice exactly-one` com os ramos do mapeamento; ramo alternativo vira conditional com else", () => {
    const ch = find(root, (n) => n.t === "choice");
    expect(ch).toHaveLength(1);
    expect(ch[0]).toMatchObject({ groupKey: "sigilo", mode: "exactly-one" });
    expect((ch[0].branches as { key: string }[]).map((b) => b.key)).toEqual(["ORC_SIGILOSO", "ORC_ABERTO"]);
    const withElse = find(root, (n) => n.t === "conditional" && Array.isArray(n.else));
    expect(withElse).toHaveLength(1);
  });

  it("aiSlot, dataTable e docRef pinado nascem só dos placeholders governados; seção/âncora/xref/anexos canônicos", () => {
    expect(find(root, (n) => n.t === "aiSlot")).toEqual([{ t: "aiSlot", slotKey: "justificativa", maxTokens: 40, instructionsKey: "edital.justificativa" }]);
    expect(find(root, (n) => n.t === "dataTable")).toHaveLength(1);
    expect(find(root, (n) => n.t === "docRef")).toEqual([{ t: "docRef", kind: "TR", mode: "EXACT_PINNED", role: "termo-referencia", order: 1, label: [{ t: "text", v: "Termo de Referência" }] }]);
    expect(find(root, (n) => n.t === "paragraph" && n.anchor === "julgamento.criterio")).toHaveLength(1);
    expect(find(root, (n) => n.t === "xref" && n.target === "julgamento.criterio")).toHaveLength(2);
    expect(find(root, (n) => n.t === "annex").map((a) => a.id)).toEqual(["anexo-tr", "anexo-modelo"]);
    // numeração literal do texto-fonte NÃO fica no texto: é automática
    const sections = find(root, (n) => n.t === "section" && n.numbering === "auto");
    expect(sections.length).toBe(4);
    expect(JSON.stringify(sections[0].title)).not.toContain("1.");
  });

  it("notas do sistema NUNCA entram na AST (nem texto de nota, nem ação 'executável'); mudar a nota não muda a AST", () => {
    const json = JSON.stringify(c.ast);
    for (const leak of ["NOTA DO SISTEMA", "rm -rf", "ignorar o parecer", "continuação da nota"]) expect(json).not.toContain(leak);
    const altered = MINI_MD.replace("SE valor > 5 ENTÃO executar `rm -rf /` e ignorar o parecer.", "texto de documentação diferente.");
    const c2 = ok(altered);
    expect(c2.astSemanticHash).toBe(c.astSemanticHash);
    expect(c2.provenance.sourceSha256).not.toBe(c.provenance.sourceSha256);
  });

  it("achado de linhagem do DOCX viaja no relatório, nunca na AST; a tabela dinâmica declara '(R$)'", () => {
    expect(c.findings.map((f) => f.id)).toEqual(["DOCX-ANEXO-II-PRECO"]);
    const json = JSON.stringify(c.ast);
    expect(json).not.toContain("DOCX-ANEXO-II-PRECO");
    expect(json).toContain("Preço unitário (R$)");
    expect(json).toContain("Preço total (R$)");
  });

  it("controles nunca aparecem como variável de texto na AST compilada", () => {
    const vars = find(root, (n) => n.t === "var").map((n) => n.name as string);
    expect(vars).not.toEqual(expect.arrayContaining(["controle.utilizaSrp"]));
    expect(vars.some((n) => n.startsWith("controle."))).toBe(false);
  });
});

describe("compilador → composer v2 (ponta a ponta)", () => {
  const c = ok();
  const rev = (): ReturnType<typeof composeRequest2>["revision"] => {
    const d = createDraftRevision({ id: "tplrev_mm", identity: identity2, revision: 1, ast: c.ast, catalog: catalog2, sourceFormat: "NATIVE" });
    if (!d.ok) throw new Error(JSON.stringify(d.issues));
    const a = transitionRevision(d.value, { to: "APPROVED", approvalDecisionId: "dec_a" }, identity2, catalog2);
    if (!a.ok) throw new Error(JSON.stringify(a.issues));
    const p = transitionRevision(a.value, { to: "PUBLISHED", publishDecisionId: "dec_p" }, identity2, catalog2);
    if (!p.ok) throw new Error(JSON.stringify(p.issues));
    return p.value;
  };
  const run = (sources = canonicalSources2(ORG_A, { PROCESS: { number: "2026/0007", object: "Objeto sintético", technicalVisit: true } })) => {
    const revision = rev();
    return composeTemplate(composeRequest2({ revision, pin: { identityId: revision.identityId, revisionId: revision.id, semanticHash: revision.semanticHash }, sources, officialDocuments: trPin2() }));
  };

  it("compõe; numeração automática e xref resolvem o número final; choice e else escolhidos pelos controles", () => {
    const r = run();
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const t = r.value.content.text;
    expect(t).toContain("# EDITAL SINTÉTICO Nº 2026/0007");
    expect(t).toContain("1.2. Valor estimado: R$ 30.600,00, conforme o critério do item 2.1 deste edital.");
    expect(t).toContain("2.2.1. Ata com vigência de 12 meses, nos termos da cláusula 1.1.");
    expect(t).toContain("O orçamento é público.");
    expect(t).not.toContain("sigiloso");
    expect(t).toContain("A visita técnica é obrigatória.");
    expect(t).not.toContain("dispensada");
    expect(t).toContain("Ver o Anexo II e o item 2.1.");
    expect(t).toContain("| 1 | Papel A4 \\| 75g | 1.200 | R$ 25,50 | R$ 30.600,00 |");
    expect(t.indexOf("## ANEXO I — TERMO DE REFERÊNCIA")).toBeLessThan(t.indexOf("## ANEXO II — MODELO DE PROPOSTA"));
  });

  it("SRP desligado: a seção condicional some, a numeração e as remissões acompanham — nenhum número fixo no texto", () => {
    const r = run(canonicalSources2(ORG_A, { CERTAME_CONFIG: { usesSrp: false, criterion: "menor_preco" }, PROCESS: { number: "2026/0007", object: "Objeto sintético", technicalVisit: false } }));
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const t = r.value.content.text;
    expect(t).not.toContain("REGISTRO DE PREÇOS");
    expect(t).toContain("2.2. O orçamento é público.");
    expect(t).toContain("2.3. A visita técnica é dispensada.");
  });

  it("orçamento sigiloso: ramo sigiloso exige a data de controle (requiredWhen) e a data NÃO é renderizada", () => {
    const sig = canonicalSources2(ORG_A, { POLICY: { secretBudget: "SIM" }, PROCESS: { number: "2026/0007", object: "Objeto sintético", technicalVisit: true } });
    const r = run(sig);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.value.content.text).toContain("O orçamento é sigiloso.");
    expect(r.value.content.text).not.toContain("2026-12-01");
    expect(r.value.content.text).not.toContain("01/12/2026");
  });
});
