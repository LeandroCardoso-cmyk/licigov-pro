/**
 * Modelo EDITAL_PREGAO_ELETRONICO_BLL (v1.0.1-draft) — dados governados + AST canônica compilada do mestre aprovado.
 *
 * Roda SEM o arquivo-mestre: valida a AST/catálogo/mapeamento versionados em
 * `server/domain/institutionalTemplates/models/edital-pregao-eletronico-bll/` e a composição em uma matriz de cenários.
 * (A reprodução da compilação a partir do Markdown aprovado está em `institutional-templates-bll-master-source.test.ts`.)
 * Nada aqui cadastra o modelo, cria binding, publica ou ativa flag: valores de amostra SINTÉTICOS, sem DB.
 */
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { validateAnyTemplateAst, validateVariableCatalog2, type TemplateAST2, type TemplateNode2 } from "../../domain/institutionalTemplates";
import { composeTemplate } from "../../domain/institutionalTemplates/composer";
import { validateMasterMapping, evaluateParityGate, type ParityReport } from "../../domain/institutionalTemplates/masterCompiler";
import { revisionSemanticHash } from "../../domain/institutionalTemplates/semanticHash";
import { buildInstitutionalModel, renderInstitutionalDOCX, renderInstitutionalPDF } from "../../services/documentConverter";
import {
  BASE_SCENARIO, BLL_MD_SHA256, BLL_MODEL_DIR, FULL_SCENARIO, bllCatalog, bllComposeRequest, bllMapping,
} from "../helpers/institutionalTemplatesBllHarness";
import { readZipEntry } from "../helpers/zipText";

const readJson = <T,>(f: string): T => JSON.parse(readFileSync(path.join(BLL_MODEL_DIR, f), "utf8")) as T;
const ast = readJson<TemplateAST2>("ast.json");
const report = readJson<{ astSemanticHash: string; report: ParityReport; findings: { id: string; description: string }[] }>("report.json");
const provenance = readJson<{ sourceSha256: string; mappingSha256: string; catalogVersion: string; sourceLogicalVersion: string; modelKey: string }>("provenance.json");

const AI_SLOTS = ["justificativa-art49-lc123", "justificativa-vedacao-consorcio", "justificativa-vedacao-subcontratacao", "obrigacoes-especificas-contratado", "obrigacoes-especificas-contratante", "finalidades-tratamento-dados"];
const NARR = AI_SLOTS.map((slotKey) => ({ organizationId: 975001, slotKey, executionId: `aiexec_${slotKey}`, text: `Texto proposto para ${slotKey}, sujeito a revisão humana.` }));

const SCENARIOS: Record<string, Record<string, unknown>> = {
  BASE: BASE_SCENARIO,
  FULL: FULL_SCENARIO,
  FULL_INVERSAO: { ...FULL_SCENARIO, "decisao.inversaoFases": true },
  DESCONTO: { ...BASE_SCENARIO, "julgamento.criterioJulgamento": "maior desconto", "julgamento.modoDisputa": "aberto e fechado" },
  SIGILOSO: { ...BASE_SCENARIO, "controle.orcamentoSigilosoSimNao": true },
  VEDACOES: {
    ...BASE_SCENARIO, "decisao.consorcio": "veda", "controle.utilizaSrp": true, "decisao.adesaoAta": "admite", "decisao.instrumentoContratual": "equivalente",
    "decisao.tratamentoRegional": true, "decisao.modalidadeTratamentoRegional": "exclusividade", "decisao.servicoOuFornecimentoContinuo": true,
  },
};
const compose = (name: string, over: Record<string, unknown> = {}, omit: readonly string[] = []) => composeTemplate(bllComposeRequest(ast, { ...SCENARIOS[name], ...over }, { aiNarratives: NARR }, omit));
const okText = (name: string, over: Record<string, unknown> = {}): string => {
  const r = compose(name, over);
  if (!r.ok) throw new Error(`${name}: ${JSON.stringify(r.issues).slice(0, 800)}`);
  return r.value.content.text;
};
const codes = (r: { ok: boolean; issues?: readonly { code: string }[] }): string[] => (r.ok ? [] : (r.issues ?? []).map((i) => i.code));

interface Walked { node: TemplateNode2 | Record<string, unknown>; ancestors: readonly Record<string, unknown>[] }
function walkAll(root: unknown, visit: (n: Record<string, unknown>, ancestors: readonly Record<string, unknown>[]) => void): void {
  const go = (x: unknown, anc: Record<string, unknown>[]): void => {
    if (Array.isArray(x)) { x.forEach((y) => go(y, anc)); return; }
    if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      const isNode = typeof o.t === "string" || (typeof o.key === "string" && Array.isArray(o.children));
      if (isNode) visit(o, anc);
      const next = isNode ? [...anc, o] : anc;
      for (const v of Object.values(o)) go(v, next);
    }
  };
  go(root, []);
}
void ({} as Walked);

describe("BLL — proveniência e dados governados", () => {
  it("o mapeamento aponta para o MD aprovado (sha256 6795b2ab…) e ao catálogo exato; a AST versionada tem o hash registrado", () => {
    expect(provenance.sourceSha256).toBe(BLL_MD_SHA256);
    expect(provenance.modelKey).toBe("EDITAL_PREGAO_ELETRONICO_BLL");
    expect(provenance.sourceLogicalVersion).toBe("1.0.1-draft");
    expect(provenance.catalogVersion).toBe(bllCatalog.version);
    expect(bllMapping.catalogVersion).toBe(bllCatalog.version);
    expect(revisionSemanticHash({ ast, variableCatalogVersion: bllCatalog.version })).toBe(report.astSemanticHash);
  });

  it("catálogo v2 e mapeamento são válidos; a AST compilada passa nas MESMAS regras do runtime", () => {
    expect(validateVariableCatalog2(bllCatalog).ok).toBe(true);
    expect(validateMasterMapping(bllMapping, bllCatalog)).toEqual([]);
    const v = validateAnyTemplateAst(ast, bllCatalog);
    if (!v.ok) throw new Error(JSON.stringify(v.issues).slice(0, 500));
  });

  it("160 entradas = 157 renderizáveis + 3 controles; 6 'Propõe' só como aiSlot; 5 tabelas dinâmicas; 1 docRef", () => {
    const kinds = Object.values(bllMapping.inputs).reduce<Record<string, number>>((a, d) => { a[d.kind] = (a[d.kind] ?? 0) + 1; return a; }, {});
    expect(Object.keys(bllMapping.inputs)).toHaveLength(160);
    expect(kinds).toEqual({ variable: 145, control: 3, aiSlot: 6, dataTable: 5, docRef: 1 });
    expect(160 - kinds.control).toBe(157);
    const controls = Object.entries(bllMapping.inputs).filter(([, d]) => d.kind === "control").map(([n]) => n).sort();
    expect(controls).toEqual(["DATA_DIVULGACAO_PREVISTA", "ORCAMENTO_SIGILOSO_SIM_NAO", "UTILIZA_SRP"]);
    const ai = Object.entries(bllMapping.inputs).filter(([, d]) => d.kind === "aiSlot").map(([n]) => n).sort();
    expect(ai).toEqual(["FINALIDADES_TRATAMENTO_DADOS", "JUSTIFICATIVA_ART_49_LC123", "JUSTIFICATIVA_VEDACAO_CONSORCIO", "JUSTIFICATIVA_VEDACAO_SUBCONTRATACAO", "OBRIGACOES_ESPECIFICAS_CONTRATADO", "OBRIGACOES_ESPECIFICAS_CONTRATANTE"]);
  });

  it("o relatório de paridade versionado passa no gate parametrizado (160/157/3/48/80, 0 desconhecidos, 0 sem ocorrência, 0 residuais)", () => {
    expect(evaluateParityGate(report.report, bllMapping)).toEqual({ pass: true, failures: [] });
    expect(report.report).toMatchObject({
      mappedInputs: 160, renderCapableInputs: 157, controlInputs: 3, unknownPlaceholders: [], unmappedInputs: [], residualPlaceholders: 0,
      conditionTypesMapped: 48, conditionBlocks: 80, inlineConditionBlocks: 2, balancedConditions: true, systemNotes: 51, systemNotesRendered: 0,
      aiSlots: 6, annexes: 5, noteOnlyInputs: ["DATA_DIVULGACAO_PREVISTA", "ORCAMENTO_SIGILOSO_SIM_NAO", "UTILIZA_SRP"],
    });
    expect(report.report.crossReferences.unmappedRemissions).toBe(0);
    expect(report.report.conditionTypesUnused).toEqual([]);
    expect(report.report.catalogRenderableVarsNotInMapping).toEqual([]);
  });
});

describe("BLL — condicionais, grupos excludentes e controles na AST", () => {
  const found: Record<string, number> = {};
  let inlineWhen = 0; let conditionals = 0; let branches = 0; let guards = 0;
  walkAll(ast.root, (n) => {
    if (n.t === "conditional") { const w = n.when as { op: string }; if (w.op === "present") guards += 1; else { conditionals += 1; found[JSON.stringify(n.when)] = (found[JSON.stringify(n.when)] ?? 0) + 1; } }
    if (n.t === "when") { inlineWhen += 1; found[JSON.stringify(n.when)] = (found[JSON.stringify(n.when)] ?? 0) + 1; }
    if (n.t === "choice") for (const b of n.branches as { when: unknown }[]) { branches += 1; found[JSON.stringify(b.when)] = (found[JSON.stringify(b.when)] ?? 0) + 1; }
  });

  it("os 48 tipos de condição aparecem na AST: 38 blocos + 40 ramos de grupo + 2 inline = 80 blocos (+1 guard governado)", () => {
    expect(conditionals).toBe(38);
    expect(branches).toBe(40);
    expect(inlineWhen).toBe(2);
    expect(conditionals + branches + inlineWhen).toBe(80);
    expect(guards).toBe(1);
    for (const [type, c] of Object.entries(bllMapping.conditions)) expect(found[JSON.stringify(c.when)], type).toBeGreaterThan(0);
    expect(Object.keys(bllMapping.conditions)).toHaveLength(48);
  });

  it("20 grupos excludentes viram `choice` (exactly-one, exceto prorrogação contratual: at-most-one); o grupo ausente nunca é inferido", () => {
    const modes: Record<string, string[]> = {};
    walkAll(ast.root, (n) => { if (n.t === "choice") (modes[n.mode as string] ??= []).push(String(n.groupKey)); });
    expect(modes["exactly-one"]).toHaveLength(19);
    expect(modes["at-most-one"]).toEqual(["prorrogacao"]);
    expect(Object.keys(bllMapping.exclusiveGroups)).toHaveLength(13);
  });

  it("controles: 3 controlRef no início; nenhuma variável de controle ou de decisão é usada em texto", () => {
    expect(ast.root.slice(0, 3).map((n) => n.t)).toEqual(["controlRef", "controlRef", "controlRef"]);
    const nonRenderable = new Set(bllCatalog.vars.filter((v) => !v.renderable).map((v) => v.name));
    walkAll(ast.root, (n) => { if (n.t === "var") expect(nonRenderable.has(n.name as string), String(n.name)).toBe(false); });
    expect(nonRenderable.size).toBe(35); // 3 controles do mestre + 32 decisões de composição (renderable=false)
  });

  it("sigilo: o valor estimado só existe sob a condição 'orçamento público'; as colunas de valor do quadro de itens são condicionais", () => {
    const publico = JSON.stringify(bllMapping.conditions.SE_ORCAMENTO_PUBLICO.when);
    let hits = 0;
    const visit = (nodes: readonly unknown[], guarded: boolean): void => {
      for (const n of nodes as Record<string, unknown>[]) {
        const g = guarded || (n.t === "conditional" && JSON.stringify(n.when) === publico);
        if (n.t === "choice") for (const b of n.branches as { when: unknown; children: unknown[] }[]) visit(b.children, g || JSON.stringify(b.when) === publico);
        else if (Array.isArray(n.then)) { visit(n.then as unknown[], g); if (Array.isArray(n.else)) visit(n.else as unknown[], g); }
        else if (Array.isArray(n.children)) visit(n.children as unknown[], g);
        if (JSON.stringify(n).includes('"name":"julgamento.valorEstimado"') && !("children" in n) && !("then" in n) && !("branches" in n)) { hits += 1; expect(g, JSON.stringify(n).slice(0, 120)).toBe(true); }
      }
    };
    visit(ast.root, false);
    expect(hits).toBeGreaterThan(0);
    const itens = bllMapping.inputs.QUADRO_ITENS_CONTRATACAO;
    if (itens.kind !== "dataTable") throw new Error("dataTable esperado");
    expect(itens.columns.filter((c) => c.when).map((c) => c.key)).toEqual(["valorUnitarioEstimado", "valorTotalEstimado"]);
  });

  it("aiSlot: exatamente os 6 campos 'Propõe'; anexo I referencia o TR por pin exato; Anexo V só dentro de SE_SRP_ATA", () => {
    const slots: string[] = [];
    walkAll(ast.root, (n) => { if (n.t === "aiSlot") slots.push(n.slotKey as string); });
    expect(slots.sort()).toEqual([...AI_SLOTS].sort());
    const docs: Record<string, unknown>[] = [];
    walkAll(ast.root, (n) => { if (n.t === "docRef") docs.push(n); });
    expect(docs).toEqual([{ t: "docRef", kind: "TR", mode: "EXACT_PINNED", role: "termo-referencia", order: 1 }]);
    const annexes: string[] = [];
    walkAll(ast.root, (n, anc) => {
      if (n.t === "annex") annexes.push(`${n.id}:${anc.map((a) => a.t).join(">")}`);
    });
    expect(annexes).toEqual([
      "anexo-termo-referencia:", "anexo-proposta:", "anexo-declaracoes:", "anexo-contrato:", "anexo-ata:conditional",
    ]);
  });
});

describe("BLL — composição em matriz de cenários (fonte canônica sintética)", () => {
  it("todos os cenários compõem; o texto final não tem placeholder, nota de sistema, marcador de auditoria nem remissão quebrada", () => {
    for (const name of Object.keys(SCENARIOS)) {
      const t = okText(name);
      for (const re of [/\{\{|\}\}/, /SYSTEM NOTE/, /NÃO EXPORTAR/, /\[REF\?/, /\[REVISAR/, /⟦|⟧/, /MUNICIPAL_REGULATION_SOURCE_NOT_VERIFIED|HUMAN_DECISION_REQUIRED|LEGAL_REVIEW_REQUIRED|BLL_CONFIGURATION_REQUIRED/]) {
        expect(re.test(t), `${name}: ${String(re)}`).toBe(false);
      }
    }
  });

  it("numeração recalculada e remissões acompanham os blocos removidos (Seção de sanções e itens citados)", () => {
    const base = okText("BASE");
    const full = okText("FULL");
    const num = (t: string): string => /^## (\d+)\. DAS INFRAÇÕES E DAS SANÇÕES ADMINISTRATIVAS$/m.exec(t)![1];
    expect(num(full)).toBe("30"); // com SRP (seção 22) e garantia (seção 29): numeração do texto-fonte
    expect(num(base)).toBe("27"); // sem as seções 22 e 29 e sem a seção 16 opcional do cenário
    expect(base).toContain(`na forma da Seção ${num(base)}`);
    expect(base).not.toContain("na forma da Seção 30");
    expect(full).toContain("na forma da Seção 30");
  });

  it("modo de julgamento: exatamente um ramo por grupo; critério/modo alteram o texto e o quadro-resumo", () => {
    expect(okText("BASE")).toContain("| Critério de julgamento | menor preço |");
    expect(okText("DESCONTO")).toContain("| Critério de julgamento | maior desconto |");
    expect(okText("DESCONTO")).toContain("modo de disputa **aberto e fechado**");
    expect(okText("BASE")).toContain("a) o preço unitário e o preço total de cada item ofertado");
    expect(okText("DESCONTO")).toContain("a) o percentual de desconto ofertado");
  });

  it("sigilo: orçamento sigiloso nunca renderiza o valor estimado nem as colunas de valor do quadro; público renderiza", () => {
    const sig = okText("SIGILOSO");
    const pub = okText("BASE");
    expect(sig).not.toContain("9.876,54");
    expect(sig).not.toContain("Valor unitário estimado");
    expect(sig).toContain("O orçamento estimado desta contratação tem caráter sigiloso");
    expect(pub).toContain("R$ 9.876,54");
    expect(pub).toContain("Valor unitário estimado (R$)");
  });

  it("alíneas e sub-itens automáticos sem lacuna (9.3: marca/modelo ausente ⇒ 'd)' vira 'c)'; presente ⇒ a–d)", () => {
    const base = okText("BASE");
    const full = okText("FULL");
    expect(base).toMatch(/^b\) a descrição do objeto ofertado/m);
    expect(base).toMatch(/^c\) as demais informações exigidas pelo sistema/m);
    expect(full).toMatch(/^c\) a marca e o modelo do bem ofertado/m);
    expect(full).toMatch(/^d\) as demais informações exigidas pelo sistema/m);
    expect(full).toMatch(/^b\.1\) os documentos da alínea "b" limitar-se-ão/m);
  });

  it("cláusulas da minuta renumeram com os blocos (repactuação/garantia) e a remissão 'Cláusula Primeira' é resolvida", () => {
    const base = okText("BASE");
    const full = okText("FULL");
    expect(full).toContain("### CLÁUSULA NONA — DA REPACTUAÇÃO");
    expect(base).not.toMatch(/### CLÁUSULA [A-ZÀ-Ý ]+ — DA REPACTUAÇÃO/);
    expect(base).toContain("### CLÁUSULA NONA — DO REEQUILÍBRIO ECONÔMICO-FINANCEIRO");
    expect(full).toContain("### CLÁUSULA DÉCIMA — DO REEQUILÍBRIO ECONÔMICO-FINANCEIRO");
    expect(full).toContain("conforme os preços unitários do quadro da Cláusula Primeira");
  });

  it("campos pós-homologação ficam 'a preencher' (nunca dado fictício nem marca [REVISAR]) quando o resultado ainda não existe", () => {
    const omit = ["pos.numeroContrato", "pos.contratadoRazaoSocial", "pos.quadroItensContratados"];
    const r = composeTemplate(bllComposeRequest(ast, SCENARIOS.BASE, { aiNarratives: NARR }, omit));
    if (!r.ok) throw new Error(JSON.stringify(r.issues).slice(0, 500));
    expect(r.value.content.text).toContain("CONTRATO Nº a preencher/");
    expect(r.value.content.text).toContain("CELEBRAM O Texto sintético de instituicao.municipioNome E a preencher");
    expect(r.value.content.text).not.toContain("REVISAR");
  });

  it("falha fechada: campo obrigatório, decisão obrigatória, campo condicional e controle ausentes", () => {
    expect(codes(compose("BASE", {}, ["instituicao.municipioNome"]))).toContain("MISSING_REQUIRED");
    expect(codes(compose("BASE", {}, ["decisao.formaJulgamento"]))).toContain("MISSING_REQUIRED");
    expect(codes(compose("BASE", {}, ["controle.dataDivulgacaoPrevista"]))).toContain("MISSING_REQUIRED");
    expect(codes(compose("BASE", { "decisao.exigeGarantiaContratual": true }, ["contratacao.percentualGarantiaContratual"]))).toContain("MISSING_REQUIRED");
    expect(codes(compose("BASE", { "decisao.consorcio": "talvez" }))).toContain("VALUE_TYPE_INVALID");
  });

  it("IA só nos slots: sem narrativa o slot fica pendente (marca explícita); com narrativa entra com humanAccepted=false no M1", () => {
    const pending = composeTemplate(bllComposeRequest(ast, SCENARIOS.BASE, { aiNarratives: [] }));
    if (!pending.ok) throw new Error(JSON.stringify(pending.issues).slice(0, 500));
    expect(pending.value.content.text).toContain('[REVISAR: narrativa "obrigacoes-especificas-contratado" pendente');
    const r = compose("BASE");
    if (!r.ok) throw new Error("falhou");
    expect(r.value.manifest.aiNarratives.length).toBeGreaterThan(0);
    expect(r.value.manifest.aiNarratives.every((n) => n.humanAccepted === false)).toBe(true);
  });

  it("determinismo: mesma entrada ⇒ mesmo texto/hash; decisão diferente ⇒ hash diferente; relógio fora do hash", () => {
    const a = compose("FULL"); const b = compose("FULL");
    if (!a.ok || !b.ok) throw new Error("falhou");
    expect(b.value.composedOutputHash).toBe(a.value.composedOutputHash);
    expect(b.value.manifest.manifestHash).toBe(a.value.manifest.manifestHash);
    const c = composeTemplate(bllComposeRequest(ast, SCENARIOS.FULL, { aiNarratives: NARR, createdAt: "2031-01-01T00:00:00.000Z" }));
    if (!c.ok) throw new Error("falhou");
    expect(c.value.manifest.manifestHash).toBe(a.value.manifest.manifestHash);
    const d = compose("BASE");
    if (!d.ok) throw new Error("falhou");
    expect(d.value.composedOutputHash).not.toBe(a.value.composedOutputHash);
  });
});

describe("BLL — achado de fidelidade do DOCX: o renderizador preserva '(R$)' e as tabelas", () => {
  it("o achado fica registrado como linhagem (no relatório e no mapeamento), nunca na AST; o snapshot congelado não é tocado", () => {
    expect(bllMapping.findings?.map((f) => f.id)).toEqual(["DOCX-ANEXO-II-PRECO"]);
    expect(report.findings.map((f) => f.id)).toEqual(["DOCX-ANEXO-II-PRECO"]);
    expect(JSON.stringify(ast)).not.toContain("DOCX-ANEXO-II-PRECO");
    expect(bllMapping.findings?.[0].description).toContain("5927f257c82599faff208994b02aae8a9b094c491b66b0bc12cdf0f6d8f38fa9");
  });

  it("o Markdown composto mantém os cabeçalhos monetários e DOCX/PDF gerados pelo Document Engine preservam tabela, '(R$)' e valores", async () => {
    const text = okText("BASE");
    const header = "| Item/Lote | Descrição do objeto ofertado | Marca/Modelo (quando exigido) | Unidade | Quantidade | Preço unitário (R$) | Preço total (R$) |";
    expect(text).toContain(header);
    const meta = { documentTitle: "Edital sintético", statusLabel: "GERADO", isDraft: false, version: 1, exportedAtLabel: "07/10/2026" };
    const model = buildInstitutionalModel(text, meta);
    const mdTables = model.blocks.filter((b) => b.kind === "table").length;
    expect(mdTables).toBeGreaterThanOrEqual(5);
    const docx = await renderInstitutionalDOCX(model);
    const xml = readZipEntry(docx, "word/document.xml") ?? "";
    expect(xml.split("<w:tbl>").length - 1).toBe(mdTables);
    expect(xml).not.toContain("<m:oMath"); // nenhuma matemática em linha: o "$" de "R$" não é interpretado
    const plain = xml.replace(/<[^>]+>/g, "|");
    for (const frag of ["Preço unitário (R$)", "Preço total (R$)", "Valor unitário estimado (R$)", "R$ 25,50", "R$ 9.876,54"]) expect(plain, frag).toContain(frag);
    const pdf = await renderInstitutionalPDF(model);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });
});
