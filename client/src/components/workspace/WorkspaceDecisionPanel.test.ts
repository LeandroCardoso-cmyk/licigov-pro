/**
 * SEM-092 — WorkspaceDecisionPanel não pode exibir decisões/responsáveis fictícios por padrão.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import WorkspaceDecisionPanel from "./WorkspaceDecisionPanel";

const FAKE_NAMES = ["Ana Souza", "Carlos Lima", "Marina Alves"];

describe("WorkspaceDecisionPanel (SEM-092)", () => {
  it("sem props: estado vazio, nenhuma decisão nem responsável fictício", () => {
    const html = renderToStaticMarkup(React.createElement(WorkspaceDecisionPanel));
    expect(html).toContain("Nenhuma decisão registrada.");
    for (const n of FAKE_NAMES) expect(html).not.toContain(n);
    expect(html).not.toContain("Pregão eletrônico");
    expect(html).not.toContain("Responsável:");
  });

  it("com decisions=[]: estado vazio", () => {
    const html = renderToStaticMarkup(React.createElement(WorkspaceDecisionPanel, { decisions: [] }));
    expect(html).toContain("Nenhuma decisão registrada.");
  });

  it("com decisões reais: renderiza exatamente as recebidas", () => {
    const html = renderToStaticMarkup(React.createElement(WorkspaceDecisionPanel, {
      decisions: [{ id: "x", title: "Decisão real", outcome: "Aprovado pelo agente", status: "aprovada", responsibleUser: "Servidor Real" }],
    }));
    expect(html).toContain("Decisão real");
    expect(html).toContain("Servidor Real");
    expect(html).not.toContain("Nenhuma decisão registrada.");
  });

  it("fonte não contém nomes fictícios nem DEFAULT_DECISIONS", () => {
    const src = readFileSync(path.join(process.cwd(), "client/src/components/workspace/WorkspaceDecisionPanel.tsx"), "utf8");
    for (const n of FAKE_NAMES) expect(src).not.toContain(n);
    expect(src).not.toContain("DEFAULT_DECISIONS");
  });
});
