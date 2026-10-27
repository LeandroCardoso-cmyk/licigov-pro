/**
 * M8 (homologação visual) — regressões dos achados P2/P3 confirmados no navegador real:
 *  - Visão Geral: TR emitido (v2) coexistindo com rascunho; etapa registrada ≠ situação documental; autoria por nome;
 *  - Edital: reabertura com o TR exato da composição; mensagem "selecione" × "emita"; pendências técnicas traduzidas;
 *  - Histórico de importações e proveniência da cotação; rótulos legíveis; datas pt-BR.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";

const st = vi.hoisted(() => ({ load: null as unknown, scope: null as unknown }));
vi.mock("@/lib/trpc", () => ({ trpc: { procurementProcess: {
  loadProcess: { useQuery: () => ({ data: st.load, isLoading: false }) },
  editalScopeSelection: { useQuery: () => ({ data: st.scope, isLoading: false }) },
  exportDocument: { useMutation: () => ({ mutate: () => {}, isPending: false, variables: undefined }) },
} } }));
vi.mock("../../lib/trpc", () => ({ trpc: { procurementProcess: {
  loadProcess: { useQuery: () => ({ data: st.load, isLoading: false }) },
  editalScopeSelection: { useQuery: () => ({ data: st.scope, isLoading: false }) },
  exportDocument: { useMutation: () => ({ mutate: () => {}, isPending: false, variables: undefined }) },
} } }));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));
(globalThis as { React?: typeof React }).React = React;

import ProcessOverview from "./ProcessOverview";
import { IngestionSessionHistoryList } from "./IngestionSessionHistory";
import {
  actorLabel, draftStatusLabel, formatDateTimeBR, latestOfficialSummary, modalityLabel, officialVersionLabel, stageLabel,
  overviewModalityText,
} from "@/lib/processDocumentStatus";
import { formatBytes, provenanceLabel, riskTypeLabel, sessionByResearchId, sessionStatusLabel, severityLabel, type SessionHistoryView } from "@/lib/ingestionHistoryView";
import { bridgeAllowsGeneration, composedTrCandidateId, TR_REQUIRED_MESSAGE, TR_SELECT_MESSAGE, type TrCandidateView } from "@/lib/editalTemplateBridge";
import { revalidationIssueMessage, reviewReadiness, variableOriginLabel, type ReviewStateView } from "@/lib/editalPreparation";

const read = (rel: string) => readFileSync(path.resolve(rel), "utf8");

describe("situação documental (pura)", () => {
  it("rótulos legíveis e nada inventado para valor desconhecido", () => {
    expect(stageLabel("PRICE_RESEARCH")).toBe("Pesquisa de Preços");
    expect(stageLabel("X_NOVO")).toBe("X_NOVO");
    expect(modalityLabel("pregao")).toBe("Pregão");
    expect(modalityLabel(null)).toBe("—");
    expect(draftStatusLabel("rascunho")).toBe("Rascunho");
  });
  it("versão oficial por tipo e documento oficial mais avançado do fluxo", () => {
    expect(officialVersionLabel({ tr: 2 }, "tr")).toBe("Emitido v2");
    expect(officialVersionLabel({ tr: 2 }, "etp")).toBeNull();
    expect(latestOfficialSummary({ etp: 1, tr: 2 })).toBe("TR emitido (v2)");
    expect(latestOfficialSummary({ edital: 1, tr: 3 })).toBe("Edital emitido (v1)");
    expect(latestOfficialSummary({})).toBeNull();
  });
  it("data pt-BR (nunca ISO cru) e autoria pelo nome, com id quando não há nome", () => {
    expect(formatDateTimeBR("2026-10-23T20:48:03.891Z")).not.toContain("T20:48");
    expect(formatDateTimeBR("2026-10-23T20:48:03.891Z")).toMatch(/23\/10\/2026/);
    expect(actorLabel("Gestor Sintético", "4")).toBe("Gestor Sintético");
    expect(actorLabel(null, "5")).toBe("Usuário nº 5");
    expect(actorLabel(null, "user:5")).toBe("Usuário nº 5");
    expect(actorLabel(null, "sistema")).toBe("Sistema");
  });
});

describe("Visão Geral — modalidade (M8)", () => {
  it("processo sem modalidade mas com escopo do Edital escolhido ⇒ mostra a modalidade indicando a origem", () => {
    expect(overviewModalityText(null, "pregao")).toBe("Pregão (escopo do Edital)");
    expect(overviewModalityText("concorrencia", "pregao")).toBe("Concorrência");
    expect(overviewModalityText(null, null)).toBe("—");
  });
});

describe("Visão Geral — TR emitido coexistindo com rascunho", () => {
  beforeEach(() => {
    st.load = {
      process: { processNumber: "1419/2026", object: "Objeto", status: "rascunho", currentStage: "PRICE_RESEARCH", modality: "pregao", activeCopilots: [1, 2] },
      items: [],
      documents: [
        { id: "d1", kind: "tr", title: "TR — Objeto", status: "rascunho" },
        { id: "d2", kind: "edital", title: "Edital — Objeto", status: "rascunho" },
      ],
      timeline: [{ id: "e1", order: 1, eventType: "change", actor: "5", actorName: "Autora Sintética", summary: "Documento TR exportado (PDF).", createdAt: "2026-10-23T20:48:18.000Z" }],
      officialVersions: { tr: 2 },
    };
  });
  it("mostra 'Emitido v2' no TR e o documento oficial mais avançado, separado da etapa registrada", () => {
    const html = renderToStaticMarkup(createElement(ProcessOverview, { processId: "p1" }));
    expect(html).toContain("TR emitido (v2)");
    expect(html).toContain("Emitido v2");
    expect(html).toContain("Etapa registrada: Pesquisa de Preços");
    // M8 pós-homologação — situação do rascunho em linguagem natural (antes "Rascunho: rascunho").
    expect(html).toContain("Rascunho em elaboração");
    expect(html).not.toContain("Rascunho: rascunho");
    expect(html).toContain("Modalidade: Pregão");
    expect(html).not.toContain("Copilotos");
    // Edital sem versão emitida não recebe o selo oficial.
    expect(html.match(/Emitido v2/g)?.length).toBe(1);
  });
  it("eventos com nome do autor e data legível", () => {
    const html = renderToStaticMarkup(createElement(ProcessOverview, { processId: "p1" }));
    expect(html).toContain("Autora Sintética · ");
    expect(html).not.toContain("5 · 23/10");
  });
});

describe("Edital — reabertura com o contexto da composição", () => {
  const cand = (o: Partial<TrCandidateView>): TrCandidateView => ({ documentId: "TR-DOC", title: "TR", version: 2, contentHash: "c".repeat(64), status: "emitido", createdAt: "x", current: true, ...o } as TrCandidateView);
  const pin = { documentId: "TR-DOC", version: 2, contentHash: "c".repeat(64) };
  it("seleciona o TR exato da composição só se ainda for o vigente (documento + versão + hash)", () => {
    expect(composedTrCandidateId([cand({})], pin)).toBe("TR-DOC");
    expect(composedTrCandidateId([cand({ version: 3, contentHash: "d".repeat(64) })], pin)).toBeNull();
    expect(composedTrCandidateId([cand({ current: false })], pin)).toBeNull();
    expect(composedTrCandidateId([cand({})], null)).toBeNull();
  });
  it("com TR oficial vigente listado, a orientação é SELECIONAR (não 'emita')", () => {
    const bound = { status: "BOUND" } as Parameters<typeof bridgeAllowsGeneration>[0];
    expect(bridgeAllowsGeneration(bound, null, true).reason).toBe(TR_SELECT_MESSAGE);
    expect(bridgeAllowsGeneration(bound, null, false).reason).toBe(TR_REQUIRED_MESSAGE);
  });
  it("workspace: hidrata do contexto composto sem gravar; lista legada de pendências oculta na minuta institucional", () => {
    const src = read("client/src/components/procurement/EditalWorkspace.tsx");
    // Ordem de hidratação: persistido > contexto composto > escopo registrado antes da 1ª geração (rodada consolidada C2).
    expect(src).toContain("resolveEditalFormValues<Modality, Form, Platform>(proposed, persisted ?? composedParams ?? recordedScope)");
    expect(src).toContain('sourceState.data.state !== "template_governed"');
    expect(src).toContain("selectedTrId ?? composedTrId");
  });
});

describe("Revisão do modelo — pendências em linguagem operacional, códigos preservados", () => {
  const rs = (issues: { code: string; path: string; message: string }[]): ReviewStateView => ({
    composedByTemplate: true, generationManifestId: "m", templateRevisionId: "r", unresolvedMarkers: { count: 0, slots: [], samples: [] },
    structuralDeviations: [], aiNarratives: [], revalidation: { status: "BLOCKED", issues },
  } as ReviewStateView);
  it("SOURCE_CHANGED/MISSING_REQUIRED sem 'requiredWhen', 'fontes canônicas' nem nome de variável", () => {
    const r = reviewReadiness(rs([
      { code: "SOURCE_CHANGED", path: "recomposition", message: "as fontes canônicas atuais não recompõem o documento" },
      { code: "MISSING_REQUIRED", path: "vars.BUDGET.valorEstimado", message: "valor canônico obrigatório nesta configuração (requiredWhen) ausente (BUDGET.valorEstimado)" },
    ]));
    const text = r.blockers.join(" ");
    expect(text).not.toMatch(/requiredWhen|canônic|BUDGET\./);
    expect(text).toContain("valor estimado da contratação");
    expect(text).toContain("Pesquisa de Preços");
    expect(r.technical).toEqual([
      "SOURCE_CHANGED · recomposition — as fontes canônicas atuais não recompõem o documento",
      "MISSING_REQUIRED · vars.BUDGET.valorEstimado — valor canônico obrigatório nesta configuração (requiredWhen) ausente (BUDGET.valorEstimado)",
    ]);
  });
  it("variável sem rótulo cai no namespace; código desconhecido não vaza a mensagem técnica", () => {
    expect(variableOriginLabel("vars.ITEMS.quantidade")).toContain("Itens da contratação");
    expect(variableOriginLabel("vars.ZZZ.x")).toBe("dado do processo");
    expect(revalidationIssueMessage({ code: "NOVO", path: "p", message: "detalhe interno" })).not.toContain("detalhe interno");
  });
});

describe("Histórico de importações e proveniência da cotação", () => {
  const s = (o: Partial<SessionHistoryView>): SessionHistoryView => ({
    id: 1, importType: "price_research", status: "approved", sourceFileName: "homolog-a.csv", sourceSize: 2048, checksumPrefix: "abc123def456",
    createdAt: "2026-10-23T20:46:40.000Z", finishedAt: null, uploadedBy: { userId: 5, name: "Autora Sintética" },
    approval: { userId: 5, name: "Autora Sintética", at: "2026-10-23T20:46:45.000Z" },
    promotion: { userId: 4, name: "Gestor Sintético", at: "2026-10-23T20:46:50.000Z", researchId: "R1", status: "promoted" }, ...o,
  });
  it("lista o registrado (envio, aprovação, promoção) e explicita o que não foi registrado", () => {
    const html = renderToStaticMarkup(createElement(IngestionSessionHistoryList, { sessions: [s({}), s({ id: 2, status: "rejected", approval: null, promotion: null, sourceFileName: "b.csv" })] }));
    expect(html).toContain("Importação nº 1 · homolog-a.csv");
    expect(html).toContain("por Autora Sintética");
    expect(html).toContain("por Gestor Sintético");
    expect(html).toContain("Pesquisa gerada: ");
    expect(html).toContain("não registrada");
    expect(html).toContain("não promovida");
    expect(html).toContain("Rejeitada");
    expect(html).toContain("2,0 KB");
  });
  it("cotação → importação de origem pela pesquisa gerada; rótulos de proveniência e risco", () => {
    const map = sessionByResearchId([s({}), s({ id: 2, promotion: null })]);
    expect(map.get("R1")?.id).toBe(1);
    expect(map.size).toBe(1);
    expect(provenanceLabel("ficticia")).toEqual({ label: "Fictícia (não oficial)", tone: "warn" });
    expect(provenanceLabel(undefined).label).toBe("Proveniência não classificada");
    expect(riskTypeLabel("fonte_ficticia")).toBe("Fonte fictícia");
    expect(severityLabel("medio")).toBe("Média");
    expect(sessionStatusLabel("awaiting_review")).toBe("Aguardando revisão");
    expect(formatBytes(0)).toBe("—");
  });
});

describe("Responsividade e contexto organizacional (estrutura)", () => {
  it("breadcrumb não sobrepõe (wrap/truncate; 1º nível oculto < sm); voltar vira ícone com rótulo acessível", () => {
    const src = read("client/src/pages/ProcessoLicitatorio.tsx");
    expect(src).toContain("flex min-w-0 flex-wrap items-center");
    expect(src).toContain('hidden sm:flex');
    expect(src).toContain('aria-label="Voltar aos processos"');
    expect(src).toContain('<span className="hidden sm:inline">Voltar aos processos</span>');
  });
  it("menu lateral recolhido em tablet; órgão ativo visível no rodapé do menu", () => {
    const src = read("client/src/components/DashboardLayout.tsx");
    expect(src).toContain('defaultOpen={typeof window === "undefined" || window.innerWidth >= 1024}');
    expect(src).toContain("Órgão ativo: ");
  });
});
