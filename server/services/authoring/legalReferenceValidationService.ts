/**
 * V1 PRE-PILOT CLOSURE — Fase A2 — Validação de referências jurídicas CONTRA O CORPUS REAL.
 *
 * Guarda anti-alucinação: uma referência legal citada (ex.: "Art. 18 da Lei 14.133/2021") só é
 * PROMOVIDA a referência estruturada quando (1) o diploma EXISTE no corpus, (2) o locator (artigo)
 * EXISTE naquele diploma e (3) o status temporal PERMITE fundamentar (vigente/parcialmente vigente).
 * NÃO usa faixas numéricas mágicas — verifica EXISTÊNCIA no texto oficial incorporado. Determinístico.
 *
 * Um artigo inventado (não existe no diploma) é REJEITADO. Um diploma revogado ou ausente do corpus
 * (ex.: Lei 8.666/1993, que não é fonte vigente para uma contratação regida pela 14.133) é REJEITADO.
 * A decisão é registrada como limitação — nunca silenciosamente "escolhida" pelo modelo.
 */

import type { OfficialCorpusBuildResult } from "../officialCorpus/officialCorpusBuilder";
import { allBlocks } from "../../domain/knowledge/knowledgeDocument";
import { canonicalLocatorId, displayLocator, normalizeDiplomaHint, parseLegalReferences } from "../../domain/institutionalIntegration/canonicalLocator";
import { isCurrentStatus } from "../../domain/institutionalIntegration/evidenceFromContext";
import type { AuthoredLegalReference } from "../../domain/authoring/authoringSchema";

/** Índice determinístico do corpus para verificação de EXISTÊNCIA de artigo por diploma. */
export interface CorpusLegalIndex {
  /** normId → { status, title, articles: chave-normalizada → identificador legível }. */
  readonly diplomas: ReadonlyMap<string, { status: string; title: string; articles: ReadonlyMap<string, string> }>;
}

/** Extrai a chave de artigo estável de um identificador ("Art. 18º" | "18" | "Art. 6-A") → "18" | "6-a". */
function articleKey(identifier: string): string {
  const m = (identifier ?? "").toLowerCase().replace(/[º°]/g, "").match(/(\d+)\s*(-?\s*[a-z])?/);
  if (!m) return "";
  return `${m[1]}${m[2] ? "-" + m[2].replace(/[-\s]/g, "") : ""}`;
}

/** Constrói o índice legal a partir do corpus REAL incorporado (verbatim). Puro/determinístico. */
export function buildCorpusLegalIndex(corpus: OfficialCorpusBuildResult): CorpusLegalIndex {
  const diplomas = new Map<string, { status: string; title: string; articles: Map<string, string> }>();
  for (const doc of corpus.ingested) {
    const normId = doc.official.normId;
    const entry = diplomas.get(normId) ?? { status: doc.official.status, title: doc.official.title, articles: new Map<string, string>() };
    for (const block of allBlocks(doc.knowledgeDocument)) {
      if (block.kind !== "OfficialText") continue;
      const identifier = String((block.metadata as { identifier?: unknown })?.identifier ?? block.title ?? "");
      const key = articleKey(identifier);
      if (key && !entry.articles.has(key)) entry.articles.set(key, identifier);
    }
    diplomas.set(normId, entry);
  }
  return { diplomas };
}

export interface LegalReferenceValidationResult {
  /** Referências CITADAS e comprovadas no corpus (diploma + artigo existem, status permite). */
  readonly valid: readonly AuthoredLegalReference[];
  /** Referências citadas REJEITADAS (diploma ausente/revogado ou artigo inexistente) + motivo. */
  readonly rejected: readonly { readonly raw: string; readonly reason: string }[];
}

/**
 * Valida as referências jurídicas CITADAS num texto (prosa autorada) contra o corpus. Só promove as
 * comprovadas; rejeita as inexistentes/incompatíveis. Referência sem diploma identificável é ignorada
 * (não comprovável, mas também não fabricada). Determinística e sem I/O externo.
 */
export function validateCitedLegalReferences(index: CorpusLegalIndex, text: string): LegalReferenceValidationResult {
  const valid: AuthoredLegalReference[] = [];
  const rejected: { raw: string; reason: string }[] = [];
  const seenValid = new Set<string>();
  for (const ref of parseLegalReferences(text)) {
    if (!ref.diplomaHint) continue; // sem diploma identificável → não comprovável (não fabricar, não rejeitar)
    const diploma = index.diplomas.get(ref.diplomaHint);
    if (!diploma) {
      rejected.push({ raw: ref.raw, reason: `diploma ausente/não-vigente no corpus: ${ref.diplomaHint}` });
      continue;
    }
    if (!isCurrentStatus(diploma.status)) {
      rejected.push({ raw: ref.raw, reason: `diploma com status incompatível (${diploma.status}): ${ref.diplomaHint}` });
      continue;
    }
    const key = articleKey(ref.article);
    const identifier = diploma.articles.get(key);
    if (!identifier) {
      rejected.push({ raw: ref.raw, reason: `artigo inexistente no diploma ${ref.diplomaHint}: Art. ${ref.article}` });
      continue;
    }
    const locatorId = canonicalLocatorId(ref.diplomaHint, identifier);
    if (seenValid.has(locatorId)) continue;
    seenValid.add(locatorId);
    valid.push({ sourceId: ref.diplomaHint, locatorId, display: displayLocator(diploma.title, identifier), status: diploma.status });
  }
  return { valid, rejected };
}

/**
 * Verifica que um locator canônico (sourceId + identificador) EXISTE no corpus e é vigente. Usado para
 * confirmar as âncoras legais das seções canônicas ANTES da renderização (rejeita âncora não comprovada).
 */
export function locatorExistsAndCurrent(index: CorpusLegalIndex, sourceId: string, articleIdentifier: string): boolean {
  const diploma = index.diplomas.get(sourceId);
  if (!diploma || !isCurrentStatus(diploma.status)) return false;
  return diploma.articles.has(articleKey(articleIdentifier));
}

/** Reconstrói uma referência estruturada validada para uma âncora canônica (quando comprovada). */
export function resolveCanonicalReference(index: CorpusLegalIndex, sourceId: string, articleIdentifier: string): AuthoredLegalReference | null {
  const diploma = index.diplomas.get(sourceId);
  if (!diploma || !isCurrentStatus(diploma.status)) return null;
  const identifier = diploma.articles.get(articleKey(articleIdentifier));
  if (!identifier) return null;
  return { sourceId, locatorId: canonicalLocatorId(sourceId, identifier), display: displayLocator(diploma.title, identifier), status: diploma.status };
}

/** Normaliza uma citação de diploma em texto → normId (reexport utilitário p/ callers de autoria). */
export { normalizeDiplomaHint };
