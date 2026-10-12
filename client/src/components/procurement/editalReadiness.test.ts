/**
 * Preparação do Edital — READINESS-FIRST + PROGRESSIVE DISCLOSURE (UX1–UX12).
 * Lógica pura (view-model de prontidão, contadores unificados) + SSR (react-dom/server, sem DOM). Nenhuma autoridade nova: os testes provam que
 * a prontidão é só uma LEITURA do estado que a API já entrega e que a apresentação obedece ao estado (recolhe/abre, bloqueia, explica).
 */
import { beforeAll, describe, expect, it } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  fixAction, generateReady, type AuthorityClass, type EntryPoint, type FieldStatus, type PrepField, type PrepSection, type PreparationStateView, type StageTarget,
} from "@/lib/editalPreparation";
import {
  ORIGIN_LABEL, TR_OFFICIAL_EXACT_MESSAGE, TR_OFFICIAL_EXACT_REQUIRED, TR_SELECTION_ANCHOR, buildEditalReadiness, generationCta, isDecisionsOpen, originGroups, readinessHeadline,
} from "@/lib/editalReadiness";
import { livePendingItems, pendingItems, optionalItems } from "@/lib/editalPreparation";

const read = (rel: string) => readFileSync(path.resolve(rel), "utf8");

let seq = 0;
const field = (over: Partial<PrepField> = {}): PrepField => {
  const n = `f${++seq}`;
  return {
    name: n, source: "CERTAME_CONFIG", path: n, type: "string", description: `Campo ${n}`, required: true, conditional: false, requiredWhenVariables: [], hasValue: false,
    class: "PROCESS_DECISION", rule: "PROCESS_SOURCE", authority: "CERTAME_CONFIG", status: "PENDING", editable: true, ...over,
  };
};
const section = (source: string, scope: "ORG" | "PROCESS", fields: PrepField[]): PrepSection => ({ source, scope, fields, pendingRequired: fields.filter((x) => x.status === "PENDING").length });
const many = (n: number, over: Partial<PrepField> = {}): PrepField[] => Array.from({ length: n }, () => field(over));
const state = (sections: PrepSection[], over: Partial<PreparationStateView> = {}): PreparationStateView => ({
  status: "READY_FOR_PREPARATION", revisionId: "r1", catalogVersion: "cat/1", revisions: { process: 0, organization: 0, budget: 0 },
  budgetDisclosure: "publico", participation: { default: "Ampla" }, participationPending: false,
  trPin: { state: "VALID", ref: { documentId: "d", version: 1, contentHash: "h" } }, sections, facts: {}, canonicalFields: [], orgProfile: null,
  summary: { groups: [], reusedAutomatically: 0, pendingDecisions: 0 },
  metrics: { TOTAL_TEMPLATE_FIELDS: 0, AUTO_RESOLVED: 0, ORG_REUSED: 0, TR_PROJECTED: 0, DECIDED: 0, CONDITIONAL_HIDDEN: 0, POST_AWARD_HIDDEN: 0, OPTIONAL_HIDDEN: 0, MANUAL_DECISIONS_VISIBLE: 0, LEGACY_SHADOWED: 0 },
  ...over,
});
const canonical = (status: FieldStatus, over: object = {}) => {
  const n = `c${++seq}`;
  return { name: n, source: "PROCESS", path: n, type: "string", description: `Canônico ${n}`, status, displayValue: "valor", origin: { label: "Cadastro do órgão" }, authority: "EXISTING_CANONICAL" as AuthorityClass, ...over };
};
const pendingSource = (name: string, fix: EntryPoint, reason = "dado ausente na origem") => ({ name, description: `Dado ${name}`, reason, fix });
const profileEntry = (name: string) => ({ name, description: `Perfil ${name}`, reason: "política do órgão ainda não registrada" });

/** Cenário equivalente ao piloto real: TR não selecionado, perfil do órgão incompleto, pendências na origem e 13 decisões do certame. */
function pilotLike(over: { trPin?: PreparationStateView["trPin"]; profile?: "pending" | "done"; sources?: "pending" | "done"; decisions?: number } = {}): PreparationStateView {
  const sources = over.sources ?? "pending";
  const profile = over.profile ?? "pending";
  const decisions = over.decisions ?? 13;
  const profileFields = profile === "pending"
    ? many(8, { source: "POLICY", authority: "ORG_POLICY_PROFILE", class: "ORG_PROFILE", status: "PROFILE_INCOMPLETE", editable: false })
    : many(8, { source: "POLICY", authority: "ORG_POLICY_PROFILE", class: "ORG_PROFILE", status: "ORG_REUSED", editable: false, hasValue: true, displayValue: "x" });
  const decisionFields = [
    ...many(Math.max(0, decisions - 6), { authority: "CERTAME_CONFIG" }),
    ...many(Math.min(6, decisions), { authority: "CERTAME_SCHEDULE", source: "LIFECYCLE", type: "date" }),
  ].slice(0, decisions);
  const auto = many(4, { source: "PROCESS", authority: "UPSTREAM_PROCESS", class: "CANONICAL", status: "AUTO", editable: false, hasValue: true, displayValue: "v" });
  return state([
    section("POLICY", "ORG", profileFields),
    section("PROCESS", "PROCESS", auto),
    section("CERTAME_CONFIG", "PROCESS", decisionFields.filter((f) => f.authority === "CERTAME_CONFIG")),
    section("LIFECYCLE", "PROCESS", decisionFields.filter((f) => f.authority === "CERTAME_SCHEDULE")),
  ], {
    trPin: over.trPin ?? { state: "NOT_SELECTED" },
    canonicalFields: [canonical("AUTO"), canonical("AUTO", { authority: "LIFECYCLE_SYSTEM", displayValue: "atribuída na emissão" }),
      ...(sources === "pending" ? [canonical("PENDING_SOURCE", { authority: "UPSTREAM_PRICE_RESEARCH", displayValue: undefined })] : [])],
    upstream: {
      trDigest: "x", trPending: [],
      profilePending: profile === "pending" ? profileFields.map((f) => profileEntry(f.name)) : [],
      sourcePending: sources === "pending" ? [pendingSource("julgamento.dataOrcamentoEstimado", "PRICE_RESEARCH"), pendingSource("processo.enderecoEletronicoBll", "PLATFORM_PROFILE"), pendingSource("julgamento.regimeParticipacao", "ITEMS")] : [],
    },
  });
}

describe("UX — view-model de prontidão (puro)", () => {
  it("UX4 — AUTO_RESOLVED_TOTAL não inclui CONDITIONAL_HIDDEN", () => {
    const hidden = many(5, { status: "HIDDEN_CONDITIONAL", editable: false, authority: "CONDITIONAL", class: "CONDITIONAL", required: false });
    const auto = many(2, { status: "AUTO", editable: false, hasValue: true, authority: "UPSTREAM_PROCESS", class: "CANONICAL" });
    const r = buildEditalReadiness(state([section("PROCESS", "PROCESS", [...hidden, ...auto])], { metrics: { ...state([]).metrics, CONDITIONAL_HIDDEN: 5 } }));
    expect(r.counters.AUTO_RESOLVED_TOTAL).toBe(2);
    expect(r.details.conditionalHidden).toBe(5);
  });

  it("UX5 — AUTO_RESOLVED_TOTAL não inclui POST_AWARD_HIDDEN (nem campos do sistema atribuídos só na emissão, nem decisões humanas)", () => {
    const postAward = many(3, { status: "HIDDEN_POST_AWARD", editable: false, authority: "POST_AWARD", class: "POST_AWARD" });
    const decided = many(2, { status: "DECIDED", hasValue: true, displayValue: "x" });
    const auto = many(1, { status: "AUTO", editable: false, hasValue: true, authority: "UPSTREAM_PROCESS", class: "CANONICAL" });
    const r = buildEditalReadiness(state([section("PROCESS", "PROCESS", [...postAward, ...decided, ...auto])], {
      metrics: { ...state([]).metrics, POST_AWARD_HIDDEN: 20 },
      canonicalFields: [canonical("AUTO"), canonical("AUTO", { authority: "LIFECYCLE_SYSTEM" })],
    }));
    expect(r.counters.AUTO_RESOLVED_TOTAL).toBe(1 + 1);          // 1 campo AUTO + 1 canônico AUTO; NÃO: pós-homologação, decisão humana, late-bound
    expect(r.details.postAwardHidden).toBe(20);
    expect(r.details.systemAtIssuance).toBe(1);
    expect(r.details.decisionsRegistered).toBe(2);
  });

  it("UX6 — ORIGIN_ACTION_REQUIRED_TOTAL não inclui decisões do processo", () => {
    const r = buildEditalReadiness(pilotLike({ trPin: { state: "VALID", ref: { documentId: "d", version: 1, contentHash: "h" } }, profile: "done" }));
    expect(r.counters.PROCESS_DECISIONS_TOTAL).toBe(13);
    expect(r.counters.ORIGIN_ACTION_REQUIRED_TOTAL).toBe(3);      // só as 3 pendências na origem (TR válido ⇒ não conta o TR)
    const names = r.originGroups.flatMap((g) => g.items.map((i) => i.key));
    expect(names).toEqual(expect.arrayContaining(["julgamento.dataOrcamentoEstimado", "processo.enderecoEletronicoBll", "julgamento.regimeParticipacao"]));
    expect(names.some((n) => n.startsWith("f"))).toBe(false);     // nenhuma decisão do certame vaza para a origem
  });

  it("UX7 — PROCESS_DECISIONS_TOTAL conta só campos EDITÁVEIS cuja autoridade pertence ao certame (inclui condicional ATIVO; exclui o resto)", () => {
    const counted = [
      field({ authority: "CERTAME_CONFIG" }), field({ authority: "CERTAME_SCHEDULE", source: "LIFECYCLE" }), field({ authority: "CONDITIONAL", class: "CONDITIONAL" }),
    ];
    const notCounted = [
      field({ authority: "ORG_POLICY_PROFILE", editable: true }),                       // institucional (mesmo "editável" por engano nunca é decisão do certame)
      field({ authority: "UPSTREAM_ITEMS", status: "PENDING_SOURCE", editable: false }),  // origem
      field({ authority: "CERTAME_SCHEDULE", status: "AWAITING", editable: false }),      // derivável: aguarda a base
      field({ authority: "LIFECYCLE_SYSTEM", status: "AUTO", editable: false }),          // late-bound
      field({ authority: "CONDITIONAL", status: "HIDDEN_CONDITIONAL", editable: false }),  // condicional ainda não ativado
      field({ authority: "POST_AWARD", status: "HIDDEN_POST_AWARD", editable: false }),    // pós-homologação
    ];
    const st = state([section("CERTAME_CONFIG", "PROCESS", [...counted, ...notCounted])]);
    expect(buildEditalReadiness(st).counters.PROCESS_DECISIONS_TOTAL).toBe(3);
    // escopo ORG nunca é decisão do certame
    expect(buildEditalReadiness(state([section("POLICY", "ORG", [field({ authority: "CERTAME_CONFIG" })])])).counters.PROCESS_DECISIONS_TOTAL).toBe(0);
  });

  it("UX8 — perfil global com 33 pendências, só 4 necessárias a ESTE Edital ⇒ a superfície principal mostra 4 (não 33)", () => {
    const required = many(4, { source: "POLICY", authority: "ORG_POLICY_PROFILE", class: "ORG_PROFILE", status: "PROFILE_INCOMPLETE", editable: false, required: true });
    const extra = many(29, { source: "POLICY", authority: "ORG_POLICY_PROFILE", class: "ORG_PROFILE", status: "PROFILE_INCOMPLETE", editable: false, required: false });
    const st = state([section("POLICY", "ORG", [...required, ...extra])], { upstream: { trDigest: "x", trPending: [], sourcePending: [], profilePending: [...required, ...extra].map((f) => profileEntry(f.name)) } });
    const r = buildEditalReadiness(st);
    expect(r.counters.ONE_TIME_CONFIGURATION_REQUIRED_TOTAL).toBe(4);
    expect(r.details.requiredForCurrentDocument).toBe(4);
    expect(r.details.profileGlobalIncomplete).toBe(29);
    expect(readinessHeadline(r.counters)).toContain("4 a configurar uma única vez");
    expect(readinessHeadline(r.counters)).not.toContain("33");
  });

  it("UX9 — TR exato obrigatório: sem pin, status TR_OFFICIAL_EXACT_REQUIRED, bloqueio e geração desabilitada (fail closed; sem latest/heurística)", () => {
    const r = buildEditalReadiness(pilotLike({ trPin: { state: "NOT_SELECTED" } }));
    expect(r.tr).toEqual({ status: TR_OFFICIAL_EXACT_REQUIRED, message: TR_OFFICIAL_EXACT_MESSAGE });
    expect(r.steps[0]).toMatchObject({ key: "TR_OFFICIAL", category: "BLOCKING_OFFICIAL_SOURCE_REQUIRED", done: false });
    expect(r.blockingPrerequisites).toBe(true);
    expect(generationCta(r, { ready: true }).primary).toBe("RESOLVE_PENDING");
    expect(generationCta(r).generateDisabledReason).toBe(TR_OFFICIAL_EXACT_MESSAGE);
    expect(generateReady(true, false, undefined).ready).toBe(false);                    // o gate existente continua valendo
    const stale = buildEditalReadiness(pilotLike({ trPin: { state: "INVALID", code: "OFFICIAL_PIN_STALE" } }));
    expect(stale.tr.status).toBe(TR_OFFICIAL_EXACT_REQUIRED);
    // nenhuma escolha automática do "melhor TR" no view-model nem na lib
    expect(read("client/src/lib/editalReadiness.ts")).not.toMatch(/\.sort\(|trCandidates|officialPins/);
  });

  it("UX10 — deep-links por origem: rótulo e destino corretos (navegação, nunca escrita)", () => {
    const expected: Array<[EntryPoint, string, { href?: string; stage?: StageTarget }]> = [
      ["PRICE_RESEARCH", "Corrigir na Pesquisa de Preços", { stage: "price" }],
      ["ORG_REGISTRY", "Corrigir cadastro do órgão", { href: "/configuracoes" }],
      ["ITEMS", "Abrir Itens da contratação", { stage: "contract_items" }],
      ["PLATFORM_PROFILE", "Configurar Perfil da plataforma", { href: "/configuracoes#perfil-licitacoes" }],
      ["REQUESTING_UNIT", "Corrigir unidade requisitante", { stage: "dfd" }],
      ["TR_SECTION", "Abrir o TR", { stage: "tr" }],
    ];
    for (const [entry, label, target] of expected) expect(fixAction(entry), entry).toMatchObject({ label, ...target });
    const st = state([], { upstream: { trDigest: "x", trPending: [], profilePending: [], sourcePending: expected.slice(0, 5).map(([e], i) => pendingSource(`dado${i}`, e)) } });
    const groups = originGroups(st);
    expect(groups.map((g) => g.entry)).toEqual(["PRICE_RESEARCH", "ORG_REGISTRY", "ITEMS", "PLATFORM_PROFILE", "REQUESTING_UNIT"]);
    for (const g of groups) { expect(g.origin).toBe(ORIGIN_LABEL[g.entry]); expect(g.action).not.toBeNull(); }
    // a view só navega: nenhuma mutação/rota de escrita
    const view = read("client/src/components/procurement/EditalPreparationView.tsx");
    expect(view).not.toMatch(/useMutation|mutateAsync|trpc\./);
  });

  it("UX11 — CTA de geração desabilitado sempre traz motivo; 'Resolver pendências' tem o protagonismo enquanto houver pendência", () => {
    const tr = generationCta(buildEditalReadiness(pilotLike({ trPin: { state: "NOT_SELECTED" } })));
    expect(tr).toMatchObject({ primary: "RESOLVE_PENDING", primaryLabel: "Resolver pendências" });
    const cfg = generationCta(buildEditalReadiness(pilotLike({ trPin: { state: "VALID", ref: { documentId: "d", version: 1, contentHash: "h" } } })));
    expect(cfg.generateDisabledReason).toMatch(/configuração institucional/i);
    const origin = generationCta(buildEditalReadiness(pilotLike({ trPin: { state: "VALID", ref: { documentId: "d", version: 1, contentHash: "h" } }, profile: "done" })));
    expect(origin.generateDisabledReason).toMatch(/na origem/);
    const decisions = generationCta(buildEditalReadiness(pilotLike({ trPin: { state: "VALID", ref: { documentId: "d", version: 1, contentHash: "h" } }, profile: "done", sources: "done" })));
    expect(decisions).toMatchObject({ primary: "RESOLVE_PENDING" });
    expect(decisions.generateDisabledReason).toMatch(/13 decisões/);
  });

  it("UX12 — prontidão completa devolve o protagonismo à geração, sem alterar o backend (o gate de preflight/BOUND continua mandando)", () => {
    const ready = buildEditalReadiness(pilotLike({ trPin: { state: "VALID", ref: { documentId: "d", version: 1, contentHash: "h" } }, profile: "done", sources: "done", decisions: 0 }));
    expect(ready).toMatchObject({ blockingPrerequisites: false, sourcesReady: true, nextStep: null });
    expect(ready.counters).toMatchObject({ ORIGIN_ACTION_REQUIRED_TOTAL: 0, ONE_TIME_CONFIGURATION_REQUIRED_TOTAL: 0, PROCESS_DECISIONS_TOTAL: 0 });
    expect(generationCta(ready, generateReady(true, true, { status: "READY_FOR_COMPOSITION", templateRevisionId: "r", templateSemanticHash: "h" }))).toEqual({ primary: "GENERATE", primaryLabel: "Gerar edital com modelo institucional" });
    // ainda aguardando o preflight: continua desabilitado, com motivo (o backend segue fail closed)
    expect(generationCta(ready, generateReady(true, true, undefined)).generateDisabledReason).toBeTruthy();
    // puro: nada de rede/React/estado persistido no view-model
    expect(read("client/src/lib/editalReadiness.ts")).not.toMatch(/from "react"|fetch\(|trpc|localStorage|useMutation/);
  });

  it("desacoplamento do estado vivo: o que a pessoa digita reduz PROCESS_DECISIONS_TOTAL (sem alterar a leitura do servidor)", () => {
    const st = pilotLike({ trPin: { state: "VALID", ref: { documentId: "d", version: 1, contentHash: "h" } }, profile: "done", sources: "done", decisions: 3 });
    const target = st.sections.flatMap((s) => s.fields).find((f) => f.authority === "CERTAME_SCHEDULE" && f.editable)!;
    const sourceOf = st.sections.find((s) => s.fields.includes(target))!.source;
    expect(buildEditalReadiness(st).counters.PROCESS_DECISIONS_TOTAL).toBe(3);
    expect(buildEditalReadiness(st, { [sourceOf]: { [target.path]: "2026-10-20" } }).counters.PROCESS_DECISIONS_TOTAL).toBe(2);
    expect(pendingItems(st).length).toBeGreaterThanOrEqual(3);
    expect(livePendingItems(st, {}).length).toBe(optionalItems(st).length + 3);
  });
});

describe("UX — SSR da preparação (progressive disclosure)", () => {
  let View: typeof import("./EditalPreparationView").default;
  let Cta: typeof import("./EditalGenerateCta").default;
  beforeAll(async () => {
    (globalThis as { React?: unknown }).React = React;
    View = (await import("./EditalPreparationView")).default;
    Cta = (await import("./EditalGenerateCta")).default;
  });
  const noop = () => {};
  const props = (st: PreparationStateView, over: object = {}) => ({
    state: st, edits: {}, fieldErrors: {}, pending: pendingItems(st), optional: optionalItems(st), onEdit: noop, plan: { writes: [], errors: {}, decisionCount: 0 }, reviewing: false,
    onStartReview: noop, onCancelReview: noop, decision: { decidedByName: "", decidedByRole: "", decidedAt: "2026-10-12", basisReference: "", reason: "", confirmed: false }, onDecision: noop,
    showErrors: false, busy: false, outcome: null, notice: null, onConfirm: noop, onOpenStage: noop, onRefresh: noop, ...over,
  });
  const html = (st: PreparationStateView, over: object = {}) => renderToStaticMarkup(React.createElement(View as unknown as React.ComponentType<never>, props(st, over) as never));
  const disclosure = (out: string) => /<button[^>]*aria-expanded="(true|false)"[^>]*aria-controls="edital-decisoes"/.exec(out)?.[1];

  it("UX1 — TR ausente + pendências na origem + 13 decisões ⇒ decisões RECOLHIDAS por padrão (e ainda no DOM para consulta)", () => {
    const out = html(pilotLike());
    expect(disclosure(out)).toBe("false");
    expect(out).toMatch(/<div id="edital-decisoes"[^>]*hidden/);
    expect(out).toContain("Decisões deste certame — 13");
    expect(out).toContain("13 decisões serão necessárias após resolver as pendências acima");
    expect(out).toContain("Ver decisões agora");
    expect(out).toContain("Campo f");                           // não esconder informação: os campos estão no DOM (apenas recolhidos)
    // blockers principais continuam visíveis, fora do recolhimento
    expect(out).toContain("Selecionar TR oficial");
    expect(out).toContain("Complete a configuração única do órgão");
    expect(out).toContain("Dados a resolver na origem");
  });

  it("UX2 — a pessoa abre manualmente ⇒ decisões visíveis (com aria-expanded=true); a escolha manual vence o padrão", () => {
    const st = pilotLike();
    const open = html(st, { initialDecisionsOpen: true });
    expect(disclosure(open)).toBe("true");
    expect(open).not.toMatch(/<div id="edital-decisoes"[^>]*hidden/);
    expect(open).not.toContain("Ver decisões agora");           // já aberto
    // lógica: escolha explícita (abrir/fechar) vence o padrão, em qualquer estado de prontidão
    const blocked = buildEditalReadiness(st); const ready = buildEditalReadiness(pilotLike({ trPin: { state: "VALID", ref: { documentId: "d", version: 1, contentHash: "h" } }, profile: "done", sources: "done" }));
    expect(isDecisionsOpen(blocked, true)).toBe(true);
    expect(isDecisionsOpen(ready, false)).toBe(false);
    // a escolha de recolher quando pronto também é respeitada na renderização
    expect(disclosure(html(pilotLike({ trPin: { state: "VALID", ref: { documentId: "d", version: 1, contentHash: "h" } }, profile: "done", sources: "done" }), { initialDecisionsOpen: false }))).toBe("false");
  });

  it("UX3 — todos os bloqueios resolvidos ⇒ decisões ABERTAS por padrão, com 'Fontes e configurações prontas.' e a chamada às decisões", () => {
    const readySt = pilotLike({ trPin: { state: "VALID", ref: { documentId: "d", version: 1, contentHash: "h" } }, profile: "done", sources: "done" });
    const out = html(readySt);
    expect(disclosure(out)).toBe("true");
    expect(out).toContain("Fontes e configurações prontas.");
    expect(out).toContain("Agora defina as decisões específicas deste certame.");
    expect(out).not.toContain("Ver decisões agora");
    // sem escolha da pessoa, abre SOZINHA quando o último bloqueio some (mesmo componente, mesma ausência de escolha)
    expect(isDecisionsOpen(buildEditalReadiness(pilotLike()), null)).toBe(false);
    expect(isDecisionsOpen(buildEditalReadiness(readySt), null)).toBe(true);
  });

  it("contadores unificados na superfície principal; decomposição só nos detalhes técnicos", () => {
    const st = pilotLike();
    const r = buildEditalReadiness(st);
    const out = html(st);
    expect(out).toContain(readinessHeadline(r.counters));
    expect(r.counters).toMatchObject({ AUTO_RESOLVED_TOTAL: 5, ORIGIN_ACTION_REQUIRED_TOTAL: 1 + 3, ONE_TIME_CONFIGURATION_REQUIRED_TOTAL: 8, PROCESS_DECISIONS_TOTAL: 13 });
    expect(out).toContain("Ver dados reaproveitados — 5");      // o MESMO número do topo (AUTO_RESOLVED_TOTAL)
    expect(out).toContain("Ver detalhes técnicos");
    // sem números legados concorrentes na superfície (o resumo do servidor não é mais mostrado)
    expect(out).not.toMatch(/reaproveitadas automaticamente|decisões ainda precisam de você/);
  });

  it("UX8 (UI) — perfil: mostra só o necessário a este Edital; adicionais ficam nos detalhes", () => {
    const required = many(4, { source: "POLICY", authority: "ORG_POLICY_PROFILE", class: "ORG_PROFILE", status: "PROFILE_INCOMPLETE", editable: false });
    const extra = many(29, { source: "POLICY", authority: "ORG_POLICY_PROFILE", class: "ORG_PROFILE", status: "PROFILE_INCOMPLETE", editable: false, required: false });
    const st = state([section("POLICY", "ORG", [...required, ...extra])], { upstream: { trDigest: "x", trPending: [], sourcePending: [], profilePending: [...required, ...extra].map((f) => profileEntry(f.name)) } });
    const out = html(st);
    expect(out).toContain("4 informações necessárias para este Edital");
    expect(out).not.toMatch(/33 campos/);
    expect(out).toContain("29 campos adicionais");
  });

  it("UX9 (UI) — TR exato obrigatório visível, com código estável, âncora de seleção e sem sugerir 'último' TR", () => {
    const out = html(pilotLike());
    expect(out).toContain(TR_OFFICIAL_EXACT_MESSAGE);
    expect(out).toContain(`data-code="${TR_OFFICIAL_EXACT_REQUIRED}"`);
    expect(out).toContain(`href="#${TR_SELECTION_ANCHOR}"`);
    expect(out).not.toMatch(/mais recente automaticamente|último TR|latest/i);
  });

  it("UX10 (UI) — cada pendência na origem agrupada pela origem, com a ação direta correspondente", () => {
    const st = state([], { upstream: { trDigest: "x", trPending: [], profilePending: [], sourcePending: [
      pendingSource("a", "ORG_REGISTRY", "endereço da sede"), pendingSource("b", "ORG_REGISTRY", "site oficial"), pendingSource("c", "PLATFORM_PROFILE"), pendingSource("d", "PRICE_RESEARCH"),
      pendingSource("e", "ITEMS"), pendingSource("f", "REQUESTING_UNIT"),
    ] } });
    const out = html(st);
    for (const label of ["Corrigir cadastro do órgão", "Configurar Perfil da plataforma", "Corrigir na Pesquisa de Preços", "Abrir Itens da contratação", "Corrigir unidade requisitante"]) expect(out).toContain(label);
    expect((out.match(/Corrigir cadastro do órgão/g) ?? []).length).toBe(1);   // um botão por origem (não por item)
    expect(out).toContain('data-origin="ORG_REGISTRY"');
    expect(out).toContain("Cadastro do órgão");
    expect(out).toContain("Pesquisa de Preços");
  });

  it("cronograma: datas independentes (editáveis) separadas das derivadas (somente leitura, com a regra explicada)", () => {
    const independent = field({ authority: "CERTAME_SCHEDULE", source: "LIFECYCLE", type: "date", description: "Data de abertura" });
    const derived = field({ authority: "CERTAME_SCHEDULE", source: "LIFECYCLE", type: "date", description: "Fim do recebimento", status: "AUTO", editable: false, hasValue: true, displayValue: "2026-10-20", origin: { label: "Regra do Perfil da plataforma" } });
    const st = state([section("LIFECYCLE", "PROCESS", [independent, derived])]);
    const out = html(st, { initialDecisionsOpen: true });
    expect(out).toContain("datas independentes");
    expect(out).toContain("datas e horários derivados");
    expect(out).toContain("Derivado automaticamente pela regra configurada");
    expect(out).toContain("somente leitura");
    expect(out).toContain("Data de abertura");
    expect(out).not.toMatch(new RegExp(`id="prep-LIFECYCLE-${derived.path}"`));    // derivado nunca tem input
  });

  it("UX11 (UI) — botão de geração desabilitado apresenta motivo associado (aria-describedby) e 'Resolver pendências' lidera", () => {
    const cta = generationCta(buildEditalReadiness(pilotLike()));
    const out = renderToStaticMarkup(React.createElement(Cta, { cta, disabled: false, pending: false, bound: true, reason: cta.generateDisabledReason, onGenerate: noop }));
    expect(out).toContain("Resolver pendências");
    expect(out).toMatch(/href="#edital-prontidao"/);
    expect(out).toMatch(/<button[^>]*aria-describedby="edital-generate-reason"[^>]*\sdisabled=""/);
    expect(out).toContain('id="edital-generate-reason"');
    expect(out).toContain(TR_OFFICIAL_EXACT_MESSAGE);
    expect(out).toContain("Gerar edital com modelo institucional");        // existe, só não tem o protagonismo
  });

  it("UX12 (UI) — com prontidão completa e preflight READY a geração é o CTA habilitado (fluxo atual intacto)", () => {
    const ready = buildEditalReadiness(pilotLike({ trPin: { state: "VALID", ref: { documentId: "d", version: 1, contentHash: "h" } }, profile: "done", sources: "done", decisions: 0 }));
    const cta = generationCta(ready, generateReady(true, true, { status: "READY_FOR_COMPOSITION", templateRevisionId: "r", templateSemanticHash: "h" }));
    const out = renderToStaticMarkup(React.createElement(Cta, { cta, disabled: false, pending: false, bound: true, onGenerate: noop }));
    expect(out).not.toContain("Resolver pendências");
    expect(out).not.toMatch(/\sdisabled=""/);
    expect(out).not.toContain("edital-generate-reason");
  });

  it("acessibilidade e responsividade: botão nativo com aria-expanded/aria-controls; layout em coluna e CTAs full-width no mobile; sem tabela", () => {
    const out = html(pilotLike());
    expect(out).toMatch(/<button[^>]*type="button"[^>]*aria-expanded="false"[^>]*aria-controls="edital-decisoes"/);
    expect(out).toContain('role="region"');
    expect(out).toContain("grid-cols-1");
    expect(out).toContain("w-full");
    expect(out).toContain("sm:w-auto");
    expect(out).not.toContain("<table");
    expect(out).toContain('aria-label="Prontidão da preparação"');
    // o recolhimento NÃO esconde o bloqueio principal de leitores de tela: o TR/erro críticos ficam fora do conteúdo recolhido
    const hiddenRegion = /<div id="edital-decisoes"[^>]*>([\s\S]*?)<\/div><\/div>/.exec(out)?.[0] ?? "";
    expect(hiddenRegion).not.toContain(TR_OFFICIAL_EXACT_MESSAGE);
  });

  it("ordem de leitura da superfície: prontidão → configuração/origem → decisões → dados reaproveitados → detalhes técnicos", () => {
    const out = html(pilotLike());
    const at = (s: string) => out.indexOf(s);
    expect(at("Prontidão da preparação")).toBeLessThan(at("Complete a configuração única do órgão"));
    expect(at("Complete a configuração única do órgão")).toBeLessThan(at("Dados a resolver na origem"));
    expect(at("Dados a resolver na origem")).toBeLessThan(at("Decisões deste certame — "));
    expect(at("Decisões deste certame — ")).toBeLessThan(at("Ver dados reaproveitados"));
    expect(at("Ver dados reaproveitados")).toBeLessThan(at("Ver detalhes técnicos"));
  });
});
