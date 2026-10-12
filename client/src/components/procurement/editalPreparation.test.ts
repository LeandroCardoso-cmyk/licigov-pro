/**
 * Preparação operacional do Edital institucional (UI): conversão tipada → valor canônico, status, preflight/revisão, SSR dos controles e
 * guardas estruturais (workspace/painéis usam as rotas governadas existentes, sem JSON técnico nem estado de autoridade no cliente).
 */
import { beforeAll, describe, expect, it } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildSavePlan, buildSectionFields, executeSavePlan, formatDisplay, generateReady, isStaleSave, liveOptionalItems, livePendingItems, liveStatuses,
  optionalItems, orgProfilePending, parseField, parseScalar, pendingDeviations, pendingItems, processPending, reusedItems, reviewReadiness,
  scalarToText, summarizeAcks, toFormValue, type PlannedWrite, type PrepField, type PrepSection, type PreparationStateView, type ReviewStateView,
} from "@/lib/editalPreparation";

const f = (over: Partial<PrepField>): PrepField => ({ name: "n", source: "PROCESS", path: "p", type: "string", description: "Campo", required: true, conditional: false, requiredWhenVariables: [], hasValue: false, class: "PROCESS_DECISION", rule: "PROCESS_SOURCE", status: "PENDING", editable: true, ...over });
const read = (rel: string) => readFileSync(path.resolve(rel), "utf8");

describe("conversão tipada → valor canônico", () => {
  it("money = centavos inteiros; percent = pontos; datas ISO; cnpj só dígitos; boolean Sim/Não", () => {
    expect(parseScalar("money", "1.234,56")).toEqual({ ok: true, value: 123456 });
    expect(parseScalar("money", "25,5")).toEqual({ ok: true, value: 2550 });
    expect(parseScalar("money", "abc").ok).toBe(false);
    expect(parseScalar("percent", "15,5")).toEqual({ ok: true, value: 15.5 });
    expect(parseScalar("percent", "101").ok).toBe(false);
    expect(parseScalar("integer", "12")).toEqual({ ok: true, value: 12 });
    expect(parseScalar("integer", "1,5").ok).toBe(false);
    expect(parseScalar("date", "2026-10-20")).toEqual({ ok: true, value: "2026-10-20" });
    expect(parseScalar("date", "20/10/2026").ok).toBe(false);
    expect(parseScalar("time", "09:30")).toEqual({ ok: true, value: "09:30" });
    expect(parseScalar("datetime", "2026-10-20T09:30")).toEqual({ ok: true, value: "2026-10-20T09:30" });
    expect(parseScalar("cnpj", "11.222.333/0001-81")).toEqual({ ok: true, value: "11222333000181" });
    expect(parseScalar("url", "ftp://x").ok).toBe(false);
    expect(parseScalar("boolean", "true")).toEqual({ ok: true, value: true });
    expect(parseScalar("boolean", "false")).toEqual({ ok: true, value: false });
    expect(parseScalar("enum", "x", ["a", "b"]).ok).toBe(false);
    expect(parseScalar("string", "  ")).toEqual({ ok: true, value: undefined });
  });

  it("ida e volta do valor canônico (money/percent/duration/list/table)", () => {
    expect(scalarToText("money", 123456)).toBe("1.234,56");
    expect(parseScalar("money", scalarToText("money", 123456))).toEqual({ ok: true, value: 123456 });
    expect(scalarToText("percent", 15.5)).toBe("15,5");
    const dur = f({ type: "duration" });
    expect(toFormValue(dur, { amount: 5, unit: "businessDay" })).toEqual({ amount: "5", unit: "businessDay" });
    expect(parseField(dur, { amount: "5", unit: "businessDay" })).toEqual({ ok: true, value: { amount: 5, unit: "businessDay" } });
    expect(parseField(dur, { amount: "x", unit: "day" }).ok).toBe(false);
    const list = f({ type: "list", itemType: "string" });
    expect(parseField(list, "a\n\n b ")).toEqual({ ok: true, value: ["a", "b"] });
    expect(toFormValue(list, ["a", "b"])).toBe("a\nb");
    const table = f({ type: "table", columns: [{ key: "infracao", type: "string", label: "Infração", required: true }, { key: "percentual", type: "percent", label: "%", required: true }] });
    expect(parseField(table, [{ infracao: "Atraso", percentual: "0,5" }, { infracao: "", percentual: "" }])).toEqual({ ok: true, value: [{ infracao: "Atraso", percentual: 0.5 }] });
    expect(parseField(table, [{ infracao: "Atraso", percentual: "" }])).toMatchObject({ ok: false });
  });
});

const mkField = (over: Partial<PrepField>): PrepField => ({
  name: "n", source: "PROCESS", path: "p", type: "string", description: "Campo", required: true, conditional: false, requiredWhenVariables: [],
  hasValue: false, class: "PROCESS_DECISION", rule: "PROCESS_SOURCE", status: "PENDING", editable: true, ...over,
});
const mkSection = (source: string, scope: "ORG" | "PROCESS", fields: PrepField[]): PrepSection => ({ source, scope, fields, pendingRequired: fields.filter((x) => x.status === "PENDING").length });
const mkState = (sections: PrepSection[], over: Partial<PreparationStateView> = {}): PreparationStateView => ({
  status: "READY_FOR_PREPARATION", revisionId: "r1", catalogVersion: "cat/1", revisions: { process: 0, organization: 0, budget: 0 },
  budgetDisclosure: "publico", participation: { default: "Ampla participação" }, participationPending: false, trPin: { state: "VALID", ref: { documentId: "d", version: 1, contentHash: "h" } }, sections, facts: {}, canonicalFields: [], orgProfile: null,
  summary: { groups: [], reusedAutomatically: 0, pendingDecisions: 0 },
  metrics: { TOTAL_TEMPLATE_FIELDS: 0, AUTO_RESOLVED: 0, ORG_REUSED: 0, TR_PROJECTED: 0, DECIDED: 0, CONDITIONAL_HIDDEN: 0, POST_AWARD_HIDDEN: 0, OPTIONAL_HIDDEN: 0, MANUAL_DECISIONS_VISIBLE: 0, LEGACY_SHADOWED: 0 },
  ...over,
});

describe("seção completa e visões orientadas por exceção", () => {
  const sec = mkSection("POLICY", "ORG", [
    mkField({ path: "a", name: "a", hasValue: true, currentValue: "x", status: "ORG_REUSED", editable: true }),
    mkField({ path: "b", name: "b", type: "money" }),
    mkField({ path: "c", name: "c", required: false, status: "OPTIONAL" }),
  ]);
  it("mantém os valores declarados, aplica edições e acusa erro de tipo", () => {
    expect(buildSectionFields(sec, {}).fields).toEqual({ a: "x" });
    expect(buildSectionFields(sec, { b: "10,00" }).fields).toEqual({ a: "x", b: 1000 });
    expect(buildSectionFields(sec, { b: "zz" }).errors.b).toBeTruthy();
    expect(buildSectionFields(sec, { a: "" }).fields).toEqual({});   // limpar = remover da seção declarada
  });
  it("só as pendências aparecem; reaproveitados/opcionais ficam recolhidos; perfil do órgão separado do processo", () => {
    const proc = mkSection("PROCESS", "PROCESS", [mkField({ name: "p1", path: "p1" }), mkField({ name: "p2", path: "p2", status: "DECIDED", hasValue: true, currentValue: "v", displayValue: "v" }), mkField({ name: "p3", path: "p3", status: "HIDDEN_CONDITIONAL" })]);
    const st = mkState([sec, proc], { upstream: { trDigest: "x", trPending: [], sourcePending: [], profilePending: [{ name: "b", description: "B", reason: "política do órgão ainda não registrada" }] } });
    expect(pendingItems(st).map((i) => i.field.name)).toEqual(["b", "p1"]);
    expect(orgProfilePending(st).map((i) => i.name)).toEqual(["b"]);   // CONTEXT_REUSE 2.0: o perfil incompleto vem do servidor (card único)
    expect(processPending(st).map((i) => i.field.name)).toEqual(["p1"]);
    expect(optionalItems(st).map((i) => i.field.name)).toEqual(["c"]);
    expect(reusedItems(st).map((i) => i.field.name)).toEqual(["a", "p2"]);
    expect(pendingItems(st).some((i) => i.field.status === "HIDDEN_CONDITIONAL")).toBe(false);
  });
  it("o plano NUNCA reenvia autoridade CANONICAL (nem legado), mas preserva o valor humano do TR_PROJECTION", () => {
    const canon = mkField({ name: "c", path: "c", class: "CANONICAL", rule: "PROJECTION", status: "AUTO", editable: false, hasValue: true, currentValue: "legado" });
    const trp = mkField({ name: "t", path: "t", class: "TR_PROJECTION", rule: "PROJECTION", status: "AUTO", editable: false, hasValue: true, currentValue: "supriu" });
    const s2 = mkSection("PROCESS", "PROCESS", [canon, trp, mkField({ name: "o", path: "o" })]);
    expect(buildSectionFields(s2, { o: "x" }).fields).toEqual({ t: "supriu", o: "x" });
  });
  it("CAS obsoleto é reconhecido", () => {
    expect(isStaleSave("CONFLICT", "x")).toBe(true);
    expect(isStaleSave(undefined, "STALE_STATE: outra pessoa registrou")).toBe(true);
    expect(isStaleSave("BAD_REQUEST", "VALIDATION_FAILED")).toBe(false);
  });
  it("formatação legível de valores canônicos", () => {
    expect(formatDisplay("money", 123456)).toBe("R$ 1.234,56");
    expect(formatDisplay("percent", 15.5)).toBe("15,5%");
    expect(formatDisplay("boolean", true)).toBe("Sim");
    expect(formatDisplay("date", "2026-10-20")).toBe("20/10/2026");
    expect(formatDisplay("duration", { amount: 5, unit: "businessDay" })).toContain("dia(s) útil(eis)");
    expect(formatDisplay("table", [{}, {}])).toBe("2 linha(s)");
    expect(formatDisplay("string", undefined)).toBe("—");
  });
});

describe("condicionais ao vivo (espelho do servidor) — ativar/ocultar conforme a decisão", () => {
  const ctrl = mkField({ name: "decisao.exigeAmostra", path: "decisoes.exigeAmostra", type: "boolean", required: false, status: "OPTIONAL" });
  const child = mkField({
    name: "habilitacao.localEntregaAmostra", path: "localEntregaAmostra", required: false, conditional: true, status: "HIDDEN_CONDITIONAL",
    requiredWhen: { op: "eq", var: "decisao.exigeAmostra", value: true }, requiredWhenVariables: ["decisao.exigeAmostra"],
  });
  const st = mkState([mkSection("TR", "PROCESS", [ctrl, child])]);
  it("oculto enquanto a condição está inativa; aparece como pendência ao ativar; some ao desativar", () => {
    expect(livePendingItems(st, {}).map((i) => i.field.name)).toEqual([]);
    expect(liveStatuses(st, {}).get(child.name)?.status).toBe("HIDDEN_CONDITIONAL");
    const on = livePendingItems(st, { TR: { "decisoes.exigeAmostra": "true" } });
    expect(on.map((i) => i.field.name)).toEqual([child.name]);
    expect(livePendingItems(st, { TR: { "decisoes.exigeAmostra": "false" } })).toEqual([]);
    // preenchida a filha, deixa de ser pendência
    expect(livePendingItems(st, { TR: { "decisoes.exigeAmostra": "true", localEntregaAmostra: "Almoxarifado" } })).toEqual([]);
  });
  it("o controle opcional aparece em 'decisões opcionais'", () => {
    expect(liveOptionalItems(st, {}).map((i) => i.field.name)).toEqual([ctrl.name]);
  });
});

describe("Salvar preparação: uma confirmação, escritas sequenciais, CAS encadeado", () => {
  const org = mkSection("POLICY", "ORG", [mkField({ name: "o1", path: "o1", description: "Canal de esclarecimentos" })]);
  const tr = mkSection("TR", "PROCESS", [mkField({ name: "t1", path: "t1", description: "Local de entrega", source: "TR" })]);
  const cert = mkSection("CERTAME_CONFIG", "PROCESS", [mkField({ name: "c1", path: "c1", type: "date", description: "Data de abertura", source: "CERTAME_CONFIG" })]);
  const st = mkState([org, tr, cert], { budgetDisclosure: null, participationPending: true, participation: null, revisions: { process: 3, organization: 5, budget: 1 } });
  it("planeja na ordem órgão → processo (CertameConfig) e lista cada decisão; divulgação e participação NÃO são escritas do Edital", () => {
    const plan = buildSavePlan(st, { edits: { CERTAME_CONFIG: { c1: "2026-10-20" }, TR: { t1: "Almoxarifado" }, POLICY: { o1: "licitacao@exemplo.gov.br" } } });
    expect(plan.writes.map((w) => w.id)).toEqual(["ORG-POLICY", "PROCESS-TR", "PROCESS-CERTAME_CONFIG"]);
    expect(plan.decisionCount).toBe(3);
    expect(plan.writes.flatMap((w) => w.lines)).toEqual(expect.arrayContaining(["Data de abertura: 20/10/2026", "Local de entrega: Almoxarifado"]));
    expect(plan.writes.some((w) => (w.kind as string) === "DISCLOSURE" || (w as { participation?: unknown }).participation !== undefined)).toBe(false);
    expect(plan.errors).toEqual({});
  });
  it("sem alteração ⇒ nenhuma escrita; erro de tipo ⇒ nada planejado para a seção", () => {
    expect(buildSavePlan(st, { edits: {} }).writes).toEqual([]);
    const bad = buildSavePlan(st, { edits: { CERTAME_CONFIG: { c1: "20/10/2026" } } });
    expect(bad.errors.CERTAME_CONFIG?.c1).toBeTruthy();
    expect(bad.writes).toEqual([]);
  });
  it("execução SEQUENCIAL com CAS encadeado por escopo (a revisão devolvida é a esperada da próxima)", async () => {
    const plan = buildSavePlan(st, { edits: { TR: { t1: "A" }, CERTAME_CONFIG: { c1: "2026-10-20" }, POLICY: { o1: "x@y.gov.br" } } });
    const calls: string[] = []; let inFlight = 0; let maxInFlight = 0;
    const writer = {
      async write(w: PlannedWrite, expected: number) {
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        calls.push(`${w.id}@${expected}`); inFlight--;
        return { revision: expected + 1 };
      },
    };
    const out = await executeSavePlan(plan.writes, st.revisions, writer, () => false);
    expect(out.failed).toBeNull();
    expect(maxInFlight).toBe(1);
    expect(calls).toEqual(["ORG-POLICY@5", "PROCESS-TR@3", "PROCESS-CERTAME_CONFIG@4"]);
  });
  it("conflito (CAS obsoleto): PARA, informa o que já foi registrado e o que não executou — nunca sobrescreve", async () => {
    const plan = buildSavePlan(st, { edits: { TR: { t1: "A" }, CERTAME_CONFIG: { c1: "2026-10-20" }, POLICY: { o1: "x@y.gov.br" } } });
    const stale = new Error("STALE_STATE: outra pessoa registrou");
    let n = 0;
    const out = await executeSavePlan(plan.writes, st.revisions, { async write(_w, expected) { if (++n === 2) throw stale; return { revision: expected + 1 }; } }, (e) => e === stale);
    expect(out.registered.map((w) => w.id)).toEqual(["ORG-POLICY"]);
    expect(out.failed?.write.id).toBe("PROCESS-TR");
    expect(out.failed?.stale).toBe(true);
    expect(out.notExecuted.map((w) => w.id)).toEqual(["PROCESS-CERTAME_CONFIG"]);
  });
});

describe("preflight e revisão", () => {
  it("o botão só é operacional com BOUND + TR exato + preflight READY", () => {
    expect(generateReady(false, false, undefined).ready).toBe(true);
    expect(generateReady(true, false, undefined).ready).toBe(false);
    expect(generateReady(true, true, undefined).ready).toBe(false);
    expect(generateReady(true, true, { status: "BLOCKED", issues: [] }).ready).toBe(false);
    expect(generateReady(true, true, { status: "READY_FOR_COMPOSITION", templateRevisionId: "r", templateSemanticHash: "h" }).ready).toBe(true);
  });
  const rs = (over: Partial<ReviewStateView>): ReviewStateView => ({
    composedByTemplate: true, generationManifestId: "m", templateRevisionId: "r", unresolvedMarkers: { count: 0, slots: [], samples: [] },
    structuralDeviations: [], aiNarratives: [], revalidation: { status: "PASSED", issues: [] }, ...over,
  });
  it("marcadores e desvios sem reconhecimento bloqueiam a prontidão; reconhecidos não", () => {
    expect(reviewReadiness(undefined).ready).toBe(true);
    expect(reviewReadiness(rs({ composedByTemplate: false })).ready).toBe(true);
    const r = reviewReadiness(rs({ unresolvedMarkers: { count: 2, slots: ["a"], samples: [] }, structuralDeviations: [{ blockId: "b1", kind: "INCLUDED_BLOCK_REMOVED", acknowledged: false }] }));
    expect(r.ready).toBe(false);
    expect(r.blockers).toHaveLength(2);
    const ok = rs({ structuralDeviations: [{ blockId: "b1", kind: "INCLUDED_BLOCK_REMOVED", acknowledged: true }] });
    expect(reviewReadiness(ok).ready).toBe(true);
    expect(pendingDeviations(ok)).toEqual([]);
  });
  it("resumo de reconhecimentos com falha parcial", () => {
    const s = summarizeAcks([{ blockId: "a", ok: true }, { blockId: "b", ok: false, error: "x" }]);
    expect(s.done).toBe(1);
    expect(s.failed.map((x) => x.blockId)).toEqual(["b"]);
  });
});

describe("SSR dos controles e painéis apresentacionais", () => {
  let Control: typeof import("./PrepFieldControl").default;
  let ReviewView: typeof import("./EditalTemplateReviewPanel").EditalTemplateReviewView;
  let Preflight: typeof import("./EditalPreflightCard").default;
  beforeAll(async () => {
    (globalThis as { React?: unknown }).React = React;
    Control = (await import("./PrepFieldControl")).default;
    ReviewView = (await import("./EditalTemplateReviewPanel")).EditalTemplateReviewView;
    Preflight = (await import("./EditalPreflightCard")).default;
  });
  const render = (C: unknown, props: object) => renderToStaticMarkup(React.createElement(C as React.ComponentType<never>, props as never));
  it("cada tipo tem controle próprio, sem JSON bruto", () => {
    expect(render(Control, { field: f({ type: "boolean", description: "Aceita?" }), value: "", onChange: () => {} })).toContain("Sim");
    expect(render(Control, { field: f({ type: "enum", enumValues: ["a", "b"] }), value: "", onChange: () => {} })).toContain("<option value=\"b\">b</option>");
    expect(render(Control, { field: f({ type: "date" }), value: "", onChange: () => {} })).toContain('type="date"');
    expect(render(Control, { field: f({ type: "duration" }), value: { amount: "", unit: "day" }, onChange: () => {} })).toContain("dia(s) útil(eis)");
    const table = render(Control, { field: f({ type: "table", columns: [{ key: "k", type: "string", label: "Coluna K", required: true }] }), value: [{ k: "v" }], onChange: () => {} });
    expect(table).toContain("Coluna K");
    expect(table).toContain("Adicionar linha");
    expect(render(Control, { field: f({ type: "string" }), value: "", error: "Erro X", onChange: () => {} })).toContain("Erro X");
  });
  it("revisão: lista marcadores e desvios com 'Reconhecer desvio'; reconhecido não oferece ação", () => {
    const state: ReviewStateView = {
      composedByTemplate: true, generationManifestId: "m", templateRevisionId: "r",
      unresolvedMarkers: { count: 2, slots: ["s"], samples: ["[REVISAR: x]"] },
      structuralDeviations: [{ blockId: "blk-1", kind: "INCLUDED_BLOCK_REMOVED", acknowledged: false }, { blockId: "blk-2", kind: "EXCLUDED_BLOCK_INSERTED", acknowledged: true }],
      aiNarratives: [], revalidation: { status: "PASSED", issues: [] },
    };
    const html = render(ReviewView, { state, selected: new Set(["blk-1"]), onToggle() {}, onAcknowledge() {}, onAcknowledgeSelected() {} });
    expect(html).toContain("Revisão do modelo institucional");
    expect(html).toContain("2 marcador(es) [REVISAR] pendente(s)");
    expect(html).toContain("blk-1");
    expect(html).toContain("Reconhecer desvio");
    expect(html).toContain("Reconhecido");
    expect(html).toContain("Registrar reconhecimentos selecionados (1)");
    expect((html.match(/Reconhecer desvio/g) ?? []).length).toBe(1);
    expect(render(ReviewView, { state: { ...state, composedByTemplate: false }, selected: new Set(), onToggle() {}, onAcknowledge() {}, onAcknowledgeSelected() {} })).toBe("");
  });
  it("revisão: falha parcial é apresentada", () => {
    const state: ReviewStateView = { composedByTemplate: true, generationManifestId: "m", unresolvedMarkers: { count: 0, slots: [], samples: [] }, structuralDeviations: [{ blockId: "a", kind: "INCLUDED_BLOCK_REMOVED", acknowledged: true }, { blockId: "b", kind: "INCLUDED_BLOCK_REMOVED", acknowledged: false }], aiNarratives: [], revalidation: { status: "PASSED", issues: [] } };
    const html = render(ReviewView, { state, selected: new Set(), outcomes: [{ blockId: "a", ok: true }, { blockId: "b", ok: false, error: "falhou" }], onToggle() {}, onAcknowledge() {}, onAcknowledgeSelected() {} });
    expect(html).toContain("1 reconhecimento(s) registrado(s)");
    expect(html).toContain("falha em b (falhou)");
  });
  it("preflight: BLOCKED lista fontes/pendências; READY informa; NOT_APPLICABLE não renderiza", () => {
    expect(render(Preflight, { preflight: { status: "BLOCKED", issues: [{ code: "GOVERNED_SOURCE_PENDING", source: "POLICY", message: "2 campo(s) obrigatório(s) pendente(s) na fonte POLICY" }] }, hasTrPin: true, onRecheck() {} })).toContain("Política do órgão");
    expect(render(Preflight, { preflight: { status: "READY_FOR_COMPOSITION", templateRevisionId: "r", templateSemanticHash: "h" }, hasTrPin: true, onRecheck() {} })).toContain("Fontes prontas");
    expect(render(Preflight, { preflight: { status: "BLOCKED", issues: [] }, hasTrPin: false, onRecheck() {} })).toContain("Confirme o TR oficial exato");
    expect(render(Preflight, { preflight: { status: "NOT_APPLICABLE" }, hasTrPin: false, onRecheck() {} })).toBe("");
  });
});

describe("SSR da preparação orientada por exceções", () => {
  let View: typeof import("./EditalPreparationView").default;
  beforeAll(async () => { (globalThis as { React?: unknown }).React = React; View = (await import("./EditalPreparationView")).default; });
  const noop = () => {};
  const base = (state: PreparationStateView, over: object = {}) => ({
    state, edits: {}, fieldErrors: {}, pending: pendingItems(state), optional: optionalItems(state), onEdit: noop, plan: { writes: [], errors: {}, decisionCount: 0 }, reviewing: false, onStartReview: noop,
    onCancelReview: noop, decision: { decidedByName: "", decidedByRole: "", decidedAt: "2026-10-09", basisReference: "", reason: "", confirmed: false }, onDecision: noop,
    showErrors: false, busy: false, outcome: null, notice: null, onConfirm: noop, ...over,
  });
  const html = (props: object) => renderToStaticMarkup(React.createElement(View as unknown as React.ComponentType<never>, props as never));
  const org = mkSection("POLICY", "ORG", [mkField({ name: "o1", path: "o1", source: "POLICY", description: "Canal de esclarecimentos", class: "ORG_PROFILE", rule: "ORG_SOURCE" })]);
  const reusedOrg = mkSection("IDENTITY", "ORG", [mkField({ name: "o2", path: "o2", source: "IDENTITY", description: "Foro competente", class: "ORG_PROFILE", status: "ORG_REUSED", hasValue: true, currentValue: "Comarca X", displayValue: "Comarca X", origin: { label: "Perfil institucional do órgão", ref: { revision: 2, hash: "abc" } } })]);
  const tr = mkSection("TR", "PROCESS", [mkField({ name: "t1", path: "t1", source: "TR", description: "Local de entrega", class: "TR_PROJECTION", rule: "TR_SOURCE" })]);
  const st = mkState([org, reusedOrg, tr], {
    budgetDisclosure: null, participationPending: false, orgProfile: { revision: 2, hash: "abc" },
    upstream: { trDigest: "x", trPending: [], sourcePending: [], profilePending: [{ name: "o1", description: "Canal de esclarecimentos", reason: "política do órgão ainda não registrada" }] },
    canonicalFields: [{ name: "processo.numeroProcesso", source: "PROCESS", path: "numeroProcesso", type: "string", description: "Número do processo", status: "AUTO", displayValue: "2026/0001", origin: { label: "Processo", ref: { processId: "p1" } } }],
    summary: { reusedAutomatically: 12, pendingDecisions: 4, groups: [{ id: "institucional", title: "Dados institucionais", total: 18, resolved: 18, reused: 18, pending: 0, blockedCanonical: 0 }, { id: "certame", title: "Configuração do certame", total: 9, resolved: 5, reused: 0, pending: 4, blockedCanonical: 0 }] },
  });
  it("resumo operacional, pendências em blocos separados e dados reaproveitados RECOLHIDOS (explicabilidade sob expansão)", () => {
    const out = html(base(st));
    expect(out).toContain("12</strong> informações reaproveitadas automaticamente");
    expect(out).toContain("de você");
    // UX final: UM card de perfil incompleto (não despeja campos) + cartões por autoridade
    expect(out).toContain("Complete a configuração única do órgão");
    expect(out).toContain("Configurar agora");
    expect(out).toContain('href="/configuracoes#perfil-licitacoes"');
    expect(out).toContain("Canal de esclarecimentos");            // listado só em "O que falta"
    expect(out).not.toContain('id="prep-POLICY-o1"');             // sem input do perfil na preparação
    expect(out).toContain('data-card="perfil"');
    expect(out).toContain('data-card="processo"');
    expect(out).toContain('data-card="tr"');
    expect(out).toContain('data-card="origens"');
    expect(out).toMatch(/⚠ \d+ decis(ão|ões) pendente/);
    expect(out).toContain("Decisões deste certame");
    expect(out).toContain("Local de entrega");
    // PR #288: divulgação do orçamento e regime de participação NÃO são campos do Edital
    expect(out).not.toContain("Regime de participação padrão dos itens");
    expect(out).not.toContain('name="edital-disclosure"');
    // recolhidos por padrão: <details> sem atributo open
    expect(out).toContain("Ver dados reaproveitados — 2");
    expect(out).toContain("Ver detalhes técnicos");
    expect(out).not.toMatch(/<details[^>]*\sopen/);
    expect(out).toContain("Reutilizado do perfil institucional");
    // o dado reaproveitado NÃO é input na tela principal; o canônico dono não tem controle
    expect(out).not.toMatch(/JSON|\{"/);
  });
  it("TR exato: sem pin pede a seleção; pin obsoleto pede reseleção; dado do sistema incompleto fica fora do formulário", () => {
    const sel = html(base({ ...st, trPin: { state: "NOT_SELECTED" } }));
    expect(sel).toContain("Selecione o TR oficial exato");
    const stale = html(base({ ...st, trPin: { state: "INVALID", code: "OFFICIAL_PIN_STALE" } }));
    expect(stale).toContain("não é mais válido");
    expect(stale).toContain("Selecione o TR oficial exato novamente");
    const blocked = mkState([mkSection("PROCESS", "PROCESS", [mkField({ name: "processo.secretariaRequisitante", path: "secretariaRequisitante", class: "CANONICAL", rule: "PROJECTION", status: "CANONICAL_UNRESOLVED", entry: "REQUESTING_UNIT", editable: false, description: "Unidade requisitante", origin: { label: "Contexto canônico" } })])]);
    const out = html(base(blocked, { onOpenStage: noop }));
    expect(out).toContain("Dados a resolver na origem");
    expect(out).toContain("Unidade requisitante");
    expect(out).toContain("Corrigir unidade requisitante");
    expect(out).not.toContain('id="prep-PROCESS-secretariaRequisitante"');     // sem input: a autoridade é outra
  });
  it("valor legado ignorado aparece só como aviso técnico no campo reaproveitado", () => {
    const auto = mkSection("PROCESS", "PROCESS", [mkField({ name: "processo.objetoResumido", path: "objetoResumido", class: "CANONICAL", rule: "PROJECTION", status: "AUTO", editable: false, hasValue: true, currentValue: "legado", displayValue: "Objeto canônico", shadowedLegacy: true, origin: { label: "Processo" }, description: "Objeto resumido" })]);
    const out = html(base(mkState([auto])));
    expect(out).toContain("Objeto canônico");
    expect(out).toContain("valor legado");
    expect(out).toContain("autoridade canônica prevalece");
  });
  it("sem pendências e sem alterações: mensagem de conclusão e nenhum botão de salvar", () => {
    const clean = mkState([reusedOrg], { summary: { reusedAutomatically: 1, pendingDecisions: 0, groups: [] } });
    const out = html(base(clean));
    expect(out).toContain("Nenhuma decisão pendente");
    expect(out).not.toContain("Salvar preparação do Edital");
  });
  it("UMA confirmação: botão 'Salvar preparação do Edital', resumo das decisões e autoridade humana antes de registrar", () => {
    const plan = { writes: [{ id: "PROCESS-TR", kind: "PROCESS" as const, source: "TR", lines: ["Local de entrega: Almoxarifado", "Prazo de execução: 5 dia(s)"] }, { id: "PROCESS-CERTAME_CONFIG", kind: "PROCESS" as const, source: "CERTAME_CONFIG", lines: ["Utiliza SRP: Sim"] }], errors: {}, decisionCount: 3 };
    const before = html(base(st, { plan }));
    expect(before).toContain("Salvar preparação do Edital");
    expect(before).toContain("3 decisões para registrar");
    expect(before).not.toContain("Confirmar e registrar");
    const review = html(base(st, { plan, reviewing: true }));
    expect(review).toContain("3 decisões serão registradas");
    expect(review).toContain("Local de entrega: Almoxarifado");
    expect(review).toContain("Utiliza SRP: Sim");
    expect(review).toContain("Autoridade humana");
    expect(review).toContain("Confirmar e registrar");
    expect((review.match(/Confirmar e registrar/g) ?? []).length).toBe(1);
  });
  it("conflito: informa o que já foi registrado e o que não executou", () => {
    const outcome = { registered: [{ id: "ORG-POLICY", kind: "ORG" as const, source: "POLICY", lines: [] }], failed: { write: { id: "PROCESS-TR", kind: "PROCESS" as const, source: "TR", lines: [] }, stale: true, message: "x" }, notExecuted: [{ id: "PROCESS-CERTAME_CONFIG", kind: "PROCESS" as const, source: "CERTAME_CONFIG", lines: [] }] };
    const out = html(base(st, { outcome }));
    expect(out).toContain("Já registrado: Política do órgão");
    expect(out).toContain("Parou em Dados do TR: nada foi sobrescrito");
    expect(out).toContain("1 registro(s) não executado(s)");
  });
});

describe("guardas estruturais", () => {
  const ws = read("client/src/components/procurement/EditalWorkspace.tsx");
  const prep = read("client/src/components/procurement/EditalPreparationPanel.tsx");
  const review = read("client/src/components/procurement/EditalTemplateReviewPanel.tsx");
  it("workspace: painel só quando BOUND; botão depende do preflight; mantém o guard de regeneração e o NOT_BOUND", () => {
    expect(ws).toContain("<EditalPreparationPanel");
    expect(ws).toMatch(/\{bound && \(\s*<div className="mt-6">\s*<EditalPreparationPanel/);
    expect(ws).toContain("!genReady.ready");
    expect(ws).toContain("|| !!regenerationBlock}");
    expect(ws).toContain("<EditalTemplateReviewPanel");
    expect(ws).toContain("templateReviewBlockers={templateReviewBlockers}");
  });
  it("escrita pelos endpoints governados existentes, como ato humano (confirm + idempotência + CAS); sem fetch/JSON técnico", () => {
    for (const m of ["recordCertameConfig", "recordOrganizationFields"]) expect(prep).toContain(m);
    // PR #288: o Edital NÃO escreve a divulgação do orçamento (registrada na Pesquisa de Preços)
    expect(prep).not.toContain("recordBudgetDisclosure");
    expect(prep).toContain("confirm: true");
    expect(prep).toContain("expectedRevision");
    expect(prep).toContain("idempotencyKey");
    expect(prep).not.toMatch(/JSON\.parse|fetch\(|localStorage|AUTHORITY_OWNED/);
    // escritas SEQUENCIAIS (nunca em paralelo) via executeSavePlan; uma confirmação humana
    expect(prep).toContain("executeSavePlan");
    expect(prep).not.toContain("Promise.all");
    expect(read("client/src/lib/editalPreparation.ts")).not.toContain("Promise.all");
    expect(review).toContain("institutionalTemplates.reviews.acknowledgeDeviation");
    expect(review).toContain("idempotencyKey");
    // reconhecimento nunca é automático: só por clique (individual) ou seleção explícita
    expect(review).not.toMatch(/useEffect\([^)]*acknowledge/);
  });
  it("OfficialPromotionSection continua usando promoteOfficial (o hook de emissão é do backend)", () => {
    const sec = read("client/src/components/procurement/OfficialPromotionSection.tsx");
    expect(sec).toContain("promoteOfficial");
    expect(sec).toContain("templateReviewBlockers");
  });
});
