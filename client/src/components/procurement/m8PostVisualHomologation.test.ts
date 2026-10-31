/**
 * M8 — correções pós-homologação visual (processo sintético 1419/2026, org 2): regressões dos achados no navegador real.
 *  - ESC com diálogo/drawer aberto fechava a superfície E navegava (`history.back()` ⇒ /dashboard);
 *  - `ingestion.getActiveSession` disparado sem a capability canônica (403 no console das abas TR/DFD);
 *  - "fontes mudaram… decida se deve gerar uma nova versão" ao lado de "não pode ser gerado novamente";
 *  - "Valor estimado global PARCIAL … R$ 0,00" sem nenhum preço de referência válido; 4 cotações fictícias contadas como base;
 *  - status técnico ("rascunho", "Rascunho: rascunho");
 *  - "Objeto completo" cobrado de novo, embora o objeto do processo já o supra (Edital usa o do TR oficial).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { shouldNavigateOnEscape, ESCAPE_OWNER_SELECTOR, type EscapeNavigationInput } from "@/hooks/useKeyboardNavigation";
import { shouldQueryActiveSession } from "@/lib/ingestion/capabilities";
import {
  estimateRowView, quoteRowView, sourceChangedNoticeText, ESTIMATE_NO_QUANTITY_TEXT, ESTIMATE_UNAVAILABLE_TEXT, type SourcesPriceSummary,
} from "./authoringSourcesView";
import { draftSituationLabel, draftStatusLabel, processStatusLabel } from "@/lib/processDocumentStatus";
import { suppliedByText, trPendingFields, trSuppliedFields, type TrParamViewModel } from "@/lib/contextReuse";

const read = (rel: string) => readFileSync(path.resolve(rel), "utf8");

describe("ESC: só navega quando nada mais o reivindica", () => {
  const base: EscapeNavigationInput = { key: "Escape", defaultPrevented: false, hasOpenEscapeOwner: false, targetTagName: "BODY" };
  it("sem diálogo, fora de campo: mantém o atalho Voltar", () => {
    expect(shouldNavigateOnEscape(base)).toBe(true);
  });
  it("diálogo/drawer aberto (Radix, painel do item, revisão inline): não navega", () => {
    expect(shouldNavigateOnEscape({ ...base, hasOpenEscapeOwner: true })).toBe(false);
  });
  it("evento já tratado (Radix chama preventDefault ao fechar): não navega", () => {
    expect(shouldNavigateOnEscape({ ...base, defaultPrevented: true })).toBe(false);
  });
  it("campos de edição e composição IME: o ESC é do campo", () => {
    for (const tag of ["INPUT", "TEXTAREA", "SELECT", "input"]) expect(shouldNavigateOnEscape({ ...base, targetTagName: tag })).toBe(false);
    expect(shouldNavigateOnEscape({ ...base, targetIsContentEditable: true })).toBe(false);
    expect(shouldNavigateOnEscape({ ...base, isComposing: true })).toBe(false);
  });
  it("outras teclas nunca navegam por esta regra", () => {
    expect(shouldNavigateOnEscape({ ...base, key: "Enter" })).toBe(false);
  });
  it("o seletor cobre o painel do item e os diálogos Radix; o hook consulta a regra ANTES de history.back()", () => {
    expect(ESCAPE_OWNER_SELECTOR).toContain('[role="dialog"]');
    expect(ESCAPE_OWNER_SELECTOR).toContain('[aria-modal="true"]');
    const drawer = read("client/src/pages/ProcessoLicitatorio.tsx");
    expect(drawer).toMatch(/role="dialog"\s+aria-modal="true"/);
    const hook = read("client/src/hooks/useKeyboardNavigation.ts");
    const guard = hook.indexOf("shouldNavigateOnEscape({");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(hook.indexOf("window.history.back()"));
  });
});

describe("ingestão: sem capability canônica, a retomada não é consultada (sem 403 previsível)", () => {
  it("regra pura", () => {
    expect(shouldQueryActiveSession({ ingestionEnabled: false, procurementProcessId: "p1", sessionId: null })).toBe(false);
    expect(shouldQueryActiveSession({ ingestionEnabled: true, procurementProcessId: "p1", sessionId: null })).toBe(true);
    expect(shouldQueryActiveSession({ ingestionEnabled: true, procurementProcessId: "", sessionId: null })).toBe(false);
    expect(shouldQueryActiveSession({ ingestionEnabled: true, procurementProcessId: "p1", sessionId: 7 })).toBe(false);
  });
  it("o hook usa a capability canônica (mesma query de useIngestionCapabilities), sem nova fonte de verdade", () => {
    const hook = read("client/src/hooks/ingestion/useSupervisedIngestion.ts");
    expect(hook).toMatch(/useIngestionCapabilities\(\)/);
    expect(hook).toMatch(/getActiveSession\.useQuery\([\s\S]*?enabled: shouldQueryActiveSession\(\{ ingestionEnabled,/);
    expect(hook).not.toMatch(/getCapabilities\.useQuery/);
  });
  it("troca de sessão/tenant não reaproveita cache (capabilities, processos) do tenant anterior", () => {
    const login = read("client/src/pages/Login.tsx");
    expect(login.indexOf("queryClient.removeQueries()")).toBeGreaterThan(-1);
    expect(login.indexOf("queryClient.removeQueries()")).toBeLessThan(login.indexOf("navigate(destination)"));
    const admin = read("client/src/pages/AdminOrganizacoes.tsx");
    const at = admin.indexOf("localStorage.setItem(SELECTED_ORGANIZATION_ID_STORAGE_KEY");
    expect(admin.indexOf("queryClient.removeQueries()", at)).toBeGreaterThan(at);
    expect(admin.indexOf("queryClient.removeQueries()", at)).toBeLessThan(admin.indexOf('navigate("/usuarios")', at));
  });
});

describe("TR emitido: 'fontes mudaram' não contradiz o bloqueio de regeneração", () => {
  it("sem bloqueio: mantém a orientação de decidir sobre nova geração", () => {
    expect(sourceChangedNoticeText("tr", null)).toContain("decida se deve gerar uma nova versão");
  });
  it("emitido: diz que a versão oficial continua válida e que não há regeneração direta", () => {
    const t = sourceChangedNoticeText("tr", { reason: "official_emitted", officialVersion: 2, emittedAt: null });
    expect(t).not.toMatch(/decida se deve gerar/);
    expect(t).toContain("v2");
    expect(t).toContain("continua válida");
    expect(t).toContain("não pode ser gerado novamente");
  });
  it("aprovado: idem, sem anunciar fluxo inexistente", () => {
    const t = sourceChangedNoticeText("etp", { reason: "approved", officialVersion: null, emittedAt: null });
    expect(t).toContain("ETP está aprovado");
    expect(t).not.toMatch(/decida se deve gerar/);
  });
  it("bloqueio ainda carregando: só o fato, sem orientar a regenerar (nada pisca errado)", () => {
    expect(sourceChangedNoticeText("tr", "loading")).toBe("As fontes do processo mudaram desde a última geração deste TR.");
  });
  it("a tela usa o bloqueio canônico do servidor (reviewableDraft) nos dois workspaces", () => {
    for (const f of ["TRWorkspace", "ETPWorkspace"]) {
      expect(read(`client/src/components/procurement/${f}.tsx`)).toMatch(/<AuthoringSourcesSummary [^>]*regenerationBlock=\{reviewable\.isLoading \? "loading" : regenerationBlock\}/);
    }
    expect(read("client/src/components/procurement/AuthoringSourcesSummary.tsx")).not.toContain("decida se deve gerar");
  });
});

describe("valor estimado: ausência nunca vira R$ 0,00; fictícia não é base", () => {
  const s = (o: Partial<SourcesPriceSummary>): SourcesPriceSummary => ({
    approvedItems: 2, quoteCount: 4, pricedItems: 0, unpricedItems: 2, estimatedGlobalTotalCents: 0,
    fictitiousQuoteCount: 4, priceSuspendedItems: 2, fictitiousPriceItems: 2, unknownQuantityItems: 0, ...o,
  });
  it("caso 1419/2026: 2 itens suspensos por fictícia ⇒ indisponível, com o motivo", () => {
    const v = estimateRowView(s({}));
    expect(v.ok).toBe(false);
    expect(v.label).toBe(ESTIMATE_UNAVAILABLE_TEXT);
    expect(v.label).not.toMatch(/R\$|PARCIAL/);
    expect(v.detail).toContain("2 com preço suspenso por cotação fictícia");
  });
  it("cotações: as 4 fictícias não aparecem como 'Baseado em'", () => {
    const q = quoteRowView(s({}));
    expect(q.ok).toBe(false);
    expect(q.label).not.toMatch(/^Baseado em/);
    expect(q.label).toContain("4 cotação(ões) fictícia(s)");
  });
  it("parcial legítimo: total dos itens com preço, rótulo PARCIAL dos documentos", () => {
    const v = estimateRowView(s({ pricedItems: 1, unpricedItems: 1, estimatedGlobalTotalCents: 2000, priceSuspendedItems: 1, fictitiousPriceItems: 1, fictitiousQuoteCount: 1, quoteCount: 3 }));
    expect(v.label).toMatch(/^Valor estimado global PARCIAL \(1 de 2/);
    expect(v.label).toMatch(/R\$\s?20,00$/);
    expect(quoteRowView(s({ fictitiousQuoteCount: 1, quoteCount: 3, pricedItems: 1, unpricedItems: 1 }))).toMatchObject({ ok: true });
  });
  it("tudo com preço: rótulo e valor de sempre; sem fictícia, texto de cotações inalterado", () => {
    const v = estimateRowView(s({ pricedItems: 2, unpricedItems: 0, estimatedGlobalTotalCents: 376000, priceSuspendedItems: 0, fictitiousPriceItems: 0, fictitiousQuoteCount: 0 }));
    expect(v).toMatchObject({ ok: true });
    expect(v.label).toMatch(/^Valor estimado global \(calculado pelo sistema\): R\$\s?3\.760,00$/);
    expect(quoteRowView(s({ fictitiousQuoteCount: 0 })).label).toBe("Baseado em 4 cotação(ões) importada(s) com preço");
  });
  it("itens com preço mas sem quantidade: total 0 é ausência de base, não valor", () => {
    const v = estimateRowView(s({ pricedItems: 2, unpricedItems: 0, estimatedGlobalTotalCents: 0, priceSuspendedItems: 0, fictitiousPriceItems: 0, unknownQuantityItems: 2 }));
    expect(v.label).toBe(ESTIMATE_NO_QUANTITY_TEXT);
    expect(v.detail).toContain("2 item(ns) sem quantidade informada");
  });
  it("auditoria: item com fictícia E reais fica todo suspenso ⇒ a linha de cotações não marca sucesso", () => {
    const q = quoteRowView(s({ quoteCount: 3, fictitiousQuoteCount: 1, pricedItems: 0, unpricedItems: 1, approvedItems: 1 }));
    expect(q.ok).toBe(false);
    expect(q.label).toContain("2 importada(s) com preço");
  });
  it("auditoria: homologação sintética autorizada ⇒ total com ressalva de valor demonstrativo, sem sucesso", () => {
    const st = s({ pricedItems: 2, unpricedItems: 0, estimatedGlobalTotalCents: 376000, priceSuspendedItems: 0, fictitiousPriceItems: 0, demonstrativePriceItems: 2 });
    const v = estimateRowView(st);
    expect(v.ok).toBe(false);
    expect(v.detail).toContain("valor demonstrativo de 2 item(ns)");
    expect(quoteRowView(st).ok).toBe(false);
  });
  it("auditoria: item com preço e sem quantidade ⇒ total rotulado PARCIAL, nunca global", () => {
    const v = estimateRowView(s({ pricedItems: 2, unpricedItems: 0, estimatedGlobalTotalCents: 2000, priceSuspendedItems: 0, fictitiousPriceItems: 0, fictitiousQuoteCount: 0, unknownQuantityItems: 1 }));
    expect(v.ok).toBe(false);
    expect(v.label).toMatch(/^Valor estimado global PARCIAL \(1 de 2 item\(ns\) sem quantidade informada/);
  });
  it("resposta antiga (sem os campos novos) continua legível", () => {
    const v = estimateRowView({ approvedItems: 1, quoteCount: 2, pricedItems: 1, unpricedItems: 0, estimatedGlobalTotalCents: 500 });
    expect(v.ok).toBe(true);
  });
});

describe("status em linguagem natural", () => {
  it("rascunho do documento sem repetição; desconhecido aparece como está", () => {
    expect(draftSituationLabel("rascunho")).toBe("Rascunho em elaboração");
    expect(draftSituationLabel("em_revisao")).toBe("Rascunho em revisão");
    expect(draftSituationLabel("x_novo")).toBe("Rascunho: x_novo");
    expect(draftStatusLabel("rascunho")).toBe("Rascunho");
  });
  it("status do processo: mesma tabela na lista e na Visão Geral (sem valor cru)", () => {
    expect(processStatusLabel("rascunho")).toBe("Rascunho");
    expect(processStatusLabel("em_andamento")).toBe("Em andamento");
    const overview = read("client/src/components/procurement/ProcessOverview.tsx");
    expect(overview).not.toMatch(/\{process\.status\}/);
    expect(overview).not.toMatch(/Rascunho: \{/);
    expect(read("client/src/components/procurement/ProcessoLicitatorioHome.tsx")).toContain("processStatusLabel(p.status)");
  });
});

describe("'Objeto completo' é suprido pela fonte autoritativa (uma informação, um preenchimento)", () => {
  const f = (o: Partial<TrParamViewModel>): TrParamViewModel => ({
    name: "x", path: "x", type: "text", description: "X", required: true, conditional: false, requiredWhenVariables: [],
    active: true, status: "UNSET", defaultEligible: false, ...o,
  });
  const prazo = f({ name: "contratacao.prazoEntrega", description: "Prazo" });
  it("suprido pelo servidor: não é pendência; aparece como obtido; nada é confirmado", () => {
    const objeto = f({ name: "processo.objetoCompleto", suppliedBy: { source: "tr_oficial", value: "Aquisição", version: 2 } });
    expect(trPendingFields([objeto, prazo]).map((x) => x.name)).toEqual(["contratacao.prazoEntrega"]);
    expect(trSuppliedFields([objeto, prazo]).map((x) => x.name)).toEqual(["processo.objetoCompleto"]);
    expect(suppliedByText({ source: "tr_oficial", value: "Aquisição", version: 2 })).toContain("TR oficial emitido (v2)");
    expect(suppliedByText({ source: "processo", value: "Aquisição" })).toContain("a emissão do TR registra este objeto");
  });
  it("auditoria: sem `suppliedBy` (ex.: TR emitido antes do registro do objeto) continua pendente e editável no TR", () => {
    const objeto = f({ name: "processo.objetoCompleto" });
    expect(trPendingFields([objeto]).map((x) => x.name)).toEqual(["processo.objetoCompleto"]);
    expect(trSuppliedFields([objeto])).toEqual([]);
  });
  it("valor já confirmado no TR prevalece como confirmado", () => {
    const set = f({ name: "processo.objetoCompleto", status: "SET", value: "Texto", suppliedBy: { source: "processo", value: "A" } });
    expect(trSuppliedFields([set])).toEqual([]);
  });
  it("a seção usa só o que o servidor indica (sem segunda fonte de verdade no cliente) e não grava nada para suprir", () => {
    const section = read("client/src/components/procurement/TrStructuredParamsSection.tsx");
    expect(section).toContain("trSuppliedFields(live)");
    expect(section).not.toContain("processObject");
    expect(read("client/src/lib/contextReuse.ts")).not.toContain('"processo.objetoCompleto"');
  });
});
