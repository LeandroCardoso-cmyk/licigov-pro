/**
 * DFD assistido (1º consumidor do Contexto Canônico) — prefill determinístico, MESMO template, marcadores de
 * linhagem por campo, estado por campo, override humano, desatualização/reconciliação explícita, rascunho de
 * IA marcado e extração das afirmações humanas. Casos 1–14.
 */
import { describe, it, expect } from "vitest";
import {
  resolveCanonicalContext, canonicalItemKey, itemPath, factValueHash,
  type ContextInputs, type FactAssertion, type ContextPath, type ContextSourceType, type FactValue,
} from "../../domain/canonicalProcurementContext";
import {
  buildDFDPrefill, renderDFDContent, prefillMarkers, writeMarkers, readMarkers, computeDFDFieldStates,
  reconcileDFDField, applyAIJustification, extractDFDAssertions, parseDFD, summarizeFieldStates, parseQuantityPtBr, unlinkedDFDRows,
  type DFDFieldView,
} from "../../domain/dfdPrefill";
import { buildDFDDraft } from "../../domain/generatedDocument";

let seq = 100;
function fact(path: ContextPath, value: FactValue, sourceType: ContextSourceType, extra: Partial<FactAssertion> = {}): FactAssertion {
  return {
    id: ++seq, path, value, valueHash: factValueHash(value), sourceType, sourceId: `${sourceType}-1`, sourceVersion: "v1",
    status: "confirmed", actorUserId: 3, basisValueHash: null, createdAt: "2026-02-01T10:00:00.000Z", ...extra,
  };
}

const ITEMS = [
  { id: "i1", description: "Cadeira giratória", unit: "UN", quantity: 1, status: "aprovado", averagePriceCents: 45_000, quoteCount: 3 },
  { id: "i2", description: "Mesa de escritório", unit: "UN", quantity: 1, status: "aprovado", averagePriceCents: 80_000, quoteCount: 3 },
  { id: "i3", description: "Armário de aço", unit: "UN", quantity: 1, status: "aprovado", averagePriceCents: 120_000, quoteCount: 3 },
];
/** Ids ESTÁVEIS dos Itens Canônicos (24 hex, como no sistema) — nunca derivados da descrição. */
const K = ["a1a1a1a1a1a1a1a1a1a1a1a1", "b2b2b2b2b2b2b2b2b2b2b2b2", "c3c3c3c3c3c3c3c3c3c3c3c3"];
/** Itens confirmados na Área de Itens, vinculados às evidências da Pesquisa (preço por item). */
const PITEMS = ITEMS.map((i, n) => ({
  id: K[n], description: i.description, unit: i.unit, lotId: null, ordinal: n + 1, status: "active", revision: 1,
  fingerprint: canonicalItemKey(i.description, i.unit),
}));
const LINKS = ITEMS.map((i, n) => ({ itemId: K[n], intelligentItemId: i.id }));

/** Fixture do enunciado: objeto, unidade requisitante, responsável, 3 itens com quantidade prevista e contexto básico. */
function fixture(extra: FactAssertion[] = [], over: Partial<ContextInputs> = {}) {
  const base: FactAssertion[] = [
    fact("demand.requestingUnit", "Secretaria Municipal de Educação", "process", { sourceId: "proc-1" }),
    fact(itemPath(K[0], "plannedQuantity"), 30, "user"),
    fact(itemPath(K[1], "plannedQuantity"), 10, "user"),
    fact(itemPath(K[2], "plannedQuantity"), 5, "user"),
    fact("planning.pcaAlignment", "Item previsto no PCA 2026 (linha 42).", "user"),
    fact("planning.priority", "alta", "user"),
  ];
  return resolveCanonicalContext({
    organizationId: 7, processId: "proc-1",
    process: { number: "2026/0001", object: "Mobiliário escolar", responsibleUserId: 3, createdAt: "2026-01-01T00:00:00.000Z" },
    responsibleUserName: "Servidora Responsável",
    organization: { name: "Prefeitura de Teste", municipio: "Teste", uf: "PR" },
    // Afirmações extras são POSTERIORES às da fixture (ledger monotônico).
    assertions: [...base, ...extra.map((e) => ({ ...e, id: ++seq }))], intelligentItems: ITEMS,
    procurementItems: PITEMS, priceLinks: LINKS, ...over,
  });
}

function open(ctx = fixture()) {
  const prefill = buildDFDPrefill(ctx);
  const content = renderDFDContent(prefill);
  const sources = writeMarkers(["estrutura:art_12_par_1_lei_14133"], prefillMarkers(prefill));
  return { ctx, prefill, content, sources };
}
const stateOf = (views: DFDFieldView[], key: string) => views.find((v) => v.key === key)!;

describe("DFD assistido — prefill a partir do Contexto Canônico", () => {
  it("1) fixture do enunciado: DFD abre PRÉ-PREENCHIDO (unidade, responsável, 3 itens com quantidade prevista, planejamento, estimativa)", () => {
    const { content, prefill, sources } = open();
    expect(content).toContain("Objeto: Mobiliário escolar");
    expect(content).toContain("Setor/unidade demandante: Secretaria Municipal de Educação");
    expect(content).toContain("Responsável pela demanda: Servidora Responsável");
    expect(content).toContain("| Item | Descrição | Unidade | Quantidade prevista |");
    expect(content).toContain("| Cadeira giratória | UN | 30 |");
    expect(content).toContain("| Mesa de escritório | UN | 10 |");
    expect(content).toContain("| Armário de aço | UN | 5 |");
    expect(content).toContain("Item previsto no PCA 2026 (linha 42).");
    expect(content).toContain("Prioridade: alta");
    // 30×450 + 10×800 + 5×1200 = 13.500 + 8.000 + 6.000
    expect(content).toContain("R$ 27.500,00");
    const views = computeDFDFieldStates(content, sources, prefill);
    const s = summarizeFieldStates(views);
    expect(s.prefilled).toBeGreaterThanOrEqual(10); // maioria dos campos já preenchida
    expect(s.unknown).toBe(2);                      // justificativa (narrativa) + prazo pretendido
  });

  it("2) MESMO template: mesmas seções, rótulos, ordem e rodapé do DFD histórico", () => {
    const heads = (t: string) => t.split("\n").filter((l) => /^#|^> |^Objeto:|^Setor|^Responsável|^Prioridade:|^Memória/.test(l)).map((l) => l.split(":")[0]);
    expect(heads(open().content)).toEqual(heads(buildDFDDraft("Mobiliário escolar")));
  });

  it("3) sem contexto além do objeto: placeholders históricos preservados (nada inventado)", () => {
    const ctx = resolveCanonicalContext({
      organizationId: 7, processId: "p", process: { number: "1", object: "Objeto X", responsibleUserId: 3, createdAt: "2026-01-01T00:00:00.000Z" },
      responsibleUserName: null, organization: null, assertions: [], intelligentItems: [],
    });
    const content = renderDFDContent(buildDFDPrefill(ctx));
    expect(content).toContain("Setor/unidade demandante: [preencher]");
    expect(content).toContain("Quantidade estimada: [preencher] · Unidade: [preencher]");
    expect(content).toContain("Prioridade: [baixa/média/alta]");
    const parsed = parseDFD(content);
    expect(parsed.values["identificacao.unidade"]).toBeNull();
    expect(parsed.values.orcamento).toBeNull();
  });

  it("4) marcadores de linhagem: versão/digest do contexto consumido + origem por campo pré-preenchido", () => {
    const { sources, ctx } = open();
    const mk = readMarkers(sources);
    expect(sources).toContain("estrutura:art_12_par_1_lei_14133");
    expect(sources).toContain("ctx:canonical-context/1");
    expect(mk.contextDigest).toBe(ctx.digest.slice(0, 16));
    expect(mk.contextVersion).toBe(ctx.version);
    expect(mk.prefill["identificacao.unidade"].origin).toBe("process");
    expect(mk.prefill[`item:${K[0]}`].origin).toBe("user");
    expect(mk.prefill.orcamento.origin).toBe("derived");
    expect(mk.prefill["prioridade.prazo"]).toBeUndefined(); // desconhecido não é marcado
  });

  it("5) prefill ≠ aprovação/decisão: justificativa (narrativa) NUNCA é preenchida por fatos", () => {
    const { content, sources, prefill } = open();
    expect(content).toContain("Descrever a necessidade pública que motiva a contratação");
    expect(stateOf(computeDFDFieldStates(content, sources, prefill), "justificativa").state).toBe("unknown");
  });

  it("6) edição humana → 'Alterado por você' e NUNCA sobrescrita pelo recálculo", () => {
    const { content, sources, prefill } = open();
    const edited = content.replace("Setor/unidade demandante: Secretaria Municipal de Educação", "Setor/unidade demandante: Gabinete do Prefeito");
    const v = stateOf(computeDFDFieldStates(edited, sources, prefill), "identificacao.unidade");
    expect(v.state).toBe("conflict"); // humano diverge do Processo (ainda não salvo como fato)
    expect(v.documentValue).toBe("Gabinete do Prefeito");
    // Depois de salvo, o DFD é a fonte do fato → estado normal "alterado por você".
    const drafts = extractDFDAssertions(edited, sources, fixture());
    const saved = fixture(drafts.map((d) => fact(d.path, d.value, "dfd", { basisValueHash: d.basisValueHash, sourceId: "gdoc-1" })));
    const after = stateOf(computeDFDFieldStates(edited, sources, buildDFDPrefill(saved)), "identificacao.unidade");
    expect(after.state).toBe("user_modified");
    expect(saved.demand.requestingUnit.value).toBe("Gabinete do Prefeito");
  });

  it("7) informação de origem mudou (campo intocado) → DESATUALIZADO + 'Atualizar no rascunho' só naquele campo", () => {
    const { content, sources, ctx } = open();
    const changed = fixture([fact(itemPath(K[0], "plannedQuantity"), 40, "user", { basisValueHash: ctx.items.find((i) => i.key === K[0])!.plannedQuantity.valueHash })]);
    const current = buildDFDPrefill(changed);
    const v = stateOf(computeDFDFieldStates(content, sources, current), `item:${K[0]}`);
    expect(v).toMatchObject({ state: "stale", reconcilable: true, documentValue: "30", contextValue: "40" });
    const r = reconcileDFDField(content, sources, `item:${K[0]}`, current)!;
    expect(r.content).toContain("| Cadeira giratória | UN | 40 |");
    expect(r.content).toContain("| Mesa de escritório | UN | 10 |"); // outros campos intocados
    expect(r.content.split("\n").filter((l, i) => l !== content.split("\n")[i]).length).toBe(1);
    expect(stateOf(computeDFDFieldStates(r.content, r.sources, current), `item:${K[0]}`).state).toBe("prefilled");
  });

  it("8) humano editou E a origem mudou → CONFLITO visível (nada muda em silêncio)", () => {
    const { content, sources } = open();
    const edited = content.replace("Prioridade: alta", "Prioridade: média");
    const changed = buildDFDPrefill(fixture([fact("planning.priority", "baixa", "user", { sourceId: "user-2" })]));
    const views = computeDFDFieldStates(edited, sources, changed);
    expect(stateOf(views, "prioridade.grau").state).toBe("conflict");
    expect(parseDFD(edited).values["prioridade.grau"]).toBe("média"); // documento intacto
  });

  it("9) campo vazio no DFD e informação disponível no contexto → 'disponível' + preenchimento explícito", () => {
    const { content, sources } = open();
    const current = buildDFDPrefill(fixture([fact("planning.desiredDate", "até março de 2026", "user")]));
    const v = stateOf(computeDFDFieldStates(content, sources, current), "prioridade.prazo");
    expect(v).toMatchObject({ state: "available", reconcilable: true });
    const r = reconcileDFDField(content, sources, "prioridade.prazo", current)!;
    expect(r.content).toContain("Prioridade: alta · Prazo pretendido para a contratação: até março de 2026");
  });

  it("10) reload-safe: estado é função pura do conteúdo salvo + marcadores + contexto (idempotente)", () => {
    const { content, sources, prefill } = open();
    const a = computeDFDFieldStates(content, sources, prefill);
    const b = computeDFDFieldStates(content, [...sources], buildDFDPrefill(fixture()));
    expect(a).toEqual(b);
    expect(renderDFDContent(buildDFDPrefill(fixture()))).toBe(content);
  });

  it("11) quantidade da Pesquisa NUNCA aparece como prevista: sem previsto → [a definir]", () => {
    const ctx = resolveCanonicalContext({
      organizationId: 7, processId: "p", process: { number: "1", object: "Mobiliário", responsibleUserId: 3, createdAt: "2026-01-01T00:00:00.000Z" },
      responsibleUserName: null, organization: null, assertions: [],
      intelligentItems: [{ ...ITEMS[0], quantity: 250 }], procurementItems: [PITEMS[0]], priceLinks: [LINKS[0]],
    });
    const content = renderDFDContent(buildDFDPrefill(ctx));
    expect(content).toContain("| 1 | Cadeira giratória | UN | [a definir] |");
    expect(content).not.toContain("250");
    expect(content).toContain("Indicar a previsão orçamentária preliminar"); // sem estimativa: previsto ausente
  });

  it("12) fato em CONFLITO no contexto não é pré-preenchido e aparece como conflito", () => {
    const ctx = fixture([fact("demand.requestingUnit", "Secretaria de Obras", "dfd", { sourceId: "gdoc-1" })]);
    expect(ctx.demand.requestingUnit.status).toBe("conflict");
    const prefill = buildDFDPrefill(ctx);
    const content = renderDFDContent(prefill);
    expect(content).toContain("Setor/unidade demandante: [preencher]");
    const v = stateOf(computeDFDFieldStates(content, writeMarkers([], prefillMarkers(prefill)), prefill), "identificacao.unidade");
    expect(v.state).toBe("conflict");
    expect(v.reconcilable).toBe(false);
  });

  it("13) afirmações extraídas do DFD salvo: só o que o humano informou/alterou, com base (superação consciente)", () => {
    const { content, sources, ctx } = open();
    expect(extractDFDAssertions(content, sources, ctx)).toEqual([]); // nada mudou → nada afirmado
    const edited = content
      .replace("| Mesa de escritório | UN | 10 |", "| Mesa de escritório | UN | 12 |")
      .replace("Prazo pretendido para a contratação: [preencher]", "Prazo pretendido para a contratação: 60 dias")
      .replace("Descrever a necessidade pública", "Texto humano da necessidade pública");
    const d = extractDFDAssertions(edited, sources, ctx);
    expect(d.map((x) => x.path).sort()).toEqual([itemPath(K[1], "plannedQuantity"), "planning.desiredDate"].sort());
    const qty = d.find((x) => x.path === itemPath(K[1], "plannedQuantity"))!;
    expect(qty.value).toBe(12);
    expect(qty.basisValueHash).toBe(readMarkers(sources).prefill[`item:${K[1]}`].hash);
    // Linha nova digitada no DFD NÃO cria item nem fato: fica "sem correspondência" (candidata na Área de Itens).
    const withNew = edited.replace(/^(\| \d+ \| Armário de aço .*)$/m, "$1\n| 4 | Estante | UN | 1.200 |");
    expect(extractDFDAssertions(withNew, sources, ctx).map((x) => x.path).sort()).toEqual(d.map((x) => x.path).sort());
    expect(unlinkedDFDRows(withNew, sources, buildDFDPrefill(ctx)).map((r) => [r.description, r.quantity])).toEqual([["Estante", 1200]]);
    expect(parseQuantityPtBr("1.200")).toBe(1200);
    expect(parseQuantityPtBr("2,5")).toBe(2.5);
    expect(parseQuantityPtBr("[a definir]")).toBeNull();
  });

  it("14) rascunho de IA na justificativa: marcado (executionId + digest), só a seção 2 muda; editar → 'alterado por você'", () => {
    const { content, sources, prefill, ctx } = open();
    const r = applyAIJustification(content, sources, "A unidade demandante necessita do mobiliário para atender aos alunos.", "exec_123", ctx.digest);
    expect(readMarkers(r.sources).ai.justificativa).toMatchObject({ executionId: "exec_123", contextDigest: ctx.digest.slice(0, 16) });
    const diff = r.content.split("\n").filter((l) => !content.split("\n").includes(l));
    expect(diff).toEqual(["A unidade demandante necessita do mobiliário para atender aos alunos."]);
    expect(stateOf(computeDFDFieldStates(r.content, r.sources, prefill), "justificativa").state).toBe("ai_draft");
    const humanized = r.content.replace("para atender aos alunos", "para atender aos 800 alunos da rede");
    expect(stateOf(computeDFDFieldStates(humanized, r.sources, prefill), "justificativa").state).toBe("user_modified");
    // Justificativa é narrativa: nunca vira fato do contexto.
    expect(extractDFDAssertions(humanized, r.sources, ctx).some((x) => x.fieldKey === "justificativa")).toBe(false);
  });
});
