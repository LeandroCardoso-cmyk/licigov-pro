/**
 * M8 (homologação visual, P2) — Preview oficial e "Conteúdo a emitir" mostravam Markdown cru (#, **, | --- |) e o
 * marcador interno `<!-- licigov:itens-autoritativos -->`. A visualização formatada reutiliza o Streamdown com HTML
 * bruto desligado: conteúdo inseguro não vira DOM e o texto persistido não é alterado.
 */
import { describe, it, expect } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
(globalThis as { React?: typeof React }).React = React;
import DocumentMarkdownView from "@/components/documents/DocumentMarkdownView";
import { stripInternalMarkers, hasInternalMarkers } from "@shared/documentMarkers";

const render = (content: string) => renderToStaticMarkup(createElement(DocumentMarkdownView, { content }));

const DOC = [
  "# Termo de Referência — Processo 1419/2026",
  "",
  "## Definição do objeto",
  "_Art. 6º, XXIII, a · fundamentada_",
  "",
  "Aquisição de **material de expediente**.",
  "",
  "<!-- licigov:itens-autoritativos:inicio -->",
  "## Itens e estimativa de valor",
  "",
  "| Item | Descrição | Qtd. |",
  "| --- | --- | --- |",
  "| 1 | Papel sulfite A4 75g | 120 |",
  "<!-- licigov:itens-autoritativos:fim -->",
  "",
  "- Base legal: Lei nº 14.133/2021",
].join("\n");

describe("DocumentMarkdownView — visualização formatada e segura", () => {
  it("formata títulos, ênfase, listas e tabelas GFM (sem sintaxe Markdown crua)", () => {
    const html = render(DOC);
    expect(html).toMatch(/<h1[^>]*>Termo de Referência — Processo 1419\/2026<\/h1>/);
    expect(html).toMatch(/<h2[^>]*>Definição do objeto<\/h2>/);
    expect(html).toMatch(/data-streamdown="strong">material de expediente<\/span>/);
    expect(html).toMatch(/<table/);
    expect(html).toMatch(/<td[^>]*>Papel sulfite A4 75g<\/td>/);
    expect(html).toMatch(/<li[^>]*>Base legal: Lei nº 14.133\/2021<\/li>/);
    expect(html).not.toContain("| --- |");
    expect(html).not.toContain("## ");
    expect(html).not.toContain("**");
  });

  it("nunca exibe marcadores internos do motor documental", () => {
    const html = render(DOC);
    expect(html).not.toContain("licigov:");
    expect(html).not.toContain("&lt;!--");
  });

  it("conteúdo não confiável: HTML bruto, script, handlers, imagens e links javascript: não viram DOM ativo", () => {
    const html = render([
      "Texto <script>alert(1)</script> fim",
      "",
      '<img src="x" onerror="alert(2)">',
      "",
      '<div onclick="alert(3)">clique</div>',
      "",
      "![rastreador](https://evil.example/p.png)",
      "",
      "[link perigoso](javascript:alert(4))",
      "",
      "[link legítimo](https://www.gov.br/compras)",
    ].join("\n"));
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/onerror|onclick/i);
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).toContain('href="https://www.gov.br/compras"');
  });

  it("blocos de código (inclusive ```mermaid) ficam como texto: sem SVG/HTML injetado", () => {
    const html = render(["```mermaid", "graph TD; A-->B", "```", "", "```html", "<b>x</b>", "```"].join("\n"));
    expect(html).not.toMatch(/<svg/i);
    expect(html).not.toMatch(/<b>x<\/b>/);
    expect(html).toContain("graph TD; A--&gt;B");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("vazio ⇒ 'Sem conteúdo.'", () => {
    expect(render("   ")).toContain("Sem conteúdo.");
  });

  it("stripInternalMarkers só remove marcadores licigov (texto persistido intacto fora da visualização)", () => {
    expect(hasInternalMarkers(DOC)).toBe(true);
    const out = stripInternalMarkers(DOC);
    expect(out).not.toContain("licigov:");
    expect(out).toContain("| 1 | Papel sulfite A4 75g | 120 |");
    expect(stripInternalMarkers("<!-- comentário comum -->")).toBe("<!-- comentário comum -->");
  });
});
