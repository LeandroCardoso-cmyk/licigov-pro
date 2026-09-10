/**
 * V1 PRE-PILOT CLOSURE — Fase A2 (fechamento) — Validação de referências jurídicas CONTRA O CORPUS REAL.
 *
 * Guarda anti-alucinação com granularidade: uma referência legal citada ("Art. 18, §1º, IX da Lei
 * 14.133/2021") só é PROMOVIDA quando (1) o diploma EXISTE e é vigente, (2) o ARTIGO existe e (3) o
 * SUB-LOCATOR (§/inciso/alínea/item) REALMENTE existe no texto verbatim daquele artigo. NÃO basta o
 * artigo existir — "Art. 18, §99" ou "§1º, inciso XXIX" são rejeitados. Também classifica a QUALIDADE da
 * fonte (normativa × manual × jurisprudencial) para a política de grounding. Determinístico, sem I/O.
 */

import type { OfficialCorpusBuildResult } from "../officialCorpus/officialCorpusBuilder";
import { allBlocks } from "../../domain/knowledge/knowledgeDocument";
import { canonicalLocatorId, displayLocator, normalizeDiplomaHint, parseLegalReferences } from "../../domain/institutionalIntegration/canonicalLocator";
import { isNormativeCurrent } from "../../domain/institutionalIntegration/evidenceFromContext";
import type { AuthoredLegalReference } from "../../domain/authoring/authoringSchema";

/** Qualidade/natureza da fonte — governa a política de fundamentação (Gap 8). */
export type SourceKind = "normative" | "manual" | "jurisprudential" | "unknown";

/** Classifica o documentType oficial em natureza de fonte. */
export function classifySourceKind(documentType: string | undefined | null): SourceKind {
  const t = (documentType ?? "").toLowerCase();
  if (["lei", "decreto", "instrucao_normativa", "lei_complementar", "municipal_law"].includes(t)) return "normative";
  if (["manual", "orientacao_tecnica"].includes(t)) return "manual";
  if (["prejulgado", "acordao", "sumula", "jurisprudencia"].includes(t)) return "jurisprudential";
  return "unknown";
}

interface ArticleEntry {
  /** Identificador legível do artigo (ex.: "Art. 18º"). */
  readonly identifier: string;
  /** Texto verbatim do artigo (para verificação de sub-locators). */
  readonly text: string;
}

interface DiplomaEntry {
  readonly status: string;
  readonly title: string;
  readonly kind: SourceKind;
  readonly articles: ReadonlyMap<string, ArticleEntry>;
}

/** Índice determinístico do corpus para verificação de EXISTÊNCIA de artigo/sub-locator por diploma. */
export interface CorpusLegalIndex {
  readonly diplomas: ReadonlyMap<string, DiplomaEntry>;
}

/** Extrai a chave de artigo estável de um identificador ("Art. 18º" | "18" | "Art. 6-A") → "18" | "6-a". */
function articleKey(identifier: string): string {
  const m = (identifier ?? "").toLowerCase().replace(/[º°]/g, "").match(/(\d+)\s*(-?\s*[a-z])?/);
  if (!m) return "";
  return `${m[1]}${m[2] ? "-" + m[2].replace(/[-\s]/g, "") : ""}`;
}

/** Versão exportada de `articleKey` (para casar identificador de passagem × artigo da âncora). */
export function articleKeyOf(identifier: string): string {
  return articleKey(identifier);
}

/** Constrói o índice legal a partir do corpus REAL incorporado (verbatim). Puro/determinístico. */
export function buildCorpusLegalIndex(corpus: OfficialCorpusBuildResult): CorpusLegalIndex {
  const diplomas = new Map<string, DiplomaEntry>();
  for (const doc of corpus.ingested) {
    const normId = doc.official.normId;
    const articles = new Map<string, ArticleEntry>();
    for (const block of allBlocks(doc.knowledgeDocument)) {
      if (block.kind !== "OfficialText") continue;
      const identifier = String((block.metadata as { identifier?: unknown })?.identifier ?? block.title ?? "");
      const key = articleKey(identifier);
      const text = block.fragments.map((f) => f.text).join("\n");
      if (key && !articles.has(key)) articles.set(key, { identifier, text });
    }
    diplomas.set(normId, {
      status: doc.official.status, title: doc.official.title,
      kind: classifySourceKind(doc.official.documentType), articles,
    });
  }
  return { diplomas };
}

// ─── Verificação de sub-locator contra o TEXTO verbatim do artigo ─────────────

/** Restringe o texto ao trecho de um parágrafo ("1" | "unico"): de "§ N" ao próximo "§". */
function narrowToParagraph(text: string, n: string): string | null {
  if (n === "unico") {
    const m = text.match(/par[áa]grafo\s+[úu]nico/i);
    if (!m) return null;
    const rest = text.slice((m.index ?? 0) + m[0].length);
    const nextPar = rest.search(/(?:^|\n)\s*§\s*\d/);
    return nextPar > 0 ? rest.slice(0, nextPar) : rest;
  }
  const re = new RegExp(`(?:^|\\n)\\s*§\\s*${n}\\b`);
  const m = text.match(re);
  if (!m) return null;
  const rest = text.slice((m.index ?? 0) + m[0].length);
  const nextPar = rest.search(/(?:^|\n)\s*§\s*\d/);
  return nextPar > 0 ? rest.slice(0, nextPar) : rest;
}

/** Restringe o texto ao trecho de um inciso (romano): do marcador "X -" ao próximo inciso do mesmo nível. */
function narrowToInciso(text: string, roman: string): string | null {
  const R = roman.toUpperCase();
  const re = new RegExp(`(?:^|\\n)\\s*${R}\\s*[-–—]`);
  const m = text.match(re);
  if (!m) return null;
  const rest = text.slice((m.index ?? 0) + m[0].length);
  const nextInc = rest.search(/(?:^|\n)\s*[IVXLCDM]+\s*[-–—]/);
  return nextInc > 0 ? rest.slice(0, nextInc) : rest;
}

/** A alínea (letra) existe no trecho? (marcador "a)" em início de linha). */
function hasAlinea(text: string, letter: string): boolean {
  return new RegExp(`(?:^|\\n)\\s*${letter.toLowerCase()}\\)`).test(text);
}

/** O item (número) existe no trecho? ("item N" ou "N -" / "N)"). */
function hasItem(text: string, n: string): boolean {
  return new RegExp(`(?:item\\s+${n}\\b|(?:^|\\n)\\s*${n}\\s*[-)–])`, "i").test(text);
}

/**
 * Verifica um caminho de sub-locator (["par-1","inc-ix"], ["inc-xxiii","al-a"]…) contra o texto verbatim
 * do artigo. Cada nível ESTREITA o trecho de busca — um inciso é procurado DENTRO do parágrafo citado,
 * uma alínea DENTRO do inciso. Assim, "§1º, inciso IX" só passa se o inciso IX existir sob o §1º.
 */
export function verifySubLocatorPath(articleText: string, subSegments: readonly string[]): boolean {
  let region = articleText;
  for (const seg of subSegments) {
    let m: RegExpMatchArray | null;
    if ((m = seg.match(/^par-(.+)$/))) {
      const narrowed = narrowToParagraph(region, m[1]);
      if (narrowed === null) return false;
      region = narrowed;
    } else if ((m = seg.match(/^inc-([ivxlcdm]+)$/))) {
      const narrowed = narrowToInciso(region, m[1]);
      if (narrowed === null) return false;
      region = narrowed;
    } else if ((m = seg.match(/^al-([a-z])$/))) {
      if (!hasAlinea(region, m[1])) return false;
      // Estreita à alínea para eventuais sub-níveis (item).
      const idx = region.search(new RegExp(`(?:^|\\n)\\s*${m[1]}\\)`));
      region = idx >= 0 ? region.slice(idx) : region;
    } else if ((m = seg.match(/^item-(\d+)$/))) {
      if (!hasItem(region, m[1])) return false;
    } else {
      // Segmento desconhecido/genérico (trecho/seção/página) — não comprovável estruturalmente aqui.
      return false;
    }
  }
  return true;
}

export interface LegalReferenceValidationResult {
  readonly valid: readonly AuthoredLegalReference[];
  readonly rejected: readonly { readonly raw: string; readonly reason: string }[];
}

/**
 * Valida as referências jurídicas CITADAS num texto contra o corpus, com GRANULARIDADE completa
 * (§/inciso/alínea/item). Só promove as comprovadas; rejeita as inexistentes/incompatíveis. Referência
 * sem diploma identificável é ignorada (não comprovável, mas não fabricada). Determinística, sem I/O.
 */
export function validateCitedLegalReferences(index: CorpusLegalIndex, text: string): LegalReferenceValidationResult {
  const valid: AuthoredLegalReference[] = [];
  const rejected: { raw: string; reason: string }[] = [];
  const seenValid = new Set<string>();
  for (const ref of parseLegalReferences(text)) {
    if (!ref.diplomaHint) continue; // sem diploma identificável → não comprovável (não fabricar, não rejeitar)
    const diploma = index.diplomas.get(ref.diplomaHint);
    if (!diploma) { rejected.push({ raw: ref.raw, reason: `diploma ausente/não-vigente no corpus: ${ref.diplomaHint}` }); continue; }
    if (!isNormativeCurrent(diploma.status)) { rejected.push({ raw: ref.raw, reason: `diploma com status incompatível (${diploma.status}): ${ref.diplomaHint}` }); continue; }
    const article = diploma.articles.get(articleKey(ref.article));
    if (!article) { rejected.push({ raw: ref.raw, reason: `artigo inexistente no diploma ${ref.diplomaHint}: Art. ${ref.article}` }); continue; }
    // Sub-locator (§/inciso/alínea/item) — validado contra o texto verbatim do artigo (Gap 5).
    const subSegments = ref.segments.slice(1); // remove o "art-N"
    if (subSegments.length > 0 && !verifySubLocatorPath(article.text, subSegments)) {
      rejected.push({ raw: ref.raw, reason: `sub-locator inexistente no ${ref.diplomaHint} Art. ${ref.article}: ${ref.subLocatorPath}` });
      continue;
    }
    const locatorId = canonicalLocatorId(ref.diplomaHint, article.identifier, ...ref.identifier.split(",").slice(1).map((s) => s.trim()));
    if (seenValid.has(locatorId)) continue;
    seenValid.add(locatorId);
    valid.push({ sourceId: ref.diplomaHint, locatorId, display: displayLocator(diploma.title, ref.identifier), status: diploma.status });
  }
  return { valid, rejected };
}

/**
 * Verifica que um locator canônico (path após o sourceId, ex.: "art-18:par-1:inc-ix") EXISTE no corpus e
 * é vigente, com granularidade real. Usado para confirmar as âncoras das seções ANTES da renderização.
 */
export function locatorExistsAndCurrent(index: CorpusLegalIndex, sourceId: string, locatorPath: string): boolean {
  const diploma = index.diplomas.get(sourceId);
  if (!diploma || !isNormativeCurrent(diploma.status)) return false;
  const segs = locatorPath.split(":").filter(Boolean);
  const artSeg = segs.find((s) => s.startsWith("art-"));
  if (!artSeg) return false;
  const article = diploma.articles.get(articleKey(artSeg.replace(/^art-/, "")));
  if (!article) return false;
  const subSegments = segs.filter((s) => !s.startsWith("art-"));
  return subSegments.length === 0 ? true : verifySubLocatorPath(article.text, subSegments);
}

/** A natureza da fonte de um diploma no corpus (normative/manual/jurisprudential/unknown). */
export function sourceKindOf(index: CorpusLegalIndex, sourceId: string): SourceKind {
  return index.diplomas.get(sourceId)?.kind ?? "unknown";
}

/** Reconstrói uma referência estruturada validada para uma âncora canônica (path), quando comprovada. */
export function resolveCanonicalReference(index: CorpusLegalIndex, sourceId: string, locatorPath: string, displayLabel: string): AuthoredLegalReference | null {
  const diploma = index.diplomas.get(sourceId);
  if (!diploma || !isNormativeCurrent(diploma.status)) return null;
  if (!locatorExistsAndCurrent(index, sourceId, locatorPath)) return null;
  return { sourceId, locatorId: `${sourceId}:${locatorPath}`, display: displayLocator(diploma.title, displayLabel), status: diploma.status };
}

export { normalizeDiplomaHint };
