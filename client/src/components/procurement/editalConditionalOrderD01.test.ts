/**
 * D-01 (homologação visual pós-PR #331) — a pergunta condicional aparecia ACIMA da decisão que a ativa quando a ativadora já estava
 * registrada: a filha pendente caía no bloco de pendências e o bloco de registradas seguia a ordem alfabética do servidor; além disso,
 * o FieldBlock reagrupava por fonte e separava famílias de fontes diferentes. Contrato observável aqui: a ORDEM REAL dos campos no HTML
 * da tela (SSR), sem duplicação, sem gravação implícita e com a contagem de pendências inalterada.
 */
import { beforeAll, describe, expect, it } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildSavePlan, liveDecisionGroups, liveDecisionItems, liveOptionalItems, livePendingItems, liveRegisteredItems, toFormValue,
  type PrepField, type PrepSection, type PreparationStateView, type SectionEdits,
} from "@/lib/editalPreparation";
import { buildEditalReadiness } from "@/lib/editalReadiness";

const fld = (over: Partial<PrepField> & { name: string }): PrepField => ({
  source: "CERTAME_CONFIG", path: over.name.split(".").pop()!, type: "string", description: over.name, required: true, conditional: false,
  requiredWhenVariables: [], hasValue: false, class: "PROCESS_DECISION", rule: "PROCESS_SOURCE", authority: "CERTAME_CONFIG", status: "PENDING", editable: true, ...over,
});
const when = (parent: string, value: unknown) => ({ requiredWhen: { op: "eq" as const, var: parent, value }, requiredWhenVariables: [parent], conditional: true, required: false, authority: "CONDITIONAL" as const });
const decided = (f: PrepField, v: unknown): PrepField => ({ ...f, status: "DECIDED", hasValue: true, currentValue: v });
const state = (fields: PrepField[], facts: Record<string, unknown> = {}): PreparationStateView => {
  const bySource = new Map<string, PrepField[]>();
  for (const f of fields) bySource.set(f.source, [...(bySource.get(f.source) ?? []), f]);
  const sections: PrepSection[] = [...bySource].map(([source, fs]) => ({ source, scope: "PROCESS", fields: fs, pendingRequired: fs.filter((x) => x.status === "PENDING").length }));
  return {
    status: "READY_FOR_PREPARATION", revisionId: "r1", catalogVersion: "cat/1", revisions: { process: 3, organization: 0, budget: 0 },
    budgetDisclosure: "publico", participation: { default: "Ampla" }, participationPending: false,
    trPin: { state: "VALID", ref: { documentId: "d", version: 1, contentHash: "h" } }, sections, facts, canonicalFields: [], orgProfile: null,
    summary: { groups: [], reusedAutomatically: 0, pendingDecisions: 0 },
    metrics: { TOTAL_TEMPLATE_FIELDS: 0, AUTO_RESOLVED: 0, ORG_REUSED: 0, TR_PROJECTED: 0, DECIDED: 0, CONDITIONAL_HIDDEN: 0, POST_AWARD_HIDDEN: 0, OPTIONAL_HIDDEN: 0, MANUAL_DECISIONS_VISIBLE: 0, LEGACY_SHADOWED: 0 },
  };
};
const ed = (by: Record<string, Record<string, unknown>>): Record<string, SectionEdits> => by as Record<string, SectionEdits>;

// Recorte do catálogo BLL Rev. 2 (ordem alfabética, como o servidor entrega).
const duracao = fld({ name: "julgamento.duracaoEtapaLances", type: "duration", status: "HIDDEN_CONDITIONAL", ...when("julgamento.modoDisputa", "aberto") });
const modo = fld({ name: "julgamento.modoDisputa", type: "enum", enumValues: ["aberto", "aberto e fechado"] });
const prorrog = fld({ name: "julgamento.regraProrrogacaoAutomatica", type: "text", status: "HIDDEN_CONDITIONAL", ...when("julgamento.modoDisputa", "aberto") });
const af = fld({ name: "julgamento.regrasEtapaAbertaFechada", type: "text", status: "HIDDEN_CONDITIONAL", ...when("julgamento.modoDisputa", "aberto e fechado") });
const numero = fld({ name: "controle.numeroPregao" });
const ABERTO = { "julgamento.modoDisputa": "aberto", "julgamento.duracaoEtapaLances": { amount: 10, unit: "minute" }, "julgamento.regraProrrogacaoAutomatica": "2 minutos" };
/** Ativadora e filhas do ramo "aberto" REGISTRADAS (como no processo 8828/2026 da homologação). */
const registeredAll = () => state([
  decided(duracao, { amount: 10, unit: "minute" }), decided(modo, "aberto"), decided(prorrog, "2 minutos"), af, decided(numero, "7/2026"),
], { ...ABERTO, "controle.numeroPregao": "7/2026" });
/** Ativadora OPCIONAL (catálogo BLL: decisao.intervaloMinimoLances → julgamento.intervaloMinimoLances, PROCESS/CONFIG distintos). */
const optionalFamily = () => state([
  fld({ name: "controle.numeroPregao" }),
  fld({ name: "decisao.intervaloMinimoLances", type: "boolean", status: "OPTIONAL", required: false }),
  fld({ name: "julgamento.intervaloMinimoLances", source: "PROCESS", type: "string", status: "HIDDEN_CONDITIONAL", ...when("decisao.intervaloMinimoLances", true) }),
]);
const names = (xs: { field: PrepField }[]) => xs.map((i) => i.field.name);

describe("D-01 — grupos por família (lógica pura)", () => {
  it("ativadora PENDENTE + condicional pendente ⇒ condicional logo abaixo, no bloco de pendências", () => {
    const g = liveDecisionGroups(state([duracao, modo, prorrog, af, numero]), ed({ CERTAME_CONFIG: { modoDisputa: "aberto" } }));
    expect(names(g.decisions)).toEqual(["julgamento.modoDisputa", "julgamento.duracaoEtapaLances", "julgamento.regraProrrogacaoAutomatica", "controle.numeroPregao"]);
    expect(g.registered).toEqual([]);
  });
  it("ativadora REGISTRADA + condicional pendente (troca do modo) ⇒ condicional logo abaixo, no bloco de REGISTRADAS (o defeito)", () => {
    const g = liveDecisionGroups(registeredAll(), ed({ CERTAME_CONFIG: { modoDisputa: "aberto e fechado" } }));
    expect(names(g.registered)).toEqual(["julgamento.modoDisputa", "julgamento.regrasEtapaAbertaFechada", "controle.numeroPregao"]);
    expect(names(g.decisions)).not.toContain("julgamento.regrasEtapaAbertaFechada");
  });
  it("ativadora e condicionais REGISTRADAS ⇒ ordem pai→filhos (não alfabética)", () => {
    const g = liveDecisionGroups(registeredAll(), {});
    expect(names(g.registered)).toEqual(["julgamento.modoDisputa", "julgamento.duracaoEtapaLances", "julgamento.regraProrrogacaoAutomatica", "controle.numeroPregao"]);
  });
  it("desativar e reativar a condição: as filhas somem e voltam no mesmo lugar, com o valor registrado intacto; nenhuma gravação implícita", () => {
    const st = registeredAll();
    const off = liveDecisionGroups(st, ed({ CERTAME_CONFIG: { modoDisputa: "aberto e fechado" } }));
    expect(names(off.registered)).not.toContain("julgamento.duracaoEtapaLances");
    // o plano de gravação traz SÓ a escolha explícita da pessoa — as filhas ocultas não são apagadas nem regravadas
    const plan = buildSavePlan(st, { edits: ed({ CERTAME_CONFIG: { modoDisputa: "aberto e fechado" } }) });
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0].lines).toEqual(["julgamento.modoDisputa: aberto e fechado"]);
    const back = liveDecisionGroups(st, ed({ CERTAME_CONFIG: { modoDisputa: "aberto" } }));
    expect(names(back.registered)).toEqual(names(liveDecisionGroups(st, {}).registered));
    const dur = back.registered.find((i) => i.field.name === "julgamento.duracaoEtapaLances")!;
    expect(toFormValue(dur.field, dur.field.currentValue)).toEqual({ amount: "10", unit: "minute" });
    expect(buildSavePlan(st, { edits: ed({ CERTAME_CONFIG: { modoDisputa: "aberto" } }) }).writes).toEqual([]);
  });
  it("nenhuma decisão aparece duas vezes nem some: união dos blocos = pendências desenhadas ∪ registradas", () => {
    for (const e of [{}, ed({ CERTAME_CONFIG: { modoDisputa: "aberto e fechado" } }), ed({ CERTAME_CONFIG: { modoDisputa: "" } })]) {
      const st = registeredAll();
      const g = liveDecisionGroups(st, e);
      const all = [...names(g.decisions), ...names(g.registered), ...names(g.optional)];
      expect(new Set(all).size).toBe(all.length);
      expect(new Set(all)).toEqual(new Set([...names(liveDecisionItems(st, e)), ...names(liveRegisteredItems(st, e)), ...names(liveOptionalItems(st, e))]));
    }
  });
  it("prontidão: a contagem de pendências não depende da apresentação", () => {
    const st = registeredAll(); const e = ed({ CERTAME_CONFIG: { modoDisputa: "aberto e fechado" } });
    expect(names(livePendingItems(st, e))).toEqual(["julgamento.regrasEtapaAbertaFechada"]);
    expect(buildEditalReadiness(st, e).counters.PROCESS_DECISIONS_TOTAL).toBe(1);
  });
  it("ativadora OPCIONAL (auditoria: intervalo mínimo entre lances) ⇒ a condicional fica logo abaixo dela, no bloco de opcionais", () => {
    const st = optionalFamily();
    const off = liveDecisionGroups(st, {});
    expect(names(off.optional)).toEqual(["decisao.intervaloMinimoLances"]);
    expect(off.attached.size).toBe(0);
    const on = liveDecisionGroups(st, ed({ CERTAME_CONFIG: { intervaloMinimoLances: true } }));
    expect(names(on.optional)).toEqual(["decisao.intervaloMinimoLances", "julgamento.intervaloMinimoLances"]);
    expect(names(on.decisions)).toEqual(["controle.numeroPregao"]);
    expect([...on.attached]).toEqual(["julgamento.intervaloMinimoLances"]);
    expect(buildEditalReadiness(st, ed({ CERTAME_CONFIG: { intervaloMinimoLances: true } })).counters.PROCESS_DECISIONS_TOTAL).toBe(2);
  });
  it("adversarial: cadeia pai→filho→neto, múltiplas filhas e ciclo ⇒ ordem estável e sem laço infinito", () => {
    const a = fld({ name: "a.pai", type: "boolean" });
    const b = fld({ name: "a.filho", status: "HIDDEN_CONDITIONAL", ...when("a.pai", true) });
    const c = fld({ name: "a.neto", status: "HIDDEN_CONDITIONAL", ...when("a.filho", "x") });
    const d = fld({ name: "a.outraFilha", status: "HIDDEN_CONDITIONAL", ...when("a.pai", true) });
    const st = state([decided(a, true), b, c, d], { "a.pai": true });
    expect(names(liveDecisionGroups(st, ed({ CERTAME_CONFIG: { filho: "x" } })).registered)).toEqual(["a.pai", "a.filho", "a.neto", "a.outraFilha"]);
    const p = fld({ name: "c.p", ...when("c.q", "1"), status: "PENDING" });
    const q = fld({ name: "c.q", ...when("c.p", "1"), status: "PENDING" });
    const g = liveDecisionGroups(state([p, q], { "c.p": "1", "c.q": "1" }), {});
    expect(names(g.decisions).sort()).toEqual(["c.p", "c.q"]);
  });
});

describe("D-01 — tela real (SSR): ordem efetiva dos campos no HTML", () => {
  let View: typeof import("./EditalPreparationView").default;
  beforeAll(async () => {
    (globalThis as { React?: unknown }).React = React;
    View = (await import("./EditalPreparationView")).default;
  });
  const noop = () => {};
  const html = (st: PreparationStateView, edits: Record<string, SectionEdits>) => {
    const g = liveDecisionGroups(st, edits);
    return renderToStaticMarkup(React.createElement(View as unknown as React.ComponentType<never>, {
      state: st, edits, fieldErrors: buildSavePlan(st, { edits }).errors, pending: g.decisions, registered: g.registered, optional: g.optional, attached: g.attached,
      onEdit: noop, plan: buildSavePlan(st, { edits }), reviewing: false, onStartReview: noop, onCancelReview: noop,
      decision: { decidedByName: "", decidedByRole: "", decidedAt: "2026-10-28", basisReference: "", reason: "", confirmed: false }, onDecision: noop,
      showErrors: false, busy: false, outcome: null, notice: null, onConfirm: noop, initialDecisionsOpen: true,
    } as never));
  };
  const order = (out: string) => [...out.matchAll(/data-field="([^"]+)"/g)].map((m) => m[1]);

  it("reprodução do defeito (8828/2026): modo registrado trocado para 'aberto e fechado' ⇒ a pergunta nova vem LOGO DEPOIS do seletor", () => {
    const out = html(registeredAll(), ed({ CERTAME_CONFIG: { modoDisputa: "aberto e fechado" } }));
    const o = order(out);
    expect(o[o.indexOf("julgamento.modoDisputa") + 1]).toBe("julgamento.regrasEtapaAbertaFechada");
    expect(o.filter((f) => f === "julgamento.regrasEtapaAbertaFechada")).toHaveLength(1);
    // o bloco de registradas abre sozinho para não esconder a pergunta nova, e a contagem é só das registradas
    expect(out).toMatch(/<details[^>]*aria-label="Decisões já registradas deste certame"[^>]*open=""/);
    expect(out).toContain("Decisões já registradas — 2 (revisar ou corrigir)");   // modo + nº do pregão (as filhas do ramo "aberto" ficam ocultas)
    expect(out).toContain("1 decisão ainda não registrada aparece logo abaixo da decisão que a ativou.");
  });
  it("tudo registrado: seletor seguido das suas condicionais; bloco recolhido por padrão (nada pendente dentro)", () => {
    const out = html(registeredAll(), {});
    const o = order(out);
    expect(o.slice(o.indexOf("julgamento.modoDisputa"), o.indexOf("julgamento.modoDisputa") + 3)).toEqual(["julgamento.modoDisputa", "julgamento.duracaoEtapaLances", "julgamento.regraProrrogacaoAutomatica"]);
    expect(out).not.toMatch(/<details[^>]*aria-label="Decisões já registradas deste certame"[^>]*open=""/);
    expect(out).not.toContain('data-testid="pending-in-registered"');
  });
  it("família com FONTES diferentes (critério de julgamento × casas decimais): a filha não é separada por reagrupamento de fonte", () => {
    const crit = fld({ name: "julgamento.criterioJulgamento", source: "PROCESS", type: "enum", enumValues: ["menor preço", "maior desconto"] });
    const casas = fld({ name: "julgamento.casasDecimaisPreco", source: "CERTAME_CONFIG", type: "integer", status: "HIDDEN_CONDITIONAL", ...when("julgamento.criterioJulgamento", "menor preço") });
    const outro = fld({ name: "controle.numeroPregao", source: "CERTAME_CONFIG" });
    const out = html(state([outro, casas, crit]), ed({ PROCESS: { criterioJulgamento: "menor preço" } }));
    const o = order(out);
    expect(o[o.indexOf("julgamento.criterioJulgamento") + 1]).toBe("julgamento.casasDecimaisPreco");
  });
  it("P1.1/P1.2 preservados na família registrada: campo editado continua visível; duração sem unidade presumida", () => {
    const e = ed({ CERTAME_CONFIG: { duracaoEtapaLances: { amount: "12", unit: "" } } });
    const out = html(registeredAll(), e);
    expect(order(out)).toContain("julgamento.duracaoEtapaLances");
    expect(out).toContain("Escolha a unidade.");
    expect(toFormValue(duracao, { amount: 5 })).toEqual({ amount: "5", unit: "" });
  });
  it("ativadora OPCIONAL: a condicional vem logo depois dela, sinalizada, e o bloco de opcionais abre sozinho com contagem só das opcionais", () => {
    const out = html(optionalFamily(), ed({ CERTAME_CONFIG: { intervaloMinimoLances: true } }));
    const o = order(out);
    expect(o[o.indexOf("decisao.intervaloMinimoLances") + 1]).toBe("julgamento.intervaloMinimoLances");
    expect(o.filter((f) => f === "julgamento.intervaloMinimoLances")).toHaveLength(1);
    expect(out).toMatch(/<details[^>]*aria-label="Decisões opcionais deste certame"[^>]*open=""/);
    expect(out).toContain("Decisões opcionais (ativam campos adicionais) — 1");
    expect(out).toMatch(/data-attached-pending="true"[^]*?data-field="julgamento.intervaloMinimoLances"/);
    const closed = html(optionalFamily(), {});
    expect(closed).not.toMatch(/<details[^>]*aria-label="Decisões opcionais deste certame"[^>]*open=""/);
    expect(closed).not.toContain('data-attached-pending="true"');
  });
  it("condicional pendente no bloco de registradas é sinalizada; decisões registradas não", () => {
    const out = html(registeredAll(), ed({ CERTAME_CONFIG: { modoDisputa: "aberto e fechado" } }));
    expect(out.match(/data-attached-pending="true"/g)).toHaveLength(1);
    expect(out).toMatch(/data-attached-pending="true"[^>]*><span[^>]*>Ainda não registrada<\/span><div[^>]*data-field="julgamento.regrasEtapaAbertaFechada"/);
  });
});
