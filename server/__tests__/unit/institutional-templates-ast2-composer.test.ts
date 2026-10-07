/**
 * Institutional Templates — composer v2 (domínio puro): numeração, xref após condicionais, tabela dinâmica, choice,
 * docRef pinado, anexos, controles não renderizáveis, AI slot, tenant, determinismo e revalidação. Fixture SINTÉTICA.
 */
import { describe, expect, it } from "vitest";
import {
  validateManifest, validateAnyTemplateAst, type TemplateAST2, type VariableCatalog2, type TemplateNode2,
} from "../../domain/institutionalTemplates";
import {
  composeTemplate, MISSING_VALUE_MARK, PENDING_AI_SLOT_MARK, type ComposedDocument, type TemplateComposeRequest,
} from "../../domain/institutionalTemplates/composer";
import { revalidateForIssuance } from "../../domain/institutionalTemplates/revalidation";
import { buildInstitutionalModel, renderInstitutionalDOCX, renderInstitutionalPDF } from "../../services/documentConverter";
import { readZipEntry } from "../helpers/zipText";
import { previewComposeOutcome } from "../../services/institutionalTemplates/adapters/previewAdapter";
import { summarizeAst } from "../../services/institutionalTemplates/astSummary";
import {
  ORG_A, ORG_B, H, ROWS, ast2, canonicalSources2, catalog2, composeRequest2, draftRevision2, identity2, publishedRevision2, trPin2,
} from "../helpers/institutionalTemplatesV2Fixture";

const codes = (r: { ok: boolean; issues?: readonly { code: string }[] }): string[] => (r.ok ? [] : (r.issues ?? []).map((i) => i.code));

function compose(over: Partial<TemplateComposeRequest> = {}): ComposedDocument {
  const r = composeTemplate(composeRequest2(over));
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}

function revisionWith(root: TemplateNode2[], cat: VariableCatalog2 = catalog2): ReturnType<typeof publishedRevision2> {
  const ast: TemplateAST2 = { schema: "tpl-ast/2", root };
  const v = validateAnyTemplateAst(ast, cat);
  if (!v.ok) throw new Error(JSON.stringify(v.issues));
  return publishedRevision2({ ast, id: `tplrev_${Math.abs(JSON.stringify(root).length)}`, catalog: cat });
}

function composeRoot(root: TemplateNode2[], over: Partial<TemplateComposeRequest> = {}, cat: VariableCatalog2 = catalog2) {
  const revision = revisionWith(root, cat);
  return composeTemplate(composeRequest2({ revision, catalog: cat, aiNarratives: [], pin: { identityId: revision.identityId, revisionId: revision.id, semanticHash: revision.semanticHash }, ...over }));
}

const P = (v: string): TemplateNode2 => ({ t: "paragraph", numbered: true, inline: [{ t: "text", v }] });

describe("composer v2 — saída completa da fixture", () => {
  const doc = compose();
  const text = doc.content.text;

  it("numeração automática só dos blocos renderizados (seções e parágrafos), incluindo seção condicional", () => {
    expect(text).toContain("## 1. DO OBJETO");
    expect(text).toContain("1.1. Aquisição sintética de material de expediente");
    expect(text).toContain("1.2. Valor estimado: R$ 30.600,00 (margem de preferência 5,5%).");
    expect(text).toContain("## 2. DO JULGAMENTO");
    expect(text).toContain("2.1. Critério de julgamento: menor_preco.");
    expect(text).toContain("### 2.2. DO REGISTRO DE PREÇOS");
    expect(text).toContain("2.2.1. Ata de registro de preços com vigência de 12 meses.");
  });

  it("xref resolve o número final (nunca texto literal fixo)", () => {
    expect(text).toContain("Conforme o item 2.1 e a cláusula 1.1.");
  });

  it("choice exactly-one renderiza só o ramo cuja condição vale e numera-o na sequência", () => {
    expect(text).toContain("2.3. O orçamento estimado é público.");
    expect(text).not.toContain("sigiloso");
  });

  it("tabela dinâmica: cabeçalhos com (R$) preservados, moeda formatada, pipe escapado, célula opcional vazia", () => {
    expect(text).toContain("| Item | Descrição | Quantidade | Preço unitário (R$) | Preço total (R$) |");
    expect(text).toContain("| 1 | Papel A4 \\| 75g | 1.200 | R$ 25,50 | R$ 30.600,00 |");
    expect(text).toContain("| 2 | Caneta esferográfica | 500,5 | R$ 1,50 |  |");
  });

  it("anexos na ordem de `order` (não na ordem do AST), numeração romana por posição entre os renderizados", () => {
    expect(text.indexOf("## ANEXO I — Termo de Referência")).toBeGreaterThan(0);
    expect(text.indexOf("## ANEXO II — Modelo de proposta")).toBeGreaterThan(text.indexOf("## ANEXO I — "));
  });

  it("docRef EXACT_PINNED: linha com título/rótulo, tipo, versão exata, id e hash; nunca 'última versão'", () => {
    expect(text).toContain("> Documento de referência: Termo de Referência vigente — TR, versão 2 (odoc_tr_1, hash aaaaaaaaaaaa)");
    expect(text).not.toMatch(/última|latest/i);
  });

  it("variáveis de controle jamais aparecem como texto", () => {
    for (const mark of ["controle.", "SIM", "2026-12-01", "01/12/2026"]) expect(text).not.toContain(mark);
  });

  it("AI slot: texto só entra com humanAccepted=false no M1 (pendente de aceite) e dentro do limite", () => {
    expect(text).toContain("Justificativa sintética redigida para revisão humana.");
    expect(doc.manifest.aiNarratives).toHaveLength(1);
    expect(doc.manifest.aiNarratives[0]).toMatchObject({ slotKey: "justificativa", humanAccepted: false });
  });

  it("M1 válido; decisões condicionais, anexos e fontes (incluindo as novas) registrados", () => {
    expect(validateManifest(doc.manifest).ok).toBe(true);
    expect(doc.manifest.catalogVersion).toBe(catalog2.version);
    expect(doc.manifest.annexes.map((a) => a.id).sort()).toEqual(["anexo-modelo", "anexo-tr"]);
    const keys = doc.manifest.sources.map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(["orcamento", "certame", "politica"]));
    expect(doc.manifest.conditionalDecisions.length).toBeGreaterThan(0);
  });
});

describe("composer v2 — condicionais, controles e xref", () => {
  it("controle que muda a condição: SRP desligado ⇒ seção some, renumera, e o xref acompanha", () => {
    const off = compose({ sources: canonicalSources2(ORG_A, { CERTAME_CONFIG: { usesSrp: false, criterion: "menor_preco", openingAt: "2026-11-05T09:30" } }) });
    expect(off.content.text).not.toContain("REGISTRO DE PREÇOS");
    expect(off.content.text).toContain("2.2. O orçamento estimado é público.");
    expect(off.content.text).toContain("Conforme o item 2.1 e a cláusula 1.1.");
  });

  it("xref DEPOIS da remoção de um bloco condicional resolve o número final (nunca literal)", () => {
    const root: TemplateNode2[] = [
      { t: "conditional", when: { op: "eq", var: "controle.utilizaSrp", value: true }, then: [P("Bloco A (SRP).")] },
      { t: "paragraph", numbered: true, anchor: "alvo", inline: [{ t: "text", v: "Critério de aceitabilidade." }] },
      { t: "paragraph", inline: [{ t: "text", v: "Ver item " }, { t: "xref", target: "alvo" }, { t: "text", v: "." }] },
    ];
    const withSrp = composeRoot(root);
    const noSrp = composeRoot(root, { sources: canonicalSources2(ORG_A, { CERTAME_CONFIG: { usesSrp: false, criterion: "menor_preco" } }) });
    if (!withSrp.ok || !noSrp.ok) throw new Error("falhou");
    expect(withSrp.value.content.text).toContain("Ver item 2.");
    expect(noSrp.value.content.text).toContain("Ver item 1.");
    expect(noSrp.value.content.text).not.toContain("Bloco A");
  });

  it("xref para alvo NÃO renderizado ⇒ falha fechada XREF_TARGET_NOT_RENDERED (nunca número inventado)", () => {
    const root: TemplateNode2[] = [
      { t: "conditional", when: { op: "eq", var: "controle.utilizaSrp", value: true }, then: [{ t: "paragraph", numbered: true, anchor: "so.srp", inline: [{ t: "text", v: "SRP" }] }] },
      { t: "paragraph", inline: [{ t: "text", v: "Ver " }, { t: "xref", target: "so.srp" }] },
    ];
    expect(codes(composeRoot(root, { sources: canonicalSources2(ORG_A, { CERTAME_CONFIG: { usesSrp: false, criterion: "menor_preco" } }) }))).toContain("XREF_TARGET_NOT_RENDERED");
    expect(composeRoot(root).ok).toBe(true);
  });

  it("xref para anexo resolve o rótulo romano pela posição entre os renderizados", () => {
    const annex = (id: string, order: number, when?: boolean): TemplateNode2 => {
      const a: TemplateNode2 = { t: "annex", id, role: id, order, title: [{ t: "text", v: id }], children: [P("x")] };
      return when === undefined ? a : { t: "conditional", when: { op: "eq", var: "controle.utilizaSrp", value: when }, then: [a] };
    };
    const root: TemplateNode2[] = [
      { t: "paragraph", inline: [{ t: "text", v: "Veja o ANEXO " }, { t: "xref", target: "anx-b" }] },
      annex("anx-a", 1, true), annex("anx-b", 2),
    ];
    const on = composeRoot(root);
    const off = composeRoot(root, { sources: canonicalSources2(ORG_A, { CERTAME_CONFIG: { usesSrp: false, criterion: "menor_preco" } }) });
    if (!on.ok || !off.ok) throw new Error("falhou");
    expect(on.value.content.text).toContain("Veja o ANEXO II");
    expect(off.value.content.text).toContain("Veja o ANEXO I");
  });

  it("choice exactly-one: nenhum ramo ou mais de um ramo verdadeiro ⇒ CHOICE_NOT_EXACTLY_ONE; at-most-one tolera nenhum", () => {
    const choice = (mode: "exactly-one" | "at-most-one"): TemplateNode2 => ({
      t: "choice", groupKey: "g", mode, branches: [
        { key: "a", when: { op: "eq", var: "controle.utilizaSrp", value: true }, children: [P("A")] },
        { key: "b", when: { op: "eq", var: "controle.orcamentoSigiloso", value: "SIM" }, children: [P("B")] },
      ],
    });
    const none = { sources: canonicalSources2(ORG_A, { CERTAME_CONFIG: { usesSrp: false, criterion: "menor_preco" }, POLICY: { secretBudget: "NAO" } }) };
    const both = { sources: canonicalSources2(ORG_A, { POLICY: { secretBudget: "SIM" }, BUDGET: { estimatedTotalCents: 1, disclosureDate: "2026-12-01" } }) };
    expect(codes(composeRoot([choice("exactly-one")], none))).toContain("CHOICE_NOT_EXACTLY_ONE");
    expect(codes(composeRoot([choice("exactly-one")], both))).toContain("CHOICE_NOT_EXACTLY_ONE");
    expect(composeRoot([choice("at-most-one")], none).ok).toBe(true);
    expect(codes(composeRoot([choice("at-most-one")], both))).toContain("CHOICE_NOT_EXACTLY_ONE");
  });

  it("requiredWhen: orçamento sigiloso exige a data de divulgação (controle) — ausente ⇒ MISSING_REQUIRED", () => {
    const sig = { POLICY: { secretBudget: "SIM" } };
    expect(codes(composeTemplate(composeRequest2({ sources: canonicalSources2(ORG_A, { ...sig, BUDGET: { estimatedTotalCents: 3060000 } }) })))).toContain("MISSING_REQUIRED");
    // com a data presente compõe, escolhe o ramo sigiloso e a data de controle continua fora do texto
    const ok = compose({ sources: canonicalSources2(ORG_A, sig) });
    expect(ok.content.text).toContain("O orçamento estimado é sigiloso.");
    expect(ok.content.text).not.toContain("01/12/2026");
  });

  it("controle ausente porém obrigatório ⇒ MISSING_REQUIRED (não assume padrão)", () => {
    const src = canonicalSources2(ORG_A, { CERTAME_CONFIG: { criterion: "menor_preco" } });
    expect(codes(composeTemplate(composeRequest2({ sources: src })))).toContain("MISSING_REQUIRED");
  });
});

describe("composer v2 — valores, tabela e docRef", () => {
  it("valor fora do contrato do tipo ⇒ VALUE_TYPE_INVALID; linha de tabela inválida ⇒ erro (nunca degrada para texto)", () => {
    expect(codes(composeTemplate(composeRequest2({ sources: canonicalSources2(ORG_A, { BUDGET: { estimatedTotalCents: 30.6 } }) })))).toContain("VALUE_TYPE_INVALID");
    const bad = [{ ...ROWS[0], precoUnitario: "2,55" }];
    expect(composeTemplate(composeRequest2({ sources: canonicalSources2(ORG_A, { ITEMS: { rows: bad } }) })).ok).toBe(false);
  });

  it("tabela obrigatória vazia ⇒ MISSING_REQUIRED (não renderiza quadro sem itens em silêncio)", () => {
    expect(codes(composeTemplate(composeRequest2({ sources: canonicalSources2(ORG_A, { ITEMS: { rows: [] } }) })))).toContain("MISSING_REQUIRED");
  });

  it("docRef sem pin do documento ⇒ falha; pin de outro tenant ⇒ CROSS_TENANT_REFERENCE; hash diferente muda o hash de saída", () => {
    expect(composeTemplate(composeRequest2({ officialDocuments: {} })).ok).toBe(false);
    expect(codes(composeTemplate(composeRequest2({ officialDocuments: trPin2(ORG_B) })))).toContain("CROSS_TENANT_REFERENCE");
    const a = compose();
    const b = compose({ officialDocuments: trPin2(ORG_A, { contentHash: H("b") }) });
    expect(b.manifest.composedOutputHash).not.toBe(a.manifest.composedOutputHash);
    expect(b.content.text).toContain("hash bbbbbbbbbbbb");
  });

  it("docRef usado como 'latest' é irrepresentável: a AST é recusada na validação", () => {
    const root = [{ t: "docRef", kind: "TR", mode: "LATEST", role: "r", order: 1 }] as unknown as TemplateNode2[];
    expect(validateAnyTemplateAst({ schema: "tpl-ast/2", root }, catalog2).ok).toBe(false);
  });
});

describe("composer v2 — tenant, status, determinismo e replay", () => {
  it("snapshot de outro tenant ⇒ CROSS_TENANT_REFERENCE; organização ausente ⇒ ORGANIZATION_REQUIRED", () => {
    expect(codes(composeTemplate(composeRequest2({ sources: canonicalSources2(ORG_B) })))).toContain("CROSS_TENANT_REFERENCE");
    expect(codes(composeTemplate(composeRequest2({ organizationId: undefined as never })))).toContain("ORGANIZATION_REQUIRED");
  });

  it("rascunho não compõe documento novo", () => {
    const d = draftRevision2();
    expect(codes(composeTemplate(composeRequest2({ revision: d, pin: { identityId: d.identityId, revisionId: d.id, semanticHash: d.semanticHash } })))).toEqual(["BINDING_REVISION_NOT_PUBLISHED"]);
  });

  it("pin ausente/'latest' ⇒ recusado", () => {
    const rev = publishedRevision2();
    for (const pin of [null, { identityId: rev.identityId, revisionId: "latest", semanticHash: rev.semanticHash }]) {
      expect(codes(composeTemplate(composeRequest2({ revision: rev, pin })))).toEqual(["BINDING_REVISION_NOT_PINNED"]);
    }
  });

  it("v1 AST + catálogo v2 ⇒ CATALOG_FORMAT_MISMATCH", () => {
    const rev = publishedRevision2();
    const v1 = { ...rev, ast: { schema: "tpl-ast/1" as const, root: [] } };
    expect(codes(composeTemplate(composeRequest2({ revision: v1 })))).toContain("CATALOG_FORMAT_MISMATCH");
  });

  it("mesma entrada ⇒ mesmo texto, mesmo hash de saída e mesmo manifestHash; o relógio só afeta createdAt (fora do hash)", () => {
    const a = compose();
    const b = compose({ createdAt: "2030-01-01T00:00:00.000Z" });
    expect(b.content.text).toBe(a.content.text);
    expect(b.manifest.composedOutputHash).toBe(a.manifest.composedOutputHash);
    expect(b.manifest.manifestHash).toBe(a.manifest.manifestHash);
    expect(b.manifest.id).toBe(a.manifest.id);
  });

  it("a ordem das chaves das fontes e das linhas é irrelevante para o hash; a ordem das LINHAS é relevante", () => {
    const a = compose();
    const reordered = { ...canonicalSources2(), ITEMS: { organizationId: ORG_A, data: { lotCount: 3, rows: ROWS.map((r) => Object.fromEntries(Object.entries(r).reverse())) } } };
    expect(compose({ sources: reordered }).manifest.composedOutputHash).toBe(a.manifest.composedOutputHash);
    const swapped = canonicalSources2(ORG_A, { ITEMS: { rows: [...ROWS].reverse(), lotCount: 3 } });
    expect(compose({ sources: swapped }).manifest.composedOutputHash).not.toBe(a.manifest.composedOutputHash);
  });

  it("mudar um valor de FONTE muda o digest da fonte e o hash do manifest (rastreabilidade)", () => {
    const a = compose();
    const b = compose({ sources: canonicalSources2(ORG_A, { PROCESS: { number: "2026/0008", object: "x", technicalVisit: false } }) });
    expect(b.manifest.manifestHash).not.toBe(a.manifest.manifestHash);
  });

  it("AI slot: texto acima do limite ou de outro tenant é recusado; sem narrativa ⇒ marca de pendência", () => {
    const long = "palavra ".repeat(200);
    expect(composeTemplate(composeRequest2({ aiNarratives: [{ organizationId: ORG_A, slotKey: "justificativa", executionId: "e", text: long }] })).ok).toBe(false);
    expect(composeTemplate(composeRequest2({ aiNarratives: [{ organizationId: ORG_B, slotKey: "justificativa", executionId: "e", text: "ok" }] })).ok).toBe(false);
    const none = compose({ aiNarratives: [] });
    expect(none.content.text).toContain(PENDING_AI_SLOT_MARK("justificativa"));
    expect(none.manifest.aiNarratives).toHaveLength(0);
  });

  it("variável opcional ausente vira marca explícita de revisão, nunca vazio silencioso", () => {
    const src = canonicalSources2(ORG_A, { IDENTITY: { organizationName: "Órgão Sintético" } });
    expect(compose({ sources: src }).content.text).toContain(MISSING_VALUE_MARK("orgao.cnpj"));
  });

  it("o texto de saída nunca contém marcações de macro nem placeholders não resolvidos", () => {
    const t = compose().content.text;
    expect(t).not.toMatch(/\{\{|\}\}|\[\[|undefined|\[object/);
  });
});

describe("revalidação canônica com v2", () => {
  it("recomposição idêntica ⇒ sem divergência de autoridades; fonte alterada ⇒ divergência detectada", () => {
    const m1 = compose();
    const same = revalidateForIssuance({
      organizationId: ORG_A, generation: m1.manifest, recomposition: composeTemplate(composeRequest2({ purpose: "REVALIDATION" })),
      issuedContent: m1.content.text, humanEdits: [], aiAcceptances: [{
        organizationId: ORG_A, manifestId: m1.manifest.id, slotKey: "justificativa", executionId: m1.manifest.aiNarratives[0].executionId,
        outputHash: m1.manifest.aiNarratives[0].outputHash, acceptedByUserId: 9,
      }], acknowledgments: [], checkedAt: "2026-10-07T13:00:00.000Z",
    });
    expect(same.ok, JSON.stringify(same)).toBe(true);
    const moved = revalidateForIssuance({
      organizationId: ORG_A, generation: m1.manifest,
      recomposition: composeTemplate(composeRequest2({ purpose: "REVALIDATION", sources: canonicalSources2(ORG_A, { BUDGET: { estimatedTotalCents: 9999999, disclosureDate: "2026-12-01" } }) })),
      issuedContent: m1.content.text, humanEdits: [], aiAcceptances: [], acknowledgments: [], checkedAt: "2026-10-07T13:00:00.000Z",
    });
    expect(moved.ok).toBe(false);
  });
});

describe("fidelidade DOCX/PDF — o renderizador mantém a tabela e o 'R$' (defeito de conversão Word não é copiado)", () => {
  const meta = { documentTitle: "Aviso sintético", statusLabel: "GERADO", isDraft: false, version: 1, exportedAtLabel: "07/10/2026" };

  it("o modelo institucional preserva a tabela de itens (cabeçalhos e células) — antes era descartada", () => {
    const model = buildInstitutionalModel(compose().content.text, meta);
    const tables = model.blocks.filter((b) => b.kind === "table");
    expect(tables).toHaveLength(2);
    const t = tables[0];
    if (t.kind !== "table") throw new Error("esperado table");
    expect(t.header.map((c) => c.map((r) => r.text).join(""))).toEqual(["Item", "Descrição", "Quantidade", "Preço unitário (R$)", "Preço total (R$)"]);
    expect(t.rows[0].map((c) => c.map((r) => r.text).join(""))).toEqual(["1", "Papel A4 | 75g", "1.200", "R$ 25,50", "R$ 30.600,00"]);
  });

  it("DOCX gerado contém a tabela real (w:tbl) com 'Preço unitário (R$)', 'Preço total (R$)' e valores 'R$ …'", async () => {
    const buf = await renderInstitutionalDOCX(buildInstitutionalModel(compose().content.text, meta));
    const xml = readZipEntry(buf, "word/document.xml");
    expect(xml).not.toBeNull();
    expect(xml).toContain("<w:tbl>");
    const plain = (xml ?? "").replace(/<[^>]+>/g, "|");
    for (const frag of ["Preço unitário (R$)", "Preço total (R$)", "R$ 25,50", "R$ 30.600,00", "Papel A4 | 75g"]) expect(plain).toContain(frag);
  });

  it("PDF gerado sem erro com tabela (PDF válido)", async () => {
    const pdf = await renderInstitutionalPDF(buildInstitutionalModel(compose().content.text, meta));
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });
});

describe("pré-visualização e resumo são genéricos por versão", () => {
  it("preview de uma revisão v2 usa o mesmo caminho do composer, é determinístico e não usa IA", () => {
    const rev = draftRevision2();
    const values = {
      "processo.numero": "2026/0007", "orgao.nome": "Órgão Sintético", "orgao.cnpj": "11222333000181", "processo.objeto": "Objeto",
      "valor.estimado": 3060000, "valor.margem": 5.5, "certame.criterio": "menor_preco", "controle.utilizaSrp": false,
      "controle.orcamentoSigiloso": "NAO", "certame.prazoVigencia": { amount: 1, unit: "month" }, "processo.visitaTecnica": false,
      "certame.dataAbertura": "2026-11-05T09:30", "etp.lotes": ["Lote 1"],
      "itens.quadro": [{ item: 1, descricao: "x", quantidade: 1, precoUnitario: 100 }],
    };
    const a = previewComposeOutcome({ revision: rev, catalog: catalog2, values, aiNarratives: {}, identity: identity2 });
    const b = previewComposeOutcome({ revision: rev, catalog: catalog2, values, aiNarratives: {}, identity: identity2 });
    expect(a).toEqual(b);
    if (!("content" in a)) throw new Error(JSON.stringify(a));
    expect(a.content.text).toContain("Conforme o item 2.1 e a cláusula 1.1.");
    expect(a.manifestDraft.aiNarratives).toEqual([]);
  });

  it("resumo da AST v2 conta nós, condicionais (conditional + choice), variáveis e docRefs", () => {
    const s = summarizeAst(ast2);
    expect(s.conditionalCount).toBe(2);
    expect(s.variables).toContain("controle.utilizaSrp");
    expect(s.annexIds.sort()).toEqual(["anexo-modelo", "anexo-tr"]);
    expect(s.aiSlotKeys).toEqual(["justificativa"]);
  });
});
