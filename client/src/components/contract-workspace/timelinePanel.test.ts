/** M8 — linha do tempo do contrato: nome do ator (resolvido no tenant) e rótulo humano do evento, nunca "user:4" / "workspace_created". */
import { describe, it, expect } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TimelinePanel, { timelineEventLabel } from "./TimelinePanel";

(globalThis as { React?: typeof React }).React = React;

describe("TimelinePanel", () => {
  it("mostra o nome do ator quando resolvido e 'Usuário nº' quando não; evento com rótulo humano", () => {
    const html = renderToStaticMarkup(createElement(TimelinePanel, { timeline: [
      { id: "e1", order: 1, eventType: "workspace_created", actor: "user:4", actorName: "Teste - Homologação", summary: "Contrato registrado como VIGENTE", createdAt: "2026-10-27T12:34:00.000Z" },
      { id: "e2", order: 2, eventType: "change", actor: "user:5", actorName: null, summary: "Aditivo", createdAt: "2026-10-27T12:35:00.000Z" },
    ] }));
    expect(html).toContain("por Teste - Homologação");
    expect(html).toContain("por Usuário nº 5");
    expect(html).not.toContain("por user:");
    expect(html).toContain("Contrato registrado");
    expect(html).not.toContain(">workspace_created<");
  });
  it("tipo desconhecido mantém o código (nada inventado)", () => {
    expect(timelineEventLabel("evento_novo")).toBe("evento_novo");
  });
});
