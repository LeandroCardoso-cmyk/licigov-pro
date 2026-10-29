/**
 * LICIGOV-FAST PR-1 — barra de jornada (render estático) + fiação no Processo Licitatório (fonte).
 * A barra mostra o estado real, oferece as ações do documento aberto e o próximo documento; o shell protege
 * edição não salva e exporta só pelo contrato canônico.
 */
import { describe, it, expect } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import DocumentJourneyBar from "./DocumentJourneyBar";
import { journeyStates } from "@/lib/documentJourney";
import { START_OPTIONS, startOptionDescription, startTargetFor } from "./startOptions";

(globalThis as { React?: typeof React }).React = React;

const noop = () => {};
const render = (props: Partial<Parameters<typeof DocumentJourneyBar>[0]> & Pick<Parameters<typeof DocumentJourneyBar>[0], "current" | "states">) =>
  renderToStaticMarkup(createElement(DocumentJourneyBar, { onNavigate: noop, onExport: noop, ...props }));
const disabledButtons = (html: string) => (html.match(/<button[^>]*disabled=""[^>]*>/g) ?? []).length;

describe("DocumentJourneyBar", () => {
  it("DFD disponível: ações habilitadas, etapa atual destacada, próximo = ETP (não iniciado), marca de minuta", () => {
    const html = render({ current: "dfd", states: journeyStates([{ kind: "dfd", status: "rascunho" }]) });
    expect(html).toContain('aria-current="step"');
    for (const label of ["Visualizar", "Baixar DOCX", "Baixar PDF", "Imprimir"]) expect(html).toContain(label);
    expect(disabledButtons(html)).toBe(0);
    expect(html).toContain("Ir para ETP (não iniciado)");
    expect(html).toContain("Minuta (rascunho)");
    expect(html).toContain("MINUTA — NÃO EMITIDA OFICIALMENTE");
  });

  it("DFD inexistente: as 4 ações ficam indisponíveis e o motivo é dito", () => {
    const html = render({ current: "dfd", states: journeyStates([]) });
    expect(disabledButtons(html)).toBe(4);
    expect(html).toContain("Ainda não há minuta deste documento");
    expect(html).not.toContain("Minuta (rascunho)");
  });

  it("ETP/TR/Edital gerados: exportação individual em cada um; Edital é o fim (sem próximo)", () => {
    const docs = [{ kind: "etp", status: "rascunho" }, { kind: "tr", status: "em_revisao" }, { kind: "edital", status: "rascunho" }];
    expect(render({ current: "etp", states: journeyStates(docs) })).toContain("Ir para TR");
    const tr = render({ current: "tr", states: journeyStates(docs) });
    expect(disabledButtons(tr)).toBe(0);
    expect(tr).toContain("Minuta em revisão");
    expect(tr).toContain("Ir para Edital");
    const edital = render({ current: "edital", states: journeyStates(docs) });
    expect(disabledButtons(edital)).toBe(0);
    expect(edital).not.toContain("Ir para");
  });

  it("documento emitido: identificação pelo ledger e explicação de qual arquivo sai", () => {
    const html = render({ current: "tr", states: journeyStates([{ kind: "tr", status: "rascunho" }], { tr: 2 }, { tr: 1 }) });
    expect(html).toContain("Emitido · 1ª emissão");
    expect(html).toContain("Se a minuta não mudou desde a emissão, o arquivo é a versão oficial");
    const aprovado = render({ current: "etp", states: journeyStates([{ kind: "etp", status: "aprovado" }]) });
    expect(aprovado).toContain("Minuta revisada");
    expect(aprovado).toContain("MINUTA — NÃO EMITIDA OFICIALMENTE");
    expect(aprovado).toContain("situação interna “APROVADO”");
  });

  it("edição não salva: avisa que o arquivo usa o último conteúdo salvo; exportação em andamento bloqueia nova", () => {
    const states = journeyStates([{ kind: "etp", status: "rascunho" }]);
    expect(render({ current: "etp", states, hasUnsavedEdits: true })).toContain("o arquivo usa o último conteúdo salvo");
    const busy = render({ current: "etp", states, pendingAction: "print" });
    expect(busy).toContain("Preparando…");
    expect(disabledButtons(busy)).toBe(4);
    // exportação de outra etapa ainda em andamento: as ações desta etapa também esperam
    expect(disabledButtons(render({ current: "etp", states, exportBusy: true }))).toBe(4);
  });
});

describe("fiação no Processo Licitatório (fonte)", () => {
  const ROOT = process.cwd();
  const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
  const shell = read("client/src/pages/ProcessoLicitatorio.tsx");
  const hook = read("client/src/components/procurement/useJourneyExport.ts");

  it("toda navegação de etapa passa pela proteção de edição não salva", () => {
    expect(shell).not.toMatch(/onClick=\{\(\) => setActiveTab\(/);
    expect(shell).toContain("onClick={() => navigateTab(tab.key)}");
    expect(shell).toContain("onNavigate={navigateTab}");
    expect(shell).toMatch(/onClick: leaveToList/);
    for (const ws of ["DFDWorkspace", "ETPWorkspace", "TRWorkspace", "EditalWorkspace"]) {
      expect(shell).toMatch(new RegExp(`<${ws}[^\\n]*onDirtyChange=\\{onDirtyChange\\}`));
    }
  });

  it("exportação usa SÓ o contrato canônico (sem rota legada, sem geração)", () => {
    expect(hook).toContain("trpc.procurementProcess.exportDocument.useMutation");
    expect(hook).not.toMatch(/documentEngine|generate[A-Z]/);
    expect(shell).not.toMatch(/documentEngine\.download/);
  });

  it("SECURITY-02: a barra só lê e exporta — nenhuma chamada a ato institucional (emitir/aprovar/publicar/decidir)", () => {
    const bar = read("client/src/components/procurement/DocumentJourneyBar.tsx");
    const lib = read("client/src/lib/documentJourney.ts");
    const institutionalAct = /issueProcess|promote[A-Z]|approve[A-Z]|reject[A-Z]|publish[A-Z]|ratif|recordDecision|\.useMutation/;
    expect(bar).not.toMatch(institutionalAct);
    expect(lib).not.toMatch(institutionalAct);
    // única mutação do fluxo da barra: a exportação canônica (leitura do rascunho salvo; não é ato institucional)
    expect(hook.match(/\.useMutation/g)).toHaveLength(1);
    expect(hook).not.toMatch(/issueProcess|promote[A-Z]|approve[A-Z]|publish[A-Z]/);
  });

  it("navegar não grava a etapa registrada do processo", () => {
    expect(shell).not.toMatch(/updateStage|issueProcess/);
  });
});

describe("textos de início (importação)", () => {
  it("nenhuma forma promete extração/estruturação que não acontece", () => {
    for (const opt of START_OPTIONS) expect(opt.description).not.toMatch(/Extraímos|estrutura a demanda/);
    const oficio = START_OPTIONS.find((o) => o.value === "importar_oficio")!;
    expect(oficio.description).toMatch(/não é lido automaticamente/);
  });

  it("'Importar PDF' abre a importação real do DFD; ofício/memorando abrem o DFD sem importação", () => {
    expect(startTargetFor("importar_pdf")).toEqual({ tab: "dfd", importOpen: true });
    expect(startTargetFor("importar_oficio")).toEqual({ tab: "dfd", importOpen: false });
    expect(startTargetFor("importar_memorando")).toEqual({ tab: "dfd", importOpen: false });
  });

  it("importação documental desligada ⇒ as formas de arquivo não prometem ler o arquivo", () => {
    const dfd = START_OPTIONS.find((o) => o.value === "importar_dfd")!;
    expect(startOptionDescription(dfd, true)).toBe(dfd.description);
    expect(startOptionDescription(dfd, false)).toMatch(/indisponível.*sem ler o arquivo/);
    const criar = START_OPTIONS.find((o) => o.value === "criar_dfd")!;
    expect(startOptionDescription(criar, false)).toBe(criar.description);
  });
});
