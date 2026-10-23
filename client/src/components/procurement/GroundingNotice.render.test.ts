/**
 * Homologação visual M8 — lacunas factuais listadas fora do texto (ETP/TR): o servidor vê o que falta e em qual
 * seção, sem caçar marcadores. Só leitura: o conteúdo e a revalidação de emissão não mudam.
 */
import { describe, it, expect } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import GroundingNotice from "./GroundingNotice";
import { listFactualGaps } from "./factualGaps";

(globalThis as { React?: typeof React }).React = React;

const CONTENT = [
  "# Estudo Técnico Preliminar",
  "## 1. Necessidade",
  "A secretaria precisa de notebooks. [REVISAR: quantidade de servidores atendidos]",
  "**Parcelamento**",
  "[REVISAR: decisão/análise necessária — lote único ou parcelamento] e [REVISAR: análise de mercado]",
].join("\n");

describe("lacunas factuais fora do texto (M8 visual)", () => {
  it("extrai cada [REVISAR: …] com a seção acima dele", () => {
    expect(listFactualGaps(CONTENT)).toEqual([
      { section: "1. Necessidade", text: "quantidade de servidores atendidos" },
      { section: "Parcelamento", text: "decisão/análise necessária — lote único ou parcelamento" },
      { section: "Parcelamento", text: "análise de mercado" },
    ]);
    expect(listFactualGaps("")).toEqual([]);
    expect(listFactualGaps("Texto sem marcadores.")).toEqual([]);
  });

  it("GroundingNotice lista as lacunas (seção · o que falta) e omite a lista sem marcadores", () => {
    const grounding = { state: "grounded", evidenceCount: 6, factualGaps: 3 };
    const html = renderToStaticMarkup(createElement(GroundingNotice, { grounding, content: CONTENT }));
    expect(html).toContain('data-testid="factual-gap-list"');
    expect(html).toContain("O que falta completar (3)");
    expect(html).toContain("1. Necessidade: </span>quantidade de servidores atendidos");
    expect(html).toContain("lote único ou parcelamento");
    const none = renderToStaticMarkup(createElement(GroundingNotice, { grounding: { ...grounding, factualGaps: 0 }, content: "ok" }));
    expect(none).not.toContain("factual-gap-list");
  });
});
