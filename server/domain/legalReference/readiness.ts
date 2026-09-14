/**
 * A3-RD1 — Readiness & resolução temporal GOVERNADA (fail-closed) da referência jurídica.
 *
 * Lógica PURA (sem DB) e determinística: dados os candidatos (sets/overrides) e uma data,
 * resolve EXATAMENTE UM ou devolve o código diagnóstico correto. Nunca "mais próximo",
 * nunca "hoje" implícito. Contrato: F-LEGAL1.1 §3/§7/§8.
 */

/** Códigos diagnósticos estruturados (handoff §11). */
export type LegalReferenceCode =
  | "LEGAL_REFERENCE_SET_MISSING"
  | "LEGAL_REFERENCE_SET_NOT_APPROVED"
  | "LEGAL_REFERENCE_EMPTY"
  | "LEGAL_REFERENCE_NOT_FOUND"
  | "LEGAL_REFERENCE_UNSUPPORTED"
  | "LEGAL_REFERENCE_AMBIGUOUS"
  | "LEGAL_REFERENCE_VERSION_GAP"
  | "LEGAL_REFERENCE_TEMPORAL_OVERLAP"
  | "LEGAL_VALUE_OVERRIDE_MISSING"
  | "LEGAL_REFERENCE_SOURCE_UNVERIFIED"
  | "LEGAL_REFERENCE_CONTENT_HASH_INVALID";

/** Erro governado fail-closed carregando o código diagnóstico. */
export class LegalReferenceError extends Error {
  readonly code: LegalReferenceCode;
  constructor(code: LegalReferenceCode, message?: string) {
    super(message ?? code);
    this.name = "LegalReferenceError";
    this.code = code;
  }
}

/** Data ISO `YYYY-MM-DD`. Comparação lexicográfica === cronológica (formato fixo). */
export type IsoDate = string;

export interface TemporalWindow {
  readonly effectiveFrom: IsoDate;
  readonly effectiveTo: IsoDate | null; // null = aberto/vigente
}

/** Intervalo SEMIABERTO [from, to): a data de corte pertence ao período novo. */
export function windowContains(w: TemporalWindow, asOf: IsoDate): boolean {
  if (asOf < w.effectiveFrom) return false;
  if (w.effectiveTo === null) return true;
  return asOf < w.effectiveTo;
}

/**
 * Resolve EXATAMENTE UM candidato cujo intervalo contém `asOf`.
 * 0 → `gapCode`; 1 → o candidato; ≥2 → `overlapCode`. Fail-closed em ambos os extremos.
 */
export function resolveExactlyOne<T extends TemporalWindow>(
  candidates: readonly T[],
  asOf: IsoDate,
  gapCode: LegalReferenceCode,
  overlapCode: LegalReferenceCode,
): T {
  const matches = candidates.filter((c) => windowContains(c, asOf));
  if (matches.length === 0) throw new LegalReferenceError(gapCode, `Nenhum registro vigente em ${asOf}.`);
  if (matches.length > 1) throw new LegalReferenceError(overlapCode, `Sobreposição temporal em ${asOf} (${matches.length} registros).`);
  return matches[0];
}

/** Formato mínimo do coverageManifest persistido no set. */
export interface CoverageManifestShape {
  readonly supportedLocators?: readonly string[];
  readonly temporal?: { readonly effectiveFrom?: string; readonly effectiveTo?: string | null };
}

/** true se o locator está DENTRO da cobertura declarada. */
export function isLocatorSupported(coverage: CoverageManifestShape | null | undefined, locator: string): boolean {
  const list = coverage?.supportedLocators;
  return Array.isArray(list) && list.includes(locator);
}
