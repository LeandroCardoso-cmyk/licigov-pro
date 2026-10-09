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
  buildSectionFields, generateReady, groupSections, groupStatus, isStaleSave, missingRequired, parseField, parseScalar, pendingDeviations,
  reviewReadiness, scalarToText, sectionStatus, summarizeAcks, toFormValue, totalPending, type PrepField, type PrepSection, type ReviewStateView,
} from "@/lib/editalPreparation";

const f = (over: Partial<PrepField>): PrepField => ({ name: "n", source: "PROCESS", path: "p", type: "string", description: "Campo", required: true, conditional: false, requiredWhenVariables: [], hasValue: false, ...over });
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

describe("seção completa, status e agrupamento", () => {
  const sec: PrepSection = {
    source: "POLICY", scope: "ORG", pendingRequired: 1,
    fields: [f({ path: "a", hasValue: true, currentValue: "x" }), f({ path: "b", type: "money" }), f({ path: "c", required: false, conditional: true })],
  };
  it("mantém os valores correntes, aplica edições e acusa erro de tipo", () => {
    expect(buildSectionFields(sec, {}).fields).toEqual({ a: "x" });
    expect(buildSectionFields(sec, { b: "10,00" }).fields).toEqual({ a: "x", b: 1000 });
    expect(buildSectionFields(sec, { b: "zz" }).errors.b).toBeTruthy();
    expect(buildSectionFields(sec, { a: "" }).fields).toEqual({});   // limpar = remover da seção declarada
    expect(missingRequired(sec, {}).map((x) => x.path)).toEqual(["b"]);
    expect(missingRequired(sec, { b: "1" })).toEqual([]);
  });
  it("status Completo / Pendente / Condicional", () => {
    expect(sectionStatus(sec)).toBe("PENDENTE");
    expect(sectionStatus({ ...sec, pendingRequired: 0 })).toBe("CONDICIONAL");
    expect(sectionStatus({ ...sec, pendingRequired: 0, fields: [f({ hasValue: true })] })).toBe("COMPLETO");
    expect(groupStatus([sec])).toBe("PENDENTE");
    expect(groupStatus([{ ...sec, pendingRequired: 0, fields: [f({ hasValue: true })] }], false)).toBe("PENDENTE");   // divulgação ausente
    expect(totalPending([sec, sec])).toBe(2);
  });
  it("grupos na ordem operacional, só os que existem", () => {
    const mk = (source: string): PrepSection => ({ source, scope: "PROCESS", fields: [], pendingRequired: 0 });
    expect(groupSections(["LIFECYCLE", "IDENTITY", "ITEMS", "POLICY"].map(mk)).map((g) => g.group.id)).toEqual(["orgao", "itens", "ciclo"]);
    expect(groupSections(["POLICY", "IDENTITY"].map(mk))[0].sections.map((s) => s.source)).toEqual(["IDENTITY", "POLICY"]);
  });
  it("CAS obsoleto é reconhecido", () => {
    expect(isStaleSave("CONFLICT", "x")).toBe(true);
    expect(isStaleSave(undefined, "STALE_STATE: outra pessoa registrou")).toBe(true);
    expect(isStaleSave("BAD_REQUEST", "VALIDATION_FAILED")).toBe(false);
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
    for (const m of ["recordProcessFields", "recordOrganizationFields", "recordBudgetDisclosure"]) expect(prep).toContain(m);
    expect(prep).toContain("confirm: true");
    expect(prep).toContain("expectedRevision");
    expect(prep).toContain("idempotencyKey");
    expect(prep).not.toMatch(/JSON\.parse|fetch\(|localStorage|AUTHORITY_OWNED/);
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
