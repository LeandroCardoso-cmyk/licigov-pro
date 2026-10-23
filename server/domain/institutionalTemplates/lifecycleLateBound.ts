/**
 * CAMPOS DE SISTEMA LATE-BOUND (ciclo de vida) — PR #288 (final amend).
 *
 * `processo.dataEmissaoEdital` significa a DATA DO ATO REAL DE EMISSÃO OFICIAL ("Atribuída na emissão"), e não a data da composição (M1),
 * da edição, do preflight nem da aprovação humana. No M1 essa data AINDA NÃO EXISTE: o composer NÃO a fabrica; renderiza um marcador
 * INTERNO, determinístico e protegido, e o M1 registra o campo como `PENDING_OFFICIAL_ISSUANCE` (autoridade `LIFECYCLE_SYSTEM`). Só o
 * ato oficial de emissão materializa o valor (instante da emissão → AAAA-MM-DD em America/Sao_Paulo), ANTES do conteúdo oficial final e
 * do seu hash. A transformação é do lifecycle (explicável no M2: variável, valor, instante, hash antes/depois), nunca edição humana.
 *
 * Puro e determinístico (sem I/O, sem relógio): quem chama informa o instante e a data.
 */
import { sha256Hex } from "../canonicalJson";
import { findVariable2 } from "./variableCatalog2";
import type { VariableCatalog2, VariableDef2 } from "./variableCatalog2";
import { formatValue2, normalizeValue2 } from "./valueTypes2";
import type { Sha256 } from "./types";

export type LateBoundKind = "ISSUANCE_DATE";

export interface LateBoundSpec {
  readonly kind: LateBoundKind;
  readonly authority: "LIFECYCLE_SYSTEM";
  readonly source: "LIFECYCLE";
  readonly label: string;
  /** Texto amigável da revisão humana (nunca a data, que ainda não existe). */
  readonly pendingMessage: string;
}

/** Variáveis cujo valor é atribuído pelo ciclo de vida OFICIAL (não pela composição). Chave = nome no catálogo. */
export const LATE_BOUND_VARIABLES: Readonly<Record<string, LateBoundSpec>> = Object.freeze({
  "processo.dataEmissaoEdital": {
    kind: "ISSUANCE_DATE", authority: "LIFECYCLE_SYSTEM", source: "LIFECYCLE", label: "Data de emissão",
    pendingMessage: "será atribuída automaticamente no ato da emissão oficial",
  },
});

/** Só vale para a variável DECLARADA com a fonte esperada (o catálogo publicado não é alterado). */
export const isLateBoundVariable = (def: Pick<VariableDef2, "name" | "source">): boolean => LATE_BOUND_VARIABLES[def.name]?.source === def.source;

export const LATE_BOUND_PENDING = "PENDING_OFFICIAL_ISSUANCE" as const;

/** Registro do M1: o campo existe, é do sistema e ainda não foi materializado. */
export interface LateBoundRef {
  readonly variable: string;
  readonly authority: "LIFECYCLE_SYSTEM";
  readonly status: typeof LATE_BOUND_PENDING;
}

/** Registro do M2: como o ato oficial materializou o campo (explicável e reproduzível). */
export interface LifecycleBinding {
  readonly variable: string;
  readonly authority: "LIFECYCLE_SYSTEM";
  readonly value: string;
  /** Instante do ato oficial de emissão (ISO-8601 UTC). */
  readonly issuedAt: string;
  readonly beforeContentHash: Sha256;
  readonly afterContentHash: Sha256;
}

/** Marcador INTERNO e exclusivo (não é `[REVISAR]`, não é narrativa de IA, não é pendência humana). */
export const lateBoundMarker = (variable: string): string => `[[SYSTEM_LATE_BOUND:${variable}]]`;
const MARKER_RE = /\[\[SYSTEM_LATE_BOUND:([A-Za-z0-9_.]+)\]\]/g;

/** Texto legível que substitui o marcador APENAS na apresentação/exportação de uma MINUTA (o conteúdo persistido e seu hash não mudam). */
export const LATE_BOUND_DISPLAY_TEXT = "(data atribuída automaticamente na emissão oficial)";

/** Minuta para leitura humana (DOCX/PDF de rascunho): troca cada marcador interno pelo texto legível. Nunca usado na emissão oficial. */
export function displayLateBoundForDraft(text: string): string {
  return text.replace(MARKER_RE, LATE_BOUND_DISPLAY_TEXT);
}

/** Ocorrências de marcadores por variável (qualquer marcador, inclusive de variável que não é late-bound). */
export function lateBoundCounts(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of text.matchAll(MARKER_RE)) out.set(m[1], (out.get(m[1]) ?? 0) + 1);
  return out;
}

/**
 * Integridade dos marcadores no conteúdo a emitir contra o que o M1 registrou: cada variável late-bound do M1 aparece EXATAMENTE
 * tantas vezes quanto no texto composto, e nenhuma outra variável tem marcador (forja/inserção).
 */
export function lateBoundTamperIssues(m1Refs: readonly LateBoundRef[], composedText: string, issuedContent: string): string[] {
  const composed = lateBoundCounts(composedText);
  const issued = lateBoundCounts(issuedContent);
  const known = new Set(m1Refs.map((r) => r.variable));
  const out: string[] = [];
  for (const v of known) if ((issued.get(v) ?? 0) !== (composed.get(v) ?? 0)) out.push(`${v}: marcador alterado, removido ou duplicado`);
  for (const v of issued.keys()) if (!known.has(v)) out.push(`${v}: marcador de sistema não registrado no M1`);
  return out;
}

export type BindResult =
  | { readonly ok: true; readonly text: string; readonly bindings: readonly LifecycleBinding[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Materializa os campos late-bound do M1 no ATO de emissão: `issuanceDate` (AAAA-MM-DD) já derivada do instante oficial. A formatação
 * é a MESMA do composer (`formatValue2` do tipo do catálogo). Cada passo registra hash antes/depois (cadeia contígua).
 * Qualquer marcador remanescente ⇒ falha (o oficial nunca contém marcador).
 */
export function bindLifecycleVariables(
  content: string, catalog: VariableCatalog2, refs: readonly LateBoundRef[], issuedAt: string, issuanceDate: string,
): BindResult {
  let text = content;
  const bindings: LifecycleBinding[] = [];
  for (const ref of [...refs].sort((a, b) => (a.variable < b.variable ? -1 : a.variable > b.variable ? 1 : 0))) {
    const spec = LATE_BOUND_VARIABLES[ref.variable];
    const def = findVariable2(catalog, ref.variable);
    if (!spec || !def || !isLateBoundVariable(def)) return { ok: false, reason: `${ref.variable} não é um campo de sistema late-bound` };
    const norm = normalizeValue2(def, issuanceDate);
    if (!norm.ok) return { ok: false, reason: `${ref.variable}: ${norm.reason}` };
    const marker = lateBoundMarker(ref.variable);
    if (!text.includes(marker)) return { ok: false, reason: `${ref.variable}: marcador ausente no conteúdo a emitir` };
    const next = text.split(marker).join(formatValue2(def, norm.value));
    bindings.push({ variable: ref.variable, authority: spec.authority, value: issuanceDate, issuedAt, beforeContentHash: sha256Hex(text), afterContentHash: sha256Hex(next) });
    text = next;
  }
  if (lateBoundCounts(text).size > 0) return { ok: false, reason: "marcador de sistema remanescente após a materialização" };
  return { ok: true, text, bindings };
}
