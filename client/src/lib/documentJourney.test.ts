/**
 * LICIGOV-FAST PR-1 — jornada documental (regra pura): estado real, próximo documento, exportação individual
 * pelo contrato canônico e proteção de edição não salva.
 */
import { describe, it, expect, vi } from "vitest";
import {
  canLeaveStage, deliverExport, exportDoneMessage, exportNote, exportPlaceholderText, exportRequestFor, journeyDocState, journeyStates,
  nextActionLabel, nextJourneyKind, runJourneyExport, unsavedLeaveMessage, type JourneyExportRunDeps,
} from "./documentJourney";

describe("estado real de cada documento", () => {
  it("documento inexistente ⇒ 'Não iniciado', sem exportação (nunca concluído)", () => {
    expect(journeyDocState("dfd", [], {}, {})).toEqual({ kind: "dfd", phase: "absent", label: "Não iniciado", exportable: false, draftStatus: null });
    expect(journeyDocState("etp", null)).toMatchObject({ phase: "absent", exportable: false });
  });

  it("rascunho ⇒ minuta exportável; status 'aprovado'/'emitido' do rascunho continua minuta (não oficial)", () => {
    expect(journeyDocState("dfd", [{ kind: "dfd", status: "rascunho" }])).toEqual({ kind: "dfd", phase: "draft", label: "Minuta (rascunho)", exportable: true, draftStatus: "rascunho" });
    expect(journeyDocState("tr", [{ kind: "tr", status: "em_revisao" }])).toMatchObject({ phase: "review", label: "Minuta em revisão" });
    expect(journeyDocState("etp", [{ kind: "etp", status: "aprovado" }])).toMatchObject({ phase: "draft", label: "Minuta revisada" });
    const emittedDraft = journeyDocState("edital", [{ kind: "edital", status: "emitido" }]);
    expect(emittedDraft.phase).toBe("draft");
    expect(emittedDraft.label).not.toMatch(/oficial|emitido/i);
  });

  it("emitido só pelo ledger de emissões (rótulo do ledger)", () => {
    expect(journeyDocState("tr", [{ kind: "tr", status: "rascunho" }], { tr: 2 }, { tr: 1 })).toEqual({ kind: "tr", phase: "official", label: "Emitido · 1ª emissão", exportable: true, draftStatus: "rascunho" });
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

describe("nota do arquivo exportado (diz o que o arquivo mostra)", () => {
  it("só o status 'rascunho' sai marcado como RASCUNHO; os demais mostram a situação, sem se dizer emitidos", () => {
    expect(exportNote(journeyDocState("etp", []))).toMatch(/Ainda não há minuta/);
    expect(exportNote(journeyDocState("etp", [{ kind: "etp", status: "rascunho" }]))).toBe("Minuta: o arquivo sai marcado como RASCUNHO (não é versão oficial).");
    const aprovado = exportNote(journeyDocState("etp", [{ kind: "etp", status: "aprovado" }]));
    expect(aprovado).toMatch(/situação “APROVADO” no cabeçalho — ainda não é versão emitida/);
    expect(aprovado).not.toMatch(/marcado como RASCUNHO/);
    expect(exportNote(journeyDocState("tr", [{ kind: "tr", status: "rejeitado" }]))).toMatch(/“REJEITADO”/);
    expect(journeyDocState("tr", [{ kind: "tr", status: "rejeitado" }]).label).toBe("Minuta rejeitada");
    expect(exportNote(journeyDocState("tr", [{ kind: "tr", status: "em_revisao" }], { tr: 2 }, { tr: 1 })))
      .toMatch(/^Há versão emitida\. .*se mudou, o arquivo sai com a situação “EM REVISÃO”/);
  });
});

describe("fluxo da ação de exportação", () => {
  const makeDeps = (over: Partial<JourneyExportRunDeps> = {}) => {
    const tab = { location: { href: "about:blank" }, closed: false, close: vi.fn() };
    const deps = {
      exportDocument: vi.fn().mockResolvedValue({ url: "https://s3/signed", fileName: "ETP.pdf" }),
      openPlaceholderTab: vi.fn().mockReturnValue(tab),
      delivery: { openTab: vi.fn(), download: vi.fn() },
      notify: { success: vi.fn(), error: vi.fn() },
      ...over,
    };
    return { deps, tab };
  };

  it("Imprimir: abre a aba no gesto com o texto do documento, pede o PDF inline e o entrega nessa aba", async () => {
    const { deps, tab } = makeDeps();
    expect(await runJourneyExport("etp", "print", deps)).toBe("delivered");
    expect(deps.openPlaceholderTab).toHaveBeenCalledWith(exportPlaceholderText("etp", "print"));
    expect(deps.exportDocument).toHaveBeenCalledWith({ format: "pdf", disposition: "inline" });
    expect(tab.location.href).toBe("https://s3/signed");
    expect(deps.notify.success).toHaveBeenCalledWith(exportDoneMessage("etp", "print"));
  });

  it("Baixar DOCX: sem aba, download no lugar", async () => {
    const { deps } = makeDeps();
    await runJourneyExport("dfd", "docx", deps);
    expect(deps.openPlaceholderTab).not.toHaveBeenCalled();
    expect(deps.exportDocument).toHaveBeenCalledWith({ format: "docx", disposition: "attachment" });
    expect(deps.delivery.download).toHaveBeenCalledWith("https://s3/signed", "ETP.pdf");
  });

  it("erro do servidor (ex.: acesso negado): fecha a aba pré-aberta e mostra a falha, sem sucesso", async () => {
    const { deps, tab } = makeDeps({ exportDocument: vi.fn().mockRejectedValue(new Error("Acesso negado")) });
    expect(await runJourneyExport("tr", "view", deps)).toBe("failed");
    expect(tab.close).toHaveBeenCalled();
    expect(deps.notify.error).toHaveBeenCalledWith("Falha ao exportar: Acesso negado");
    expect(deps.notify.success).not.toHaveBeenCalled();
  });

  it("aba bloqueada e fallback bloqueado: avisa, não simula sucesso", async () => {
    const { deps } = makeDeps({ openPlaceholderTab: vi.fn().mockReturnValue(null) });
    deps.delivery.openTab.mockReturnValue(null);
    expect(await runJourneyExport("edital", "view", deps)).toBe("blocked");
    expect(deps.notify.error).toHaveBeenCalled();
    expect(deps.notify.success).not.toHaveBeenCalled();
  });
});
