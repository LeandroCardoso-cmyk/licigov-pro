/**
 * Dados de publicação DIFERIDOS + rótulo operacional do SRP — lógica pura e SSR (react-dom/server, sem DOM).
 * A tela só LÊ o estado que a API entrega: os dados de publicação não são decisões do certame, não bloqueiam a geração
 * e ficam num bloco recolhido; o SRP é perguntado em linguagem operacional (Sim/Não).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  livePendingItems, pendingItems, optionalItems, type PrepField, type PrepSection, type PreparationStateView,
} from "@/lib/editalPreparation";
import { buildEditalReadiness, readinessHeadline } from "@/lib/editalReadiness";

const SRP_LABEL = "Sistema de Registro de Preços (SRP)";
const SRP_QUESTION = "Esta contratação utilizará Sistema de Registro de Preços?";
const NOTE = "Estes dados não impedem a elaboração do Edital. Informe-os quando o certame estiver pronto para publicação.";

const PUB = [
  ["processo.numeroPregao", "Número do pregão", "string"], ["controle.dataDivulgacaoPrevista", "Data prevista de divulgação", "date"],
  ["processo.dataAbertura", "Data da sessão", "date"], ["processo.horarioAbertura", "Horário da sessão", "time"],
  ["processo.dataInicioRecebimentoPropostas", "Início das propostas", "datetime"], ["processo.dataFimRecebimentoPropostas", "Data-limite das propostas", "date"],
  ["processo.horarioFimRecebimentoPropostas", "Horário-limite das propostas", "time"],
] as const;

const base = (over: Partial<PrepField>): PrepField => ({
  name: "x", source: "CERTAME_CONFIG", path: "x", type: "string", description: "X", required: true, conditional: false, requiredWhenVariables: [], hasValue: false,
  class: "PROCESS_DECISION", rule: "PROCESS_SOURCE", authority: "CERTAME_CONFIG", status: "PENDING", editable: true, ...over,
});
const pubField = ([name, description, type]: (typeof PUB)[number], over: Partial<PrepField> = {}): PrepField => base({
  name, description, type, path: name.split(".")[1], required: false, completionPolicy: "DEFERRED_PUBLICATION", class: "PROCESS_DECISION", status: "DEFERRED", ...over,
});
const srpField = (over: Partial<PrepField> = {}): PrepField => base({
  name: "controle.utilizaSrp", source: "PROCESS", path: "utilizaSrp", type: "boolean", description: SRP_LABEL, question: SRP_QUESTION, ...over,
});
const sec = (source: string, fields: PrepField[]): PrepSection => ({ source, scope: "PROCESS", fields, pendingRequired: fields.filter((f) => f.status === "PENDING").length });
const state = (sections: PrepSection[], over: Partial<PreparationStateView> = {}): PreparationStateView => ({
  status: "READY_FOR_PREPARATION", revisionId: "r1", catalogVersion: "cat/1", revisions: { process: 0, organization: 0, budget: 0 },
  budgetDisclosure: "publico", participation: { default: "Ampla" }, participationPending: false,
  trPin: { state: "VALID", ref: { documentId: "d", version: 1, contentHash: "h" } }, sections, facts: {}, canonicalFields: [], orgProfile: null,
  summary: { groups: [], reusedAutomatically: 0, pendingDecisions: 0 },
  metrics: { TOTAL_TEMPLATE_FIELDS: 0, AUTO_RESOLVED: 0, ORG_REUSED: 0, TR_PROJECTED: 0, DECIDED: 0, CONDITIONAL_HIDDEN: 0, POST_AWARD_HIDDEN: 0, OPTIONAL_HIDDEN: 0, MANUAL_DECISIONS_VISIBLE: 0, LEGACY_SHADOWED: 0 },
  ...over,
});
const deferredState = (over: Partial<PreparationStateView> = {}, withSrp = true) => state([
  sec("PROCESS", withSrp ? [srpField()] : []),
  sec("CERTAME_CONFIG", PUB.map((p) => pubField(p))),
], over);

describe("M8-EDITAL-UX-001 — pendências agrupadas pelo que impedem", () => {
  it("decisão do certame impede a ELABORAÇÃO; dados de publicação só a PUBLICAÇÃO (podem ser preenchidos depois)", () => {
    const r = buildEditalReadiness(deferredState());
    expect(r.pendingByLevel.map((l) => [l.level, l.count])).toEqual([["ELABORACAO", 1], ["PUBLICACAO", 7]]);
    expect(r.pendingByLevel[1].label).toMatch(/pode ser preenchido depois/);
    expect(r.steps.find((s) => s.key === "PROCESS_DECISIONS")!.blocks).toBe("ELABORACAO");
    expect(r.steps.filter((s) => s.done).every((s) => s.blocks === "NENHUM")).toBe(true);
  });
  it("sem decisões pendentes: só o nível de publicação aparece (nada impede a elaboração)", () => {
    const r = buildEditalReadiness(deferredState({}, false));
    expect(r.pendingByLevel.map((l) => l.level)).toEqual(["PUBLICACAO"]);
  });
});

describe("PUB — dados de publicação não são decisões do certame", () => {
  it("PUB9 — DEFERRED fora de PROCESS_DECISIONS_TOTAL; contado à parte em DEFERRED_PUBLICATION_TOTAL; nunca pendência", () => {
    const st = deferredState({}, false);
    const r = buildEditalReadiness(st);
    expect(r.counters.PROCESS_DECISIONS_TOTAL).toBe(0);
    expect(r.counters.DEFERRED_PUBLICATION_TOTAL).toBe(7);
    expect(livePendingItems(st, {})).toEqual([]);
    expect(pendingItems(st)).toEqual([]);
    expect(optionalItems(st).map((i) => i.field.name)).toEqual([]);
    expect(r.blockingPrerequisites).toBe(false);
  });
  it("com uma decisão genuína (SRP) pendente: só ela conta como decisão; os 7 dados de publicação NÃO somam", () => {
    const r = buildEditalReadiness(deferredState());
    expect(r.counters.PROCESS_DECISIONS_TOTAL).toBe(1);
    expect(r.counters.DEFERRED_PUBLICATION_TOTAL).toBe(7);
  });
  it("manchete: informa que os dados de publicação podem ser preenchidos depois (sem tratá-los como pendência)", () => {
    const st = deferredState({}, false);
    const headline = readinessHeadline(buildEditalReadiness(st).counters);
    expect(headline).toMatch(/7 dados para publicação podem ser preenchidos depois/);
    expect(headline.split(" · ").find((x) => x.includes("para publicação"))).not.toMatch(/pendên/i);
  });
  it("preenchidos ⇒ o contador de diferidos zera (mesma fonte de verdade do servidor)", () => {
    const filled = state([sec("CERTAME_CONFIG", PUB.map((p) => pubField(p, { status: "DECIDED", hasValue: true, currentValue: "x", displayValue: "x" })))]);
    expect(buildEditalReadiness(filled).counters.DEFERRED_PUBLICATION_TOTAL).toBe(0);
  });
});

describe("SSR — bloco 'Dados para publicação' e SRP", () => {
  let View: typeof import("./EditalPreparationView").default;
  beforeAll(async () => { (globalThis as { React?: unknown }).React = React; View = (await import("./EditalPreparationView")).default; });
  const noop = () => {};
  const props = (st: PreparationStateView, over: object = {}) => ({
    state: st, edits: {}, fieldErrors: {}, pending: livePendingItems(st, {}), optional: optionalItems(st), onEdit: noop, plan: { writes: [], errors: {}, decisionCount: 0 }, reviewing: false,
    onStartReview: noop, onCancelReview: noop, decision: { decidedByName: "", decidedByRole: "", decidedAt: "2026-10-12", basisReference: "", reason: "", confirmed: false }, onDecision: noop,
    showErrors: false, busy: false, outcome: null, notice: null, onConfirm: noop, onOpenStage: noop, onRefresh: noop, ...over,
  });
  const html = (st: PreparationStateView, over: object = {}) => renderToStaticMarkup(React.createElement(View as unknown as React.ComponentType<never>, props(st, over) as never));
  const pubToggle = (out: string) => /<button[^>]*aria-expanded="(true|false)"[^>]*aria-controls="edital-publicacao"/.exec(out)?.[1];

  it("bloco recolhido por padrão (aria-expanded=false, conteúdo no DOM mas hidden), com o texto governado e sem bloquear", () => {
    const out = html(deferredState({}, false));
    expect(pubToggle(out)).toBe("false");
    expect(out).toMatch(/<div id="edital-publicacao"[^>]*hidden/);
    expect(out).toContain("Dados para publicação — 7 a preencher depois");
    expect(out).toContain(NOTE);
    for (const [, label] of PUB) expect(out).toContain(label);               // nada escondido do DOM
    expect(out).toContain("Nenhuma decisão pendente");                          // não vira pendência do certame
    expect(out).not.toContain("[REVISAR");
  });
  it("a pessoa abre manualmente ⇒ aria-expanded=true e campos editáveis (preenchimento posterior pelo plano governado)", () => {
    const out = html(deferredState({}, false), { initialPublicationOpen: true });
    expect(pubToggle(out)).toBe("true");
    expect(out).not.toMatch(/<div id="edital-publicacao"[^>]*hidden/);
    expect(out).toContain('aria-label="Número do pregão"');
  });
  it("sem dados de publicação no modelo (Revisão 1) ⇒ o bloco não existe", () => {
    const st = state([sec("PROCESS", [srpField()])]);
    expect(html(st)).not.toContain("edital-publicacao");
  });
  it("SRP1/SRP2 — pergunta operacional em linguagem do órgão (Sim/Não); nunca o nome técnico da variável", () => {
    const out = html(deferredState());
    expect(out).toContain(`aria-label="${SRP_QUESTION}"`);
    expect(out).toMatch(/<option[^>]*>Sim<\/option>/);
    expect(out).toMatch(/<option[^>]*>Não<\/option>/);
    // o BLOCO da pergunta (operacional) mostra rótulo + pergunta; o nome técnico só existe no mapeamento técnico recolhido (detalhes)
    const at = out.indexOf('data-field="controle.utilizaSrp"');
    const block = out.slice(out.indexOf(">", at) + 1);
    const text = block.slice(0, block.indexOf("</div></div>")).replace(/<[^>]+>/g, " ");
    expect(text).toContain(SRP_LABEL);
    expect(text).not.toContain("utilizaSrp");
  });
  it("SRP3 — o SRP continua uma decisão HUMANA do certame (pendente e contada), não um dado de publicação", () => {
    const st = deferredState();
    expect(livePendingItems(st, {}).map((i) => i.field.name)).toEqual(["controle.utilizaSrp"]);
    expect(srpField().completionPolicy).toBeUndefined();
  });
});

describe("CAP — a tela só envia o hash de recomposição quando a revisão vinculada declara a capability (o servidor reaplica o gate)", () => {
  const SRC = readFileSync(path.resolve("client/src/components/procurement/EditalWorkspace.tsx"), "utf8");
  it("expectedContentHash/confirmReplace do ramo institucional dependem de preparationState.capabilities.governedDraftRecomposition", () => {
    expect(SRC).toContain("preparationState?.capabilities?.governedDraftRecomposition");
    const branch = SRC.slice(SRC.indexOf("if (bound) {"), SRC.indexOf("// Decisão PURA antes de qualquer chamada"));
    expect(branch).toContain("recomposeHash");
    expect(branch).not.toMatch(/expectedContentHash:\s*draft\?\.contentHash/);
  });
  it("sem a capability (ou sem estado de preparação) o hash não é enviado", () => {
    const recompose = (caps: { governedDraftRecomposition: boolean } | undefined, hash: string | undefined) => (caps?.governedDraftRecomposition ? hash : undefined);
    expect(recompose(undefined, "h")).toBeUndefined();
    expect(recompose({ governedDraftRecomposition: false }, "h")).toBeUndefined();
    expect(recompose({ governedDraftRecomposition: true }, "h")).toBe("h");
  });
});
