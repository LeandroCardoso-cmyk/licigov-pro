/**
 * Pesquisa de Preços — semântica da quantidade na revisão/correção da EXTRAÇÃO.
 *
 * A quantidade exibida/corrigível é a do DOCUMENTO-FONTE (conceitualmente `sourceQuantity`), nunca a
 * quantidade a contratar. Rótulo, texto de apoio e ajuda contextual deixam isso explícito; o contrato de
 * correção (chave lógica `quantity`, overlay auditado) permanece o MESMO.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CorrectionFieldInput, ExtractedValuesSummary } from "./StagingReviewDrawer";
import {
  CORRECTABLE_FIELDS, SOURCE_QUANTITY_CONTEXT, SOURCE_QUANTITY_HELP, SOURCE_QUANTITY_LABEL, buildCorrectionPatch,
} from "@/lib/ingestion/correction";
import type { StagingItem } from "@/lib/ingestion/staging";
import { CORRECTABLE_FIELDS as SERVER_CORRECTABLE_FIELDS } from "../../../../server/domain/importCorrectionFields";

const fields = CORRECTABLE_FIELDS.price_research;
const field = (logical: string) => fields.find((f) => f.logical === logical)!;
const render = (logical: string, value = "1,00", original = "1,00") =>
  renderToStaticMarkup(createElement(CorrectionFieldInput, { itemId: 7, field: field(logical), value, original, onChange: () => {} }));
const labelText = (html: string) => html.match(/<label[^>]*>([^<]*)<\/label>/)![1];

const item = {
  id: 7, rawDescription: "PRODUTO FICTÍCIO", rawQuantity: "1,00", rawUnit: "Tambor", rawUnitPrice: "R$ 950,31", rawTotalPrice: null,
  sourceLocation: null, confidenceMetadata: null, extractionWarnings: null, reviewStatus: "pending",
  reviewedBy: null, reviewedAt: null, reviewNote: null, correctionRevision: 0, correctedPayload: null,
} as StagingItem;

describe("quantidade do documento-fonte na correção da extração", () => {
  it("rótulo do campo é 'Quantidade no documento' (nunca 'Quantidade a contratar')", () => {
    const html = render("quantity");
    expect(labelText(html)).toBe("Quantidade no documento");
    expect(labelText(html)).not.toMatch(/contratar|contrata/i);
    expect(html).not.toContain(">Quantidade<");
    expect(html).not.toMatch(/<label[^>]*>Quantidade a contratar/);
  });

  it("texto de apoio visível e associado ao campo (aria-describedby)", () => {
    const html = render("quantity");
    expect(html).toContain(SOURCE_QUANTITY_HELP);
    expect(SOURCE_QUANTITY_HELP).toBe("Valor extraído do arquivo de origem. Altere somente se a extração não corresponder ao documento.");
    expect(html).toContain('aria-describedby="orig-7-quantity help-7-quantity"');
    expect(html).toContain('id="help-7-quantity"');
  });

  it("ajuda contextual acessível explica que a quantidade prevista para contratação é definida no processo", () => {
    const html = render("quantity");
    expect(SOURCE_QUANTITY_CONTEXT).toBe("Esta quantidade pertence ao documento de Pesquisa de Preços. A quantidade efetivamente prevista para contratação é definida na necessidade/itens do processo.");
    expect(html).toMatch(new RegExp(`<button[^>]*aria-label="${SOURCE_QUANTITY_CONTEXT.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}"`));
    expect(html).toContain('type="button"');
  });

  it("valor atual e valor ORIGINAL extraído continuam exibidos", () => {
    const html = render("quantity", "10", "1,00");
    expect(html).toContain('value="10"');
    expect(html).toContain('Original: <span class="font-mono">1,00</span>');
  });

  it("nenhuma quantidade de contratação é exibida ou editável no drawer (não há vínculo canônico seguro)", () => {
    const html = fields.map((f) => render(f.logical)).join("");
    expect(html).not.toMatch(/Quantidade prevista para contratação:/);
    expect(html.match(/<input/g)).toHaveLength(fields.length);
  });

  it("demais campos inalterados: mesmos rótulos, sem texto de apoio nem ajuda contextual", () => {
    expect(fields.map((f) => [f.logical, f.label])).toEqual([
      ["description", "Descrição"], ["quantity", SOURCE_QUANTITY_LABEL], ["unit", "Unidade"],
      ["unitPrice", "Preço unitário"], ["totalPrice", "Preço total"],
    ]);
    for (const logical of ["description", "unit", "unitPrice", "totalPrice"]) {
      const html = render(logical, "x", "x");
      expect(html).not.toContain(SOURCE_QUANTITY_HELP);
      expect(html).not.toContain("<button");
      expect(html).toContain(`aria-describedby="orig-7-${logical}"`);
    }
  });

  it("leitura (tipos não corrigíveis) também rotula a quantidade como do documento", () => {
    const html = renderToStaticMarkup(createElement(ExtractedValuesSummary, { item }));
    expect(html).toContain(">Quantidade no documento<");
    expect(html).toContain(SOURCE_QUANTITY_HELP);
    expect(html).toContain(">1,00<");
    expect(html).toContain(">Unidade<");
    expect(html).toContain(">Preço unitário<");
  });
});

describe("contrato de correção inalterado", () => {
  it("corrigir a quantidade do documento gera o MESMO patch de antes (chave lógica `quantity`)", () => {
    const draft = { description: "PRODUTO FICTÍCIO", quantity: "10", unit: "Tambor", unitPrice: "R$ 950,31", totalPrice: "" };
    expect(buildCorrectionPatch(item, fields, draft)).toEqual({ quantity: "10" });
  });

  it("chaves lógicas do cliente continuam espelhando a allowlist do servidor (nenhuma mudança de API)", () => {
    const server = SERVER_CORRECTABLE_FIELDS.price_research;
    for (const f of fields) {
      expect(server[f.logical]).toBeDefined();
      expect(server[f.logical].rawKey).toBe(f.rawKey);
    }
    expect(server.quantity).toMatchObject({ logical: "quantity", rawKey: "rawQuantity", kind: "decimal" });
  });
});
