/**
 * Dados de publicação ainda não definidos — aviso informativo (elaboração discreto; finalização completo). Nunca bloqueia; nunca inventa valor; só aparece quando o
 * modelo vinculado declara `DEFERRED_PUBLICATION` (Revisão 1 exige os dados na preparação e não tem o aviso). Fonte = estado do servidor, nunca o texto da minuta.
 */
import { beforeAll, describe, expect, it } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { publicationPending, buildEditalReadiness } from "@/lib/editalReadiness";
import type { PrepField, PrepSection, PreparationStateView } from "@/lib/editalPreparation";

let Notice: typeof import("./PublicationPendingNotice").PublicationPendingNotice;
beforeAll(async () => { (globalThis as { React?: unknown }).React = React; Notice = (await import("./PublicationPendingNotice")).PublicationPendingNotice; });
const h = (props: object) => renderToStaticMarkup(React.createElement(Notice as React.ComponentType<never>, props as never));

const PUB = [
  ["processo.dataAbertura", "Data da sessão"], ["processo.horarioAbertura", "Horário da sessão"],
  ["processo.dataInicioRecebimentoPropostas", "Início do recebimento das propostas"], ["processo.dataFimRecebimentoPropostas", "Data-limite das propostas"],
] as const;
const field = (name: string, description: string, over: Partial<PrepField> = {}): PrepField => ({
  name, source: "CERTAME_CONFIG", path: name.split(".")[1], type: "string", description, required: false, conditional: false, requiredWhenVariables: [], hasValue: false,
  class: "PROCESS_DECISION", rule: "PROCESS_SOURCE", authority: "CERTAME_CONFIG", status: "DEFERRED", editable: true, completionPolicy: "DEFERRED_PUBLICATION", ...over,
});
const sec = (fields: PrepField[]): PrepSection => ({ source: "CERTAME_CONFIG", scope: "PROCESS", fields, pendingRequired: 0 });
const state = (over: Partial<PreparationStateView> = {}, fields = PUB.map(([n, d]) => field(n, d))): PreparationStateView => ({
  status: "READY_FOR_PREPARATION", revisionId: "r2", catalogVersion: "cat/2", revisions: { process: 0, organization: 0, budget: 0 }, budgetDisclosure: "publico", participation: { default: "Ampla" },
  participationPending: false, trPin: { state: "VALID", ref: { documentId: "d", version: 1, contentHash: "h" } }, sections: [sec(fields)], facts: {}, canonicalFields: [], orgProfile: null,
  summary: { groups: [], reusedAutomatically: 0, pendingDecisions: 0 },
  metrics: { TOTAL_TEMPLATE_FIELDS: 0, AUTO_RESOLVED: 0, ORG_REUSED: 0, TR_PROJECTED: 0, DECIDED: 0, CONDITIONAL_HIDDEN: 0, POST_AWARD_HIDDEN: 0, OPTIONAL_HIDDEN: 0, MANUAL_DECISIONS_VISIBLE: 0, LEGACY_SHADOWED: 0 },
  publication: { deferredPolicy: true, schedule: {}, readiness: { complete: false, total: 4, missing: [], missingVariables: PUB.map(([n]) => n) } }, ...over,
});

describe("publicationPending (view-model; sem regra nova no cliente)", () => {
  it("datas ausentes: lista os dados pendentes com o rótulo operacional, na ordem do servidor", () => {
    expect(publicationPending(state())).toEqual({ applicable: true, complete: false, items: PUB.map(([name, label]) => ({ name, label })) });
  });
  it("datas preenchidas (readiness completa): nada pendente", () => {
    const st = state({ publication: { deferredPolicy: true, schedule: {}, readiness: { complete: true, total: 4, missing: [], missingVariables: [] } } });
    expect(publicationPending(st)).toEqual({ applicable: true, complete: true, items: [] });
  });
  it("parcial: só o que falta (sessão informada, propostas pendentes)", () => {
    const st = state({ publication: { deferredPolicy: true, schedule: {}, readiness: { complete: false, total: 4, missing: [], missingVariables: ["processo.dataInicioRecebimentoPropostas", "processo.dataFimRecebimentoPropostas"] } } });
    expect(publicationPending(st).items.map((i) => i.label)).toEqual(["Início do recebimento das propostas", "Data-limite das propostas"]);
  });
  it("Revisão 1 / modelo sem política diferida ⇒ NÃO aplicável (a preparação exige os dados); sem estado ⇒ não aplicável; sem rótulo ⇒ usa o nome", () => {
    expect(publicationPending(state({ publication: { deferredPolicy: false, schedule: {}, readiness: { complete: false, total: 4, missing: [], missingVariables: ["processo.dataAbertura"] } } })).applicable).toBe(false);
    expect(publicationPending(state({ publication: undefined })).applicable).toBe(false);
    expect(publicationPending(null).applicable).toBe(false);
    expect(publicationPending(state({}, [])).items).toEqual(PUB.map(([n]) => ({ name: n, label: n })));
  });
  it("nunca vira bloqueio: a prontidão da preparação continua sem pendência de decisão por causa das datas", () => {
    const r = buildEditalReadiness(state());
    expect(r.counters.PROCESS_DECISIONS_TOTAL).toBe(0);
    expect(r.blockingPrerequisites).toBe(false);
  });
});

describe("PublicationPendingNotice", () => {
  const pending = publicationPending(state());
  it("elaboração: aviso DISCRETO, identifica o placeholder governado e diz que não impede a elaboração", () => {
    const html = h({ pending, variant: "drafting" });
    expect(html).toContain('data-testid="publication-pending-drafting"');
    expect(html).toContain("Data da sessão"); expect(html).toContain("A DEFINIR PARA PUBLICAÇÃO"); expect(html).toContain("não impede a elaboração");
    expect(html).not.toContain('role="alert"');
  });
  it("finalização: lista TUDO que falta para PUBLICAR, lembra que o LiciGov Pro não publica e que a lista não bloqueia a emissão", () => {
    const html = h({ pending, variant: "finalizing" });
    for (const [, label] of PUB) expect(html).toContain(label);
    expect(html).toContain("Antes de publicar oficialmente este Edital"); expect(html).toContain("não publica editais oficialmente"); expect(html).toContain("não bloqueia a emissão");
    expect(html).toContain('role="status"'); expect(html).not.toContain('role="alert"');
  });
  it("sem pendência / não aplicável: não renderiza nada (nenhum ruído)", () => {
    expect(h({ pending: publicationPending(state({ publication: { deferredPolicy: true, schedule: {}, readiness: { complete: true, total: 4, missing: [], missingVariables: [] } } })), variant: "finalizing" })).toBe("");
    expect(h({ pending: publicationPending(null), variant: "drafting" })).toBe("");
  });
});
