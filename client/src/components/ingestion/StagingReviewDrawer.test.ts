/**
 * Pesquisa de Preços — semântica da quantidade na revisão/correção da EXTRAÇÃO.
 *
 * A quantidade exibida/corrigível é a do DOCUMENTO-FONTE (conceitualmente `sourceQuantity`), nunca a
 * quantidade a contratar. Rótulo, texto de apoio e ajuda contextual deixam isso explícito; o contrato de
 * correção (chave lógica `quantity`, overlay auditado) permanece o MESMO.
 */
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CorrectionFieldInput, CorrectionSectionHeader, ExtractedValuesSummary } from "./StagingReviewDrawer";
import {
  CORRECTABLE_FIELDS, CORRECTION_SCOPE_NOTE, CORRECTION_SECTION_TITLE, SOURCE_QUANTITY_CONTEXT, SOURCE_QUANTITY_HELP, SOURCE_QUANTITY_LABEL, buildCorrectionPatch,
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

describe("bloco de correção = correção da EXTRAÇÃO do documento-fonte", () => {
  const drawerSource = readFileSync(resolve(__dirname, "StagingReviewDrawer.tsx"), "utf8");

  it("título 'Corrigir extração do documento' e orientação sempre visível", () => {
    const html = renderToStaticMarkup(createElement(CorrectionSectionHeader, { itemId: 7 }));
    expect(CORRECTION_SECTION_TITLE).toBe("Corrigir extração do documento");
    expect(CORRECTION_SCOPE_NOTE).toBe("Altere somente informações que foram extraídas incorretamente do arquivo de origem.");
    expect(html).toContain(`<p id="corr-title-7" class="text-sm font-medium text-foreground">${CORRECTION_SECTION_TITLE}</p>`);
    expect(html).toContain(`<p id="corr-scope-7" class="text-xs text-muted-foreground">${CORRECTION_SCOPE_NOTE}</p>`);
  });

  it("'Corrigir campos' não aparece mais; o bloco é um grupo rotulado e descrito pelo título/orientação", () => {
    expect(drawerSource).not.toContain("Corrigir campos");
    expect(renderToStaticMarkup(createElement(CorrectionSectionHeader, { itemId: 7 }))).not.toContain("Corrigir campos");
    expect(drawerSource).toContain('role="group"');
    expect(drawerSource).toContain("aria-labelledby={`corr-title-${item.id}`}");
    expect(drawerSource).toContain("aria-describedby={`corr-scope-${item.id}`}");
    expect(drawerSource).toContain("<CorrectionSectionHeader itemId={item.id} />");
  });

  it("quantidade do documento e seu texto de apoio continuam (semântica da #254 preservada)", () => {
    const html = render("quantity");
    expect(labelText(html)).toBe(SOURCE_QUANTITY_LABEL);
    expect(html).toContain(SOURCE_QUANTITY_HELP);
  });

  it("salvar/fechar, fluxo de correção e superfície de API inalterados (nenhuma chamada nova)", () => {
    expect(drawerSource).toContain("onClick={saveCorrection}");
    expect(drawerSource).toContain('"Salvar correção"');
    expect(drawerSource).toContain(">Fechar</Button>");
    expect(drawerSource).toContain("await onCorrect(item.id, revision, patch, justification.trim(), newIdempotencyKey());");
    expect(drawerSource).not.toMatch(/from "@\/lib\/trpc"|trpc\./);
    expect(drawerSource.match(/<Button/g)).toHaveLength(5); // Salvar correção · Aceitar · Pular · Rejeitar · Fechar
  });
});
