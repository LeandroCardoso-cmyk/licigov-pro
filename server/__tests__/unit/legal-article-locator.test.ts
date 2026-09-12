/**
 * A3 — Locator jurídico semântico (domínio puro). Regressão da 2ª LIVE: DIRECT falhou no
 * casamento pós-geração porque `${art.article} ${art.inciso}` (vírgula/duplicação) fazia da
 * formatação parte indevida da identidade jurídica. O casamento passa a ser SEMÂNTICO.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeLegalArticleLocator,
  legalArticleLocatorEquals,
  catalogArticleLocator,
  formatCatalogArticleDisplay,
  formatLegalArticleLocator,
  findUniqueLegalArticle,
} from "../../domain/legalArticleLocator";

// Catálogo real (como semeado): `article` já inclui o inciso ("Art. 75, I") + campo `inciso` separado.
const CATALOG = [
  { id: 10, type: "dispensa", article: "Art. 75, I", inciso: "I" },
  { id: 11, type: "dispensa", article: "Art. 75, III", inciso: "III" },
  { id: 12, type: "inexigibilidade", article: "Art. 74, II", inciso: "II" },
] as const;

describe("normalizeLegalArticleLocator — identidade semântica", () => {
  it("A. representações equivalentes → mesmo locator (vírgula/espaço/casing)", () => {
    const canonical = { article: "75", inciso: "II" };
    expect(normalizeLegalArticleLocator("Art. 75, II")).toEqual(canonical);
    expect(normalizeLegalArticleLocator("Art. 75 II")).toEqual(canonical);
    expect(normalizeLegalArticleLocator("art 75, ii")).toEqual(canonical);
    expect(normalizeLegalArticleLocator("Art 75  II")).toEqual(canonical);
  });

  it("artigo sem inciso → inciso null; entrada irreconhecível → null", () => {
    expect(normalizeLegalArticleLocator("Art. 75")).toEqual({ article: "75", inciso: null });
    expect(normalizeLegalArticleLocator("qualquer coisa")).toBeNull();
    expect(normalizeLegalArticleLocator("")).toBeNull();
  });

  it("B. artigos/incisos diferentes NÃO são iguais", () => {
    const i = normalizeLegalArticleLocator("Art. 75, I");
    const ii = normalizeLegalArticleLocator("Art. 75, II");
    expect(legalArticleLocatorEquals(i, ii)).toBe(false);
    expect(legalArticleLocatorEquals(normalizeLegalArticleLocator("Art. 74, II"), ii)).toBe(false);
  });

  it("catalogArticleLocator deriva do campo article (e cai no inciso quando preciso)", () => {
    expect(catalogArticleLocator({ article: "Art. 75, I", inciso: "I" })).toEqual({ article: "75", inciso: "I" });
    // article sem inciso textual, mas coluna inciso presente → usa a coluna.
    expect(catalogArticleLocator({ article: "Art. 75", inciso: "III" })).toEqual({ article: "75", inciso: "III" });
  });
});

describe("findUniqueLegalArticle — fail-closed determinístico", () => {
  it("A/H. match por equivalência de formatação → retorna o registro do catálogo", () => {
    const r = findUniqueLegalArticle(CATALOG, "Art. 75, I"); // IA com vírgula
    expect(r.status).toBe("matched");
    if (r.status === "matched") {
      expect(r.item.id).toBe(10);
      expect(r.item.type).toBe("dispensa");
      expect(r.item.article).toBe("Art. 75, I");
    }
  });

  it("C. ausência (Art. 75, II não está no catálogo) → not_found (fail-closed)", () => {
    expect(findUniqueLegalArticle(CATALOG, "Art. 75, II").status).toBe("not_found");
  });

  it("D. duplicidade do mesmo locator → ambiguous (fail-closed)", () => {
    const dup = [...CATALOG, { id: 99, type: "dispensa", article: "Art. 75 I", inciso: "I" }];
    expect(findUniqueLegalArticle(dup, "Art. 75, I").status).toBe("ambiguous");
  });

  it("E. articleNumber malformado → malformed (fail-closed)", () => {
    expect(findUniqueLegalArticle(CATALOG, "sem artigo").status).toBe("malformed");
    expect(findUniqueLegalArticle(CATALOG, "").status).toBe("malformed");
  });
});

describe("display canônico — NUNCA duplica inciso (contexto enviado ao Kernel)", () => {
  it('"Art. 75, I" + inciso "I" → "Art. 75, I" (sem duplicação)', () => {
    expect(formatCatalogArticleDisplay({ article: "Art. 75, I", inciso: "I" })).toBe("Art. 75, I");
  });
  it('"Art. 75" + inciso "I" → "Art. 75, I" (compõe do campo separado)', () => {
    expect(formatCatalogArticleDisplay({ article: "Art. 75", inciso: "I" })).toBe("Art. 75, I");
  });
  it("artigo sem inciso → display sem inciso", () => {
    expect(formatCatalogArticleDisplay({ article: "Art. 75", inciso: null })).toBe("Art. 75");
  });
  it("representações equivalentes → mesmo display canônico", () => {
    const canonical = "Art. 74, II";
    expect(formatCatalogArticleDisplay({ article: "Art. 74, II", inciso: "II" })).toBe(canonical);
    expect(formatCatalogArticleDisplay({ article: "art 74 ii", inciso: "II" })).toBe(canonical);
    expect(formatCatalogArticleDisplay({ article: "Art. 74", inciso: "ii" })).toBe(canonical);
    expect(formatLegalArticleLocator(normalizeLegalArticleLocator("Art. 74, II"))).toBe(canonical);
  });
});
