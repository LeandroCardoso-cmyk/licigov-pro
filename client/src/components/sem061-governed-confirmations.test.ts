/**
 * SEM-061 — confirmações com o estado atual à vista:
 *   a) "Substituir rascunho": o rascunho ATUAL (origem, data, tamanho, prévia) é exibido ao lado do importado antes de confirmar;
 *   b) CATMAT "Confirmar": gateado pela decisão VIGENTE do ledger e pelo limiar configurado (nada de rótulo de heurística);
 *   c) limiar CATMAT: prévia do impacto org-wide + confirmação explícita; o 1º clique não grava.
 * Padrão do projeto: puro + render estático + varredura de fonte (sem DOM).
 */
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  currentDraftReplaceSummary, incomingDocumentSummary, canConfirmReplace, formatCharCount, type CurrentDraftSummary,
} from "../lib/ingestion/documentImport";
import DraftReplaceCompare from "./ingestion/DraftReplaceCompare";
import { confirmGate, currentDecisionText } from "./procurement/catmatConfirmGate";
import { thresholdImpactLines, canSubmitThresholdChange, type CatmatThresholdPreviewUI } from "./procurement/catmatThresholdPolicy";

(globalThis as unknown as { React: typeof React }).React = React;
const ROOT = path.resolve(import.meta.dirname, "../../..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const read = (rel: string) => strip(readFileSync(path.join(ROOT, rel), "utf8"));

const draft: CurrentDraftSummary = {
  exists: true, contentHash: "H", origin: "manual", title: "DFD", contentLength: 1234, preview: "1. Identificação\nObjeto: Mobiliário escolar",
  previewTruncated: true, updatedAt: "2026-10-01T15:00:00.000Z", lastEdit: { operation: "dfd_manual_edit", actorUserId: 3, at: "2026-10-01T15:00:00.000Z" },
};

describe("a) Substituir rascunho mostra o conteúdo ATUAL", () => {
  it("resumo do atual: origem, última alteração (com a operação), tamanho e prévia", () => {
    const s = currentDraftReplaceSummary(draft, "DFD");
    expect(s.title).toBe("Rascunho atual do DFD (será substituído)");
    expect(s.facts[0]).toEqual({ label: "Origem", value: "editado manualmente" });
    expect(s.facts[1].label).toBe("Última alteração");
    expect(s.facts[1].value).toMatch(/^01\/10\/2026,? 12:00 — edição manual$/); // fuso fixo America/Sao_Paulo
    expect(s.facts[2]).toEqual({ label: "Tamanho", value: "1.234 caracteres" });
    expect(s.preview).toContain("Objeto: Mobiliário escolar");
    expect(s.truncated).toBe(true);
    expect(formatCharCount(null)).toBe("tamanho desconhecido");
  });

  it("a comparação renderiza atual × importado com prévia, e nunca fica vazia", () => {
    const html = renderToStaticMarkup(createElement(DraftReplaceCompare, {
      current: currentDraftReplaceSummary(draft, "DFD"),
      incoming: incomingDocumentSummary({ originalFileName: "dfd.docx", content: "Texto do importado", approvedAt: "2026-10-02T10:00:00.000Z" }, "DFD"),
    }));
    expect(html).toContain('data-testid="replace-current"');
    expect(html).toContain('data-testid="replace-incoming"');
    expect(html).toContain("Rascunho atual do DFD (será substituído)");
    expect(html).toContain("editado manualmente");
    expect(html).toContain("Objeto: Mobiliário escolar");
    expect(html).toContain("dfd.docx");
    expect(html).toContain("Texto do importado");
    expect(renderToStaticMarkup(createElement(DraftReplaceCompare, { current: currentDraftReplaceSummary({ ...draft, preview: "" }, "DFD"), incoming: incomingDocumentSummary({ originalFileName: "x", content: "", approvedAt: null }, "DFD") }))).toContain("(sem prévia disponível)");
  });

  it("a confirmação só habilita com o atual à vista (hash + prévia) e motivo; o painel usa a comparação", () => {
    expect(canConfirmReplace({ draft, reason: "Versão revisada pela Secretaria", pending: false })).toBe(true);
    expect(canConfirmReplace({ draft: { ...draft, preview: null }, reason: "Versão revisada", pending: false })).toBe(false);
    expect(canConfirmReplace({ draft: { ...draft, contentHash: null }, reason: "Versão revisada", pending: false })).toBe(false);
    expect(canConfirmReplace({ draft, reason: "abc", pending: false })).toBe(false);
    expect(canConfirmReplace({ draft, reason: "Versão revisada", pending: true })).toBe(false);
    const src = read("client/src/components/ingestion/DocumentImportPanel.tsx");
    expect(src).toMatch(/<DraftReplaceCompare current=\{currentDraftReplaceSummary\(draft, label\)\}/);
    expect(src).toMatch(/disabled=\{!canConfirmReplace\(/);
    // a comparação aparece ANTES do botão de confirmar
    expect(src.indexOf("<DraftReplaceCompare")).toBeLessThan(src.indexOf(": \"Confirmar substituição\"}"));
  });

  it("o servidor devolve o resumo do rascunho vigente (tamanho, data, prévia, última edição) junto do hash do CAS", () => {
    const svc = read("server/services/documentIntakeService.ts");
    expect(svc).toMatch(/contentLength: draftRow\.content\.length/);
    expect(svc).toMatch(/preview: draftRow\.content\.slice\(0, DRAFT_PREVIEW_CHARS\)/);
    expect(svc).toMatch(/getLatestDraftEdit\(params\.processId, params\.organizationId, params\.kind\)/);
  });
});

describe("b) CATMAT 'Confirmar' gateado pela decisão vigente do ledger", () => {
  const base = { candidateCode: "123456", currentLoaded: true, thresholdConfigured: true as boolean | undefined, pending: false };
  it("sem limiar ou carregando ⇒ desabilitado com motivo; pendente ⇒ desabilitado", () => {
    expect(confirmGate({ ...base, current: null, thresholdConfigured: false })).toMatchObject({ enabled: false, reason: expect.stringContaining("Limiar institucional não configurado") });
    expect(confirmGate({ ...base, current: null, thresholdConfigured: undefined })).toMatchObject({ enabled: false });
    expect(confirmGate({ ...base, current: null, currentLoaded: false })).toMatchObject({ enabled: false });
    expect(confirmGate({ ...base, current: null, pending: true }).enabled).toBe(false);
  });
  it("sem decisão vigente e limiar ok ⇒ habilitado; mesmo código já vigente ⇒ desabilitado; outra decisão vigente ⇒ habilitado avisando a substituição", () => {
    expect(confirmGate({ ...base, current: null })).toMatchObject({ enabled: true, label: "Confirmar" });
    expect(confirmGate({ ...base, current: { decision: "confirmado", catmatCode: "123456" } })).toMatchObject({ enabled: false, reason: "Este código já é a decisão vigente do item." });
    expect(confirmGate({ ...base, current: { decision: "substituido", catmatCode: "123456" } }).enabled).toBe(false);
    const other = confirmGate({ ...base, current: { decision: "substituido", catmatCode: "999999" } });
    expect(other).toMatchObject({ enabled: true, label: "Confirmar (substitui a decisão vigente)" });
    expect(other.note).toContain("999999");
    expect(confirmGate({ ...base, current: { decision: "rejeitado", catmatCode: null } }).enabled).toBe(true);
  });
  it("a decisão vigente (ledger) é exibida; o rótulo de heurística do candidato deixou de aparecer como 'decisão'", () => {
    expect(currentDecisionText(null, true)).toMatch(/nenhuma decisão registrada no ledger/);
    expect(currentDecisionText({ decision: "confirmado", catmatCode: "123456" }, true)).toBe("Decisão vigente (ledger): confirmado — 123456.");
    const src = read("client/src/components/procurement/ProcurementItemPanel.tsx");
    expect(src).toMatch(/getCATMATDecisions\.useQuery/);
    expect(src).toMatch(/getCATMATThreshold\.useQuery/);
    expect(src).toMatch(/disabled=\{!gate\.enabled\}/);
    expect(src).not.toMatch(/decisão: \{c\.decision\}/);
  });
});

describe("c) limiar CATMAT: impacto org-wide + confirmação explícita", () => {
  const preview: CatmatThresholdPreviewUI = {
    current: { minScore: 0.5, version: 2 }, proposedMinScore: 0.8,
    impact: { itemsWithCurrentDecision: 7, byDecision: { confirmado: 4, substituido: 2, rejeitado: 1, sem_correspondencia_segura: 0 }, currentDecisionsUnderOtherThreshold: 7, currentDecisionsWithoutRecordedThreshold: 1, totalLedgerEntries: 11 },
  };
  it("mostra vigente → proposto, alcance do órgão, contagem de decisões e o que NÃO muda", () => {
    const lines = thresholdImpactLines(preview).join("\n");
    expect(lines).toContain("Limiar vigente: 50% (v2) → proposto: 80%.");
    expect(lines).toContain("toda a organização");
    expect(lines).toContain("7 item(ns) (confirmado: 4, substituído: 2, rejeitado: 1, sem correspondência segura: 0)");
    expect(lines).toContain("1 sem limiar registrado");
    expect(lines).toContain("não são reavaliadas nem alteradas");
    expect(thresholdImpactLines({ ...preview, current: null })[0]).toBe("Nenhum limiar configurado → proposto: 80%.");
  });
  it("só envia depois da prévia do MESMO valor e da confirmação; o 1º clique apenas busca a prévia", () => {
    expect(canSubmitThresholdChange({ previewShownFor: 0.8, proposed: 0.8, confirmed: true, pending: false })).toBe(true);
    expect(canSubmitThresholdChange({ previewShownFor: null, proposed: 0.8, confirmed: true, pending: false })).toBe(false);
    expect(canSubmitThresholdChange({ previewShownFor: 0.5, proposed: 0.8, confirmed: true, pending: false })).toBe(false);
    expect(canSubmitThresholdChange({ previewShownFor: 0.8, proposed: 0.8, confirmed: false, pending: false })).toBe(false);
    const src = read("client/src/components/procurement/CatmatThresholdConfig.tsx");
    expect(src.match(/setThreshold\.mutate\(/g)).toHaveLength(1);
    const submit = src.slice(src.indexOf("const submit"), src.indexOf("const confirmChange"));
    expect(submit).not.toMatch(/\.mutate\(/);
    expect(submit).toMatch(/previewCATMATThresholdChange\.fetch/);
    const confirm = src.slice(src.indexOf("const confirmChange"), src.indexOf("return ("));
    expect(confirm).toMatch(/setThreshold\.mutate\(pending\.input\)/);
  });
});
