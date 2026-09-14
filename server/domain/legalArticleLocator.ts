/**
 * A3 — Locator jurídico semântico determinístico (domínio PURO).
 *
 * A identidade de um artigo/inciso é SEMÂNTICA (artigo + inciso), não a sua representação
 * de apresentação. "Art. 75, II", "Art. 75 II", "art 75, ii" designam o MESMO locator.
 * Serve para casar a sugestão da IA contra o CATÁLOGO institucional sem que vírgula/ponto/
 * espaço/casing façam parte indevida da identidade jurídica.
 *
 * NÃO é fuzzy/similaridade: normaliza apenas sintaxe de apresentação juridicamente equivalente.
 * Nunca aceita "artigo/inciso próximo". Puro e sem dependências.
 */

export interface LegalArticleLocator {
  /** Número do artigo, sem prefixo (ex.: "75"). */
  readonly article: string;
  /** Inciso em numeral romano maiúsculo (ex.: "II"), ou null quando ausente. */
  readonly inciso: string | null;
}

const ROMAN = /^[IVXLCDM]+$/i;

/**
 * Converte uma representação de artigo (ex.: "Art. 75, II") no seu locator semântico
 * { article: "75", inciso: "II" }. Retorna null quando não há artigo reconhecível.
 * Extrai o PRIMEIRO numeral romano após o número do artigo como inciso.
 */
export function normalizeLegalArticleLocator(raw: string | null | undefined): LegalArticleLocator | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const artMatch = s.match(/art\.?\s*(\d+)/i);
  if (!artMatch) return null;
  const article = artMatch[1];
  const rest = s.slice((artMatch.index ?? 0) + artMatch[0].length);
  const tokens = rest.split(/[\s,.;:()]+/).map((t) => t.trim()).filter(Boolean);
  let inciso: string | null = null;
  for (const t of tokens) {
    if (ROMAN.test(t)) {
      inciso = t.toUpperCase();
      break;
    }
  }
  return { article, inciso };
}

/** Igualdade SEMÂNTICA de locators (artigo idêntico e inciso idêntico — ambos null contam como igual). */
export function legalArticleLocatorEquals(a: LegalArticleLocator | null, b: LegalArticleLocator | null): boolean {
  if (!a || !b) return false;
  return a.article === b.article && (a.inciso ?? null) === (b.inciso ?? null);
}

/** Display CANÔNICO de um locator: "Art. 75" ou "Art. 75, II" (nunca duplica inciso). */
export function formatLegalArticleLocator(loc: LegalArticleLocator | null): string | null {
  if (!loc) return null;
  return loc.inciso ? `Art. ${loc.article}, ${loc.inciso}` : `Art. ${loc.article}`;
}

/** Registro mínimo de catálogo para casamento por locator. */
export interface CatalogArticleLike {
  readonly article: string;
  readonly inciso?: string | null;
}

/** Deriva o locator de um registro do catálogo (usa `article`; cai no campo `inciso` quando necessário). */
export function catalogArticleLocator(row: CatalogArticleLike): LegalArticleLocator | null {
  const base = normalizeLegalArticleLocator(row.article);
  if (!base) return null;
  if (base.inciso == null && row.inciso) {
    const t = String(row.inciso).trim();
    if (ROMAN.test(t)) return { article: base.article, inciso: t.toUpperCase() };
  }
  return base;
}

/**
 * Display CANÔNICO de um registro do catálogo. Evita a duplicação de inciso quando o campo
 * `article` já o contém (ex.: article="Art. 75, I" + inciso="I" → "Art. 75, I", nunca "Art. 75, I I").
 * Usado para montar o contexto enviado ao Kernel — o modelo nunca recebe representação duplicada.
 */
export function formatCatalogArticleDisplay(row: CatalogArticleLike): string | null {
  return formatLegalArticleLocator(catalogArticleLocator(row));
}

export type LegalArticleMatch<T> =
  | { readonly status: "matched"; readonly item: T }
  | { readonly status: "malformed" }
  | { readonly status: "not_found" }
  | { readonly status: "ambiguous" };

/**
 * Encontra, no catálogo, o ÚNICO registro cujo locator semântico casa com `aiArticleNumber`.
 * Fail-closed: `malformed` (número da IA irreconhecível), `not_found` (0 casos) ou `ambiguous`
 * (2+). Somente EXATAMENTE 1 casamento é aceito. Não usa fuzzy/similaridade.
 */
export function findUniqueLegalArticle<T extends CatalogArticleLike>(
  catalog: readonly T[],
  aiArticleNumber: string,
): LegalArticleMatch<T> {
  const target = normalizeLegalArticleLocator(aiArticleNumber);
  if (!target) return { status: "malformed" };
  const matches = catalog.filter((row) => legalArticleLocatorEquals(catalogArticleLocator(row), target));
  if (matches.length === 0) return { status: "not_found" };
  if (matches.length > 1) return { status: "ambiguous" };
  return { status: "matched", item: matches[0] };
}
