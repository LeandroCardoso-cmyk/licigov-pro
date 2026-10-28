/**
 * Achados P1/P3.5 da homologação visual M8 — preparação do Edital BLL.
 * P1.1: o campo SUMIA da tela ao receber valor (a lista que desenhava era a mesma que CONTAVA pendências).
 * P1.2: duração presa em "dia(s)" (padrão silencioso + o controle saía da tela antes de a pessoa trocar a unidade).
 * P3.5: as decisões condicionais do modo "aberto" precisam aparecer no momento da escolha, sem gravação prévia.
 * Lógica pura + SSR (react-dom/server, sem DOM), com o contrato do servidor (normalização/formatação da duração).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DURATION_UNITS, buildSavePlan, liveDecisionItems, liveOptionalItems, livePendingItems, liveRegisteredItems, parseField, toFormValue,
  type PrepField, type PrepSection, type PreparationStateView, type SectionEdits,
} from "@/lib/editalPreparation";
import { buildEditalReadiness } from "@/lib/editalReadiness";
import { DURATION_UNITS as SERVER_DURATION_UNITS } from "../../../../server/domain/institutionalTemplates/variableCatalog2";
import { formatDuration, normalizeValue2 } from "../../../../server/domain/institutionalTemplates/valueTypes2";

const SRC = "CERTAME_CONFIG";
const DUR_DEF = { name: "julgamento.duracaoEtapaLances", type: "duration" } as unknown as Parameters<typeof normalizeValue2>[0];
const fld = (over: Partial<PrepField> & { name: string }): PrepField => ({
  source: SRC, path: over.name.split(".").pop()!, type: "string", description: over.name, required: true, conditional: false, requiredWhenVariables: [],
  hasValue: false, class: "PROCESS_DECISION", rule: "PROCESS_SOURCE", authority: "CERTAME_CONFIG", status: "PENDING", editable: true, ...over,
});
const whenModo = (value: string) => ({ requiredWhen: { op: "eq" as const, var: "julgamento.modoDisputa", value }, requiredWhenVariables: ["julgamento.modoDisputa"], conditional: true, required: false });

/** Recorte fiel do catálogo BLL Rev. 2: modo de disputa + condicionais + uma decisão simples. */
const modo = fld({ name: "julgamento.modoDisputa", type: "enum", enumValues: ["aberto", "aberto e fechado"] });
const duracao = fld({ name: "julgamento.duracaoEtapaLances", type: "duration", authority: "CONDITIONAL", status: "HIDDEN_CONDITIONAL", ...whenModo("aberto") });
const prorrogacao = fld({ name: "julgamento.regraProrrogacaoAutomatica", type: "text", authority: "CONDITIONAL", status: "HIDDEN_CONDITIONAL", ...whenModo("aberto") });
const abertaFechada = fld({ name: "julgamento.regrasEtapaAbertaFechada", type: "text", authority: "CONDITIONAL", status: "HIDDEN_CONDITIONAL", ...whenModo("aberto e fechado") });
const numero = fld({ name: "controle.numeroPregao" });
const section = (fields: PrepField[]): PrepSection => ({ source: SRC, scope: "PROCESS", fields, pendingRequired: fields.filter((x) => x.status === "PENDING").length });
const state = (fields: PrepField[], facts: Record<string, unknown> = {}): PreparationStateView => ({
  status: "READY_FOR_PREPARATION", revisionId: "r1", catalogVersion: "cat/1", revisions: { process: 3, organization: 0, budget: 0 },
  budgetDisclosure: "publico", participation: { default: "Ampla" }, participationPending: false,
  trPin: { state: "VALID", ref: { documentId: "d", version: 1, contentHash: "h" } }, sections: [section(fields)], facts, canonicalFields: [], orgProfile: null,
  summary: { groups: [], reusedAutomatically: 0, pendingDecisions: 0 },
  metrics: { TOTAL_TEMPLATE_FIELDS: 0, AUTO_RESOLVED: 0, ORG_REUSED: 0, TR_PROJECTED: 0, DECIDED: 0, CONDITIONAL_HIDDEN: 0, POST_AWARD_HIDDEN: 0, OPTIONAL_HIDDEN: 0, MANUAL_DECISIONS_VISIBLE: 0, LEGACY_SHADOWED: 0 },
});
const fresh = () => state([duracao, modo, numero, prorrogacao, abertaFechada]);   // ordem alfabética, como o servidor entrega
const ed = (v: Record<string, unknown>): Record<string, SectionEdits> => ({ [SRC]: v as SectionEdits });
const shown = (st: PreparationStateView, e: Record<string, SectionEdits>) => liveDecisionItems(st, e).map((i) => i.field.name);

describe("P1.1 — campo preenchido continua na tela; a contagem continua caindo", () => {
  it("texto: 1 caractere válido não tira o campo da lista desenhada (a pendência deixa de contar)", () => {
    const st = fresh();
    expect(shown(st, {})).toEqual(["julgamento.modoDisputa", "controle.numeroPregao"]);
    const e = ed({ numeroPregao: "1" });
    expect(shown(st, e)).toContain("controle.numeroPregao");
    expect(livePendingItems(st, e).map((i) => i.field.name)).not.toContain("controle.numeroPregao");
    expect(buildEditalReadiness(st, e).counters.PROCESS_DECISIONS_TOTAL).toBe(1);
  });
  it("enum: selecionar o modo não remove o seletor (a pessoa pode revisar/trocar antes de salvar)", () => {
    const st = fresh();
    for (const m of ["aberto", "aberto e fechado"]) expect(shown(st, ed({ modoDisputa: m }))).toContain("julgamento.modoDisputa");
  });
  it("limpar o valor mantém o campo e devolve a pendência à contagem", () => {
    const st = fresh();
    expect(shown(st, ed({ numeroPregao: "" }))).toContain("controle.numeroPregao");
    expect(livePendingItems(st, ed({ numeroPregao: "" })).map((i) => i.field.name)).toContain("controle.numeroPregao");
  });
  it("valor inválido continua visível (para exibir o erro) e não entra no plano de gravação", () => {
    const st = fresh();
    const e = ed({ modoDisputa: "aberto", duracaoEtapaLances: { amount: "dez", unit: "minute" } });
    expect(shown(st, e)).toContain("julgamento.duracaoEtapaLances");
    expect(buildSavePlan(st, { edits: e }).errors[SRC]?.duracaoEtapaLances).toMatch(/quantidade/);
  });
  it("reload: o valor registrado aparece em 'Decisões já registradas', editável, e alterá-lo é uma nova decisão explícita", () => {
    const persisted = state([
      { ...modo, status: "DECIDED", hasValue: true, currentValue: "aberto" },
      { ...duracao, status: "DECIDED", hasValue: true, currentValue: { amount: 10, unit: "minute" } },
      { ...prorrogacao, status: "PENDING" }, abertaFechada, { ...numero, status: "DECIDED", hasValue: true, currentValue: "12/2026" },
    ], { "julgamento.modoDisputa": "aberto", "julgamento.duracaoEtapaLances": { amount: 10, unit: "minute" }, "controle.numeroPregao": "12/2026" });
    expect(liveRegisteredItems(persisted, {}).map((i) => i.field.name)).toEqual(["julgamento.modoDisputa", "julgamento.duracaoEtapaLances", "controle.numeroPregao"]);
    expect(shown(persisted, {})).toEqual(["julgamento.regraProrrogacaoAutomatica"]);
    // rehidratação exata (número E unidade) e nenhuma escrita sem alteração
    expect(toFormValue(duracao, { amount: 10, unit: "minute" })).toEqual({ amount: "10", unit: "minute" });
    expect(buildSavePlan(persisted, { edits: ed({ duracaoEtapaLances: { amount: "10", unit: "minute" } }) }).writes).toEqual([]);
    const plan = buildSavePlan(persisted, { edits: ed({ duracaoEtapaLances: { amount: "15", unit: "minute" } }) });
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0].fields?.duracaoEtapaLances).toEqual({ amount: 15, unit: "minute" });
    // trocar o modo esconde a filha registrada do outro ramo (nada é apagado: só deixa de ser exibida/considerada)
    expect(liveRegisteredItems(persisted, ed({ modoDisputa: "aberto e fechado" })).map((i) => i.field.name)).not.toContain("julgamento.duracaoEtapaLances");
  });
});

describe("P1.2 — duração: número e unidade independentes da ordem, sem unidade presumida", () => {
  const st = fresh();
  const base = { modoDisputa: "aberto" };
  it("sem valor registrado não há unidade padrão (antes: 'day' silencioso)", () => {
    expect(toFormValue(duracao, undefined)).toEqual({ amount: "", unit: "" });
  });
  it("número antes da unidade: campo continua visível, a unidade é exigida e depois aceita", () => {
    const e1 = ed({ ...base, duracaoEtapaLances: { amount: "10", unit: "" } });
    expect(shown(st, e1)).toContain("julgamento.duracaoEtapaLances");
    expect(parseField(duracao, { amount: "10", unit: "" })).toEqual({ ok: false, error: "Escolha a unidade." });
    expect(buildSavePlan(st, { edits: e1 }).errors[SRC]?.duracaoEtapaLances).toBe("Escolha a unidade.");
    const e2 = ed({ ...base, duracaoEtapaLances: { amount: "10", unit: "minute" } });
    expect(shown(st, e2)).toContain("julgamento.duracaoEtapaLances");
    expect(buildSavePlan(st, { edits: e2 }).writes[0].fields?.duracaoEtapaLances).toEqual({ amount: 10, unit: "minute" });
  });
  it("unidade antes do número: mesmo resultado final", () => {
    expect(shown(st, ed({ ...base, duracaoEtapaLances: { amount: "", unit: "minute" } }))).toContain("julgamento.duracaoEtapaLances");
    const e = ed({ ...base, duracaoEtapaLances: { amount: "10", unit: "minute" } });
    expect(buildSavePlan(st, { edits: e }).writes[0].fields?.duracaoEtapaLances).toEqual({ amount: 10, unit: "minute" });
  });
  it("trocar a unidade depois do número preserva o número (e vice-versa)", () => {
    expect(parseField(duracao, { amount: "10", unit: "hour" })).toEqual({ ok: true, value: { amount: 10, unit: "hour" } });
    expect(parseField(duracao, { amount: "12", unit: "hour" })).toEqual({ ok: true, value: { amount: 12, unit: "hour" } });
  });
  it("unidades: somente as do contrato do catálogo (espelho exato do servidor); fora dele ⇒ erro no cliente E no servidor", () => {
    expect([...DURATION_UNITS]).toEqual([...SERVER_DURATION_UNITS]);
    expect(parseField(duracao, { amount: "10", unit: "semana" }).ok).toBe(false);
    expect(normalizeValue2(DUR_DEF, { amount: 10, unit: "semana" }).ok).toBe(false);
  });
  it("serialização cliente → servidor → documento: o servidor aceita o valor do plano e o composer formata a unidade escolhida", () => {
    const value = buildSavePlan(st, { edits: ed({ ...base, duracaoEtapaLances: { amount: "10", unit: "minute" } }) }).writes[0].fields?.duracaoEtapaLances;
    const norm = normalizeValue2(DUR_DEF, value);
    expect(norm).toMatchObject({ ok: true, value: { amount: 10, unit: "minute" } });
    expect(formatDuration({ amount: 10, unit: "minute" })).toBe("10 minutos");
    expect(formatDuration({ amount: 1, unit: "businessDay" })).toBe("1 dia útil");
  });
});

describe("P3.5 — condicionais do modo de disputa aparecem na escolha, sem gravar", () => {
  const st = fresh();
  it("antes da escolha: nenhuma filha; 'aberto' ⇒ filhas do ramo aberto; 'aberto e fechado' ⇒ só a do outro ramo", () => {
    expect(shown(st, {})).not.toContain("julgamento.duracaoEtapaLances");
    expect(shown(st, ed({ modoDisputa: "aberto" }))).toEqual(expect.arrayContaining(["julgamento.modoDisputa", "julgamento.duracaoEtapaLances", "julgamento.regraProrrogacaoAutomatica"]));
    const af = shown(st, ed({ modoDisputa: "aberto e fechado" }));
    expect(af).toContain("julgamento.regrasEtapaAbertaFechada");
    expect(af).not.toContain("julgamento.duracaoEtapaLances");
  });
  it("cancelar a escolha (voltar a vazio) oculta as filhas; preencher a filha não a remove; nada é gravado só por aparecer", () => {
    expect(shown(st, ed({ modoDisputa: "" }))).not.toContain("julgamento.duracaoEtapaLances");
    const e = ed({ modoDisputa: "aberto", regraProrrogacaoAutomatica: "Prorrogação automática de 2 minutos." });
    expect(shown(st, e)).toContain("julgamento.regraProrrogacaoAutomatica");
    const plan = buildSavePlan(st, { edits: ed({ modoDisputa: "aberto" }) });
    expect(Object.keys(plan.writes[0].fields ?? {}).filter((k) => (plan.writes[0].fields as Record<string, unknown>)[k] !== undefined)).toEqual(["modoDisputa"]);
  });
  it("opcional que uma condição torna obrigatório permanece na tela ao receber valor (não some de opcionais E de decisões)", () => {
    const opt = fld({ name: "julgamento.intervaloMinimoLances", required: false, status: "OPTIONAL", ...whenModo("aberto") });
    const s2 = state([modo, opt]);
    expect(liveOptionalItems(s2, {}).map((i) => i.field.name)).toEqual([]);
    expect(shown(s2, ed({ modoDisputa: "aberto" }))).toContain(opt.name);
    expect(shown(s2, ed({ modoDisputa: "aberto", intervaloMinimoLances: "R$ 1,00" }))).toContain(opt.name);
  });
});

describe("SSR — tela real (EditalPreparationView)", () => {
  let View: typeof import("./EditalPreparationView").default;
  beforeAll(async () => {
    (globalThis as { React?: unknown }).React = React;
    View = (await import("./EditalPreparationView")).default;
  });
  const noop = () => {};
  const html = (st: PreparationStateView, edits: Record<string, SectionEdits>) => renderToStaticMarkup(React.createElement(View as unknown as React.ComponentType<never>, {
    state: st, edits, fieldErrors: buildSavePlan(st, { edits }).errors, pending: liveDecisionItems(st, edits), registered: liveRegisteredItems(st, edits),
    optional: liveOptionalItems(st, edits), onEdit: noop, plan: buildSavePlan(st, { edits }), reviewing: false, onStartReview: noop, onCancelReview: noop,
    decision: { decidedByName: "", decidedByRole: "", decidedAt: "2026-10-28", basisReference: "", reason: "", confirmed: false }, onDecision: noop,
    showErrors: false, busy: false, outcome: null, notice: null, onConfirm: noop, initialDecisionsOpen: true,
  } as never));
  const controlFor = (out: string, label: string) => out.includes(`aria-label="${label}"`);
  it("modo 'aberto' selecionado e duração preenchida: seletor, duração (número + unidade) e o valor digitado continuam renderizados", () => {
    const out = html(fresh(), ed({ modoDisputa: "aberto", duracaoEtapaLances: { amount: "10", unit: "minute" }, numeroPregao: "7/2026" }));
    expect(controlFor(out, "julgamento.modoDisputa")).toBe(true);
    expect(controlFor(out, "julgamento.duracaoEtapaLances")).toBe(true);
    expect(controlFor(out, "julgamento.duracaoEtapaLances — unidade")).toBe(true);
    expect(out).toContain('value="7/2026"');
    expect(out).toMatch(/<option value="minute" selected="">minuto\(s\)<\/option>/);
  });
  it("duração sem unidade escolhida mostra a opção vazia e a mensagem de erro (nunca 'dia(s)' presumido)", () => {
    const out = html(fresh(), ed({ modoDisputa: "aberto", duracaoEtapaLances: { amount: "10", unit: "" } }));
    expect(out).toMatch(/<option value="" selected="">Unidade…<\/option>/);
    expect(out).toContain("Escolha a unidade.");
  });
  it("decisões registradas aparecem com o valor persistido, para revisão/correção", () => {
    const persisted = state([{ ...modo, status: "DECIDED", hasValue: true, currentValue: "aberto" }, { ...duracao, status: "DECIDED", hasValue: true, currentValue: { amount: 10, unit: "minute" } }],
      { "julgamento.modoDisputa": "aberto", "julgamento.duracaoEtapaLances": { amount: 10, unit: "minute" } });
    const out = html(persisted, {});
    expect(out).toContain("Decisões já registradas — 2 (revisar ou corrigir)");
    expect(out).toMatch(/<option value="aberto" selected="">aberto<\/option>/);
    expect(out).toContain('value="10"');
  });
});

describe("integração — o painel desenha a lista ESTÁVEL e conta pela prontidão", () => {
  const panel = readFileSync(path.resolve("client/src/components/procurement/EditalPreparationPanel.tsx"), "utf8");
  it("Panel passa liveDecisionItems/liveRegisteredItems para a tela (nunca a lista de contagem livePendingItems)", () => {
    expect(panel).toMatch(/const pending = useMemo\(\(\) => \(state \? liveDecisionItems\(state, edits\)/);
    expect(panel).toMatch(/registered=\{registered\}/);
    expect(panel).not.toMatch(/livePendingItems\(/);
  });
});
