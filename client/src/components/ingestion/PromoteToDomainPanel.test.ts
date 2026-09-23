import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PromoteToDomainPanel } from "./PromoteToDomainPanel";

const baseProps = {
  status: "none",
  importType: "price_research",
  isPromoting: false,
  error: null,
  result: null,
  onPromote: () => {},
};

describe("promoção da Pesquisa por papel institucional", () => {
  it("orienta o operador sem oferecer a ação restrita ao gestor", () => {
    const html = renderToStaticMarkup(createElement(PromoteToDomainPanel, {
      ...baseProps,
      canPromote: false,
      requiresManager: true,
    }));
    expect(html).toContain("exige perfil Gestor ou superior");
    expect(html).not.toContain("Promover conteúdo revisado");
  });

  it("oferece a promoção ao gestor com a sessão elegível", () => {
    const html = renderToStaticMarkup(createElement(PromoteToDomainPanel, {
      ...baseProps,
      canPromote: true,
      requiresManager: false,
    }));
    expect(html).toContain("Promover conteúdo revisado");
  });
});
