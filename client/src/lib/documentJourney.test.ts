/**
 * LICIGOV-FAST PR-1 — jornada documental (regra pura): estado real, próximo documento, exportação individual
 * pelo contrato canônico e proteção de edição não salva.
 */
import { describe, it, expect, vi } from "vitest";
import {
  canLeaveStage, deliverExport, exportDoneMessage, exportPlaceholderText, exportRequestFor, journeyDocState, journeyStates,
  nextActionLabel, nextJourneyKind, unsavedLeaveMessage,
} from "./documentJourney";

describe("estado real de cada documento", () => {
  it("documento inexistente ⇒ 'Não iniciado', sem exportação (nunca concluído)", () => {
    expect(journeyDocState("dfd", [], {}, {})).toEqual({ kind: "dfd", phase: "absent", label: "Não iniciado", exportable: false });
    expect(journeyDocState("etp", null)).toMatchObject({ phase: "absent", exportable: false });
  });

  it("rascunho ⇒ minuta exportável; status 'aprovado'/'emitido' do rascunho continua minuta (não oficial)", () => {
    expect(journeyDocState("dfd", [{ kind: "dfd", status: "rascunho" }])).toEqual({ kind: "dfd", phase: "draft", label: "Minuta (rascunho)", exportable: true });
    expect(journeyDocState("tr", [{ kind: "tr", status: "em_revisao" }])).toMatchObject({ phase: "review", label: "Minuta em revisão" });
    expect(journeyDocState("etp", [{ kind: "etp", status: "aprovado" }])).toMatchObject({ phase: "draft", label: "Minuta revisada" });
    const emittedDraft = journeyDocState("edital", [{ kind: "edital", status: "emitido" }]);
    expect(emittedDraft.phase).toBe("draft");
    expect(emittedDraft.label).not.toMatch(/oficial|emitido/i);
  });

  it("emitido só pelo ledger de emissões (rótulo do ledger)", () => {
    expect(journeyDocState("tr", [{ kind: "tr", status: "rascunho" }], { tr: 2 }, { tr: 1 })).toEqual({ kind: "tr", phase: "official", label: "Emitido · 1ª emissão", exportable: true });
  });

  it("ingresso direto em etapa posterior: só o que existe aparece, sem completar etapas anteriores", () => {
    const states = journeyStates([{ kind: "tr", status: "rascunho" }]);
    expect(states.map((s) => [s.kind, s.phase])).toEqual([["dfd", "absent"], ["etp", "absent"], ["tr", "draft"], ["edital", "absent"]]);
  });
});

describe("próximo documento", () => {
  it("DFD → ETP → TR → Edital; Edital não tem próximo", () => {
    expect(nextJourneyKind("dfd")).toBe("etp");
    expect(nextJourneyKind("etp")).toBe("tr");
    expect(nextJourneyKind("tr")).toBe("edital");
    expect(nextJourneyKind("edital")).toBeNull();
  });

  it("rótulo mostra o estado real do próximo, sem bloquear", () => {
    expect(nextActionLabel(journeyDocState("etp", []))).toBe("Ir para ETP (não iniciado)");
    expect(nextActionLabel(journeyDocState("tr", [{ kind: "tr", status: "rascunho" }]))).toBe("Ir para TR");
  });
});

describe("exportação individual (contrato canônico)", () => {
  it("DOCX/PDF baixam (attachment); Visualizar/Imprimir abrem o PDF inline numa aba", () => {
    expect(exportRequestFor("docx")).toEqual({ format: "docx", disposition: "attachment", opensTab: false });
    expect(exportRequestFor("pdf")).toEqual({ format: "pdf", disposition: "attachment", opensTab: false });
    expect(exportRequestFor("view")).toEqual({ format: "pdf", disposition: "inline", opensTab: true });
    expect(exportRequestFor("print")).toEqual({ format: "pdf", disposition: "inline", opensTab: true });
  });

  it("download não abre aba; inline usa a aba pré-aberta", () => {
    const deps = { openTab: vi.fn(), download: vi.fn() };
    expect(deliverExport({ url: "u1", fileName: "f.docx" }, exportRequestFor("docx"), null, deps)).toBe("delivered");
    expect(deps.download).toHaveBeenCalledWith("u1", "f.docx");
    expect(deps.openTab).not.toHaveBeenCalled();

    const tab = { location: { href: "about:blank" }, closed: false };
    expect(deliverExport({ url: "u2", fileName: "f.pdf" }, exportRequestFor("print"), tab, deps)).toBe("delivered");
    expect(tab.location.href).toBe("u2");
    expect(deps.openTab).not.toHaveBeenCalled();
  });

  it("aba bloqueada pelo navegador ⇒ 'blocked' (não simula sucesso)", () => {
    const deps = { openTab: vi.fn().mockReturnValue(null), download: vi.fn() };
    expect(deliverExport({ url: "u", fileName: "f.pdf" }, exportRequestFor("view"), null, deps)).toBe("blocked");
    const opened = { openTab: vi.fn().mockReturnValue({ location: { href: "" } }), download: vi.fn() };
    expect(deliverExport({ url: "u", fileName: "f.pdf" }, exportRequestFor("view"), { location: { href: "" }, closed: true }, opened)).toBe("delivered");
    expect(opened.openTab).toHaveBeenCalledWith("u");
  });

  it("textos dizem exatamente o que é aberto e que só o documento escolhido é impresso", () => {
    expect(exportPlaceholderText("etp", "print")).toMatch(/PDF de ETP — Estudo Técnico Preliminar para impressão.*só este documento/);
    expect(exportDoneMessage("tr", "print")).toMatch(/PDF do TR aberto em nova aba.*só este documento/);
    expect(exportDoneMessage("dfd", "docx")).toBe("Download do DOCX do DFD iniciado.");
  });
});

describe("edição não salva", () => {
  it("sem edição pendente navega sem perguntar", () => {
    const confirm = vi.fn();
    expect(canLeaveStage(null, confirm)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("com edição pendente só sai se o servidor confirmar (cancelar = permanecer)", () => {
    expect(canLeaveStage("etp", () => false)).toBe(false);
    const confirm = vi.fn().mockReturnValue(true);
    expect(canLeaveStage("etp", confirm)).toBe(true);
    expect(confirm).toHaveBeenCalledWith(unsavedLeaveMessage("etp"));
    expect(unsavedLeaveMessage("etp")).toMatch(/alterações não salvas no ETP/);
  });
});
