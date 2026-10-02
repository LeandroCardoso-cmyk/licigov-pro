/**
 * NEW-035 (classe SEM-019) — a conclusão da resposta institucional começa NEUTRA (nenhuma opção pré-selecionada) e
 * o envio fica bloqueado até a escolha explícita do humano.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";

vi.mock("../../lib/trpc", () => {
  const mutation = () => ({ mutate: () => {}, isPending: false, isError: false, isSuccess: false, error: null });
  const utils = new Proxy({}, { get: () => new Proxy({}, { get: () => ({ invalidate: () => {} }) }) });
  return { trpc: { useUtils: () => utils, institutionalRequest: { respond: { useMutation: mutation } } } };
});

import ResponsePanel from "./ResponsePanel";

describe("NEW-035 — ResponsePanel começa neutro", () => {
  const html = renderToStaticMarkup(createElement(ResponsePanel, { requestId: "req-1" }));
  const conclusion = html.slice(html.indexOf("Conclusão"), html.indexOf("Comentários"));

  it("nenhuma conclusão vem pré-selecionada (o placeholder vazio é o selecionado)", () => {
    expect(conclusion).toContain("Selecione a conclusão…");
    expect(conclusion).toMatch(/<option value="" disabled="" selected="">Selecione a conclusão…<\/option>/);
    expect(conclusion).not.toMatch(/value="favoravel" selected/);
    expect(conclusion).toContain('required=""');
  });

  it("o botão de envio fica desabilitado sem conclusão escolhida (sem opacity-50)", () => {
    const button = html.slice(html.lastIndexOf("<button"));
    expect(button).toContain('disabled=""');
    expect(button).not.toContain("opacity-50");
  });
});
