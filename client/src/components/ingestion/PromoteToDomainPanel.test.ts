import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PromoteToDomainPanel, PromotionImpactConfirmation } from "./PromoteToDomainPanel";
import type { PromotionPreviewView } from "@/lib/ingestion/promotion";

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

// R9 / SEM-053 — a confirmação mostra o impacto calculado pelo SERVIDOR e só habilita após reconhecimento explícito.
describe("R9 / SEM-053 — confirmação com impacto nos Itens Inteligentes", () => {
  const preview: PromotionPreviewView = {
    quotesToPromote: 4,
    intelligentItems: { create: 2, merge: 1, unchanged: 0, preserved: 1, sourceChanged: 1, sourceChangedApproved: 1, reviewRequired: 2, reconciled: 0 },
    merges: [{ itemId: "m1", description: "Caneta azul", status: "pendente", beforeQuoteCount: 1, afterQuoteCount: 2, beforeAverageCents: 150, afterAverageCents: 175 }],
    sourceChanges: [{ itemId: "s1", description: "Papel A4", status: "aprovado", beforeQuoteCount: 1, afterQuoteCount: 2, beforeAverageCents: 1890, afterAverageCents: 1945 }],
    detailLimit: 50,
  };
  const props = {
    preview, isPreviewLoading: false, previewError: null, isPromoting: false, acknowledged: false,
    onAcknowledgedChange: () => {}, onConfirm: () => {}, onCancel: () => {},
  };
  const confirmButton = (html: string): string => {
    const m = html.match(/<button[^>]*>(?:(?!<\/button>).)*Confirmar promoção<\/button>/);
    if (!m) throw new Error("botão Confirmar promoção ausente");
    return m[0];
  };

  it("mostra criados, mesclados/recalculados (antes × depois), Fonte alterada (aprovados) e Identidade a revisar", () => {
    const html = renderToStaticMarkup(createElement(PromotionImpactConfirmation, props));
    expect(html).toContain("4 cotações aprovadas serão gravadas");
    expect(html).toContain("2 Itens Inteligentes novos serão criados");
    expect(html).toContain("1 Item Inteligente existente terá as cotações MESCLADAS");
    expect(html).toContain("Fonte alterada");
    expect(html).toContain("1 deles está aprovado");
    expect(html).toContain("2 Itens Inteligentes existentes serão marcados como &quot;Identidade a revisar&quot;");
    expect(html).toContain("1 Item Inteligente existente permanece sem alteração");
    // Detalhe antes × depois (formatador monetário único).
    expect(html).toContain("Caneta azul");
    expect(html).toMatch(/1 → 2 cotação\(ões\); média R\$ 1,50 → R\$ 1,75/);
    expect(html).toContain("Itens Inteligentes existentes serão alterados/marcados");
  });

  it("sem reconhecimento explícito ⇒ Confirmar desabilitado; com reconhecimento ⇒ habilitado", () => {
    const off = confirmButton(renderToStaticMarkup(createElement(PromotionImpactConfirmation, props)));
    expect(off).toMatch(/disabled=""/);
    expect(off).not.toContain("disabled:opacity-50 ");
    expect(off).toContain("disabled:bg-muted");
    const on = confirmButton(renderToStaticMarkup(createElement(PromotionImpactConfirmation, { ...props, acknowledged: true })));
    expect(on).not.toMatch(/disabled=""/);
  });

  it("prévia carregando ou com erro ⇒ não há como confirmar (mesmo reconhecido)", () => {
    const loading = renderToStaticMarkup(createElement(PromotionImpactConfirmation, { ...props, preview: null, isPreviewLoading: true, acknowledged: true }));
    expect(loading).toContain("Calculando o impacto");
    expect(confirmButton(loading)).toMatch(/disabled=""/);
    const failed = renderToStaticMarkup(createElement(PromotionImpactConfirmation, { ...props, preview: null, previewError: "Sessão não está aprovada", acknowledged: true }));
    expect(failed).toContain("Não foi possível calcular o impacto");
    expect(confirmButton(failed)).toMatch(/disabled=""/);
  });

  it("promoção sem efeito em itens existentes ⇒ texto de reconhecimento simples", () => {
    const html = renderToStaticMarkup(createElement(PromotionImpactConfirmation, {
      ...props,
      preview: { ...preview, intelligentItems: { ...preview.intelligentItems, merge: 0, sourceChanged: 0, sourceChangedApproved: 0, reviewRequired: 0 }, merges: [], sourceChanges: [] },
    }));
    expect(html).toContain("Li o impacto acima e confirmo a promoção.");
    expect(html).not.toContain("MESCLADAS");
  });
});
