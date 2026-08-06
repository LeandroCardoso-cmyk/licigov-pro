/**
 * PR B.2.2 — Allowlist EXPLÍCITA de campos corrigíveis por importType (pura e testável).
 *
 * A correção humana é um OVERLAY validado sobre os `raw*` IMUTÁVEIS do staging. Só os campos
 * declarados aqui podem ser corrigidos; qualquer outra chave (provenance, raw, metadados) é
 * rejeitada. Nomes lógicos mapeiam para as colunas reais do staging (rawKey).
 *
 * importTypes sem contrato de correção → capacidade indisponível (não aceitam patch genérico).
 */

export type CorrectionFieldKind = "text" | "decimal" | "unit";

export interface CorrectionFieldSpec {
  logical:  string;   // nome lógico exposto na correção
  rawKey:   "rawDescription" | "rawQuantity" | "rawUnit" | "rawUnitPrice" | "rawTotalPrice";
  kind:     CorrectionFieldKind;
  maxLen:   number;
  nullable: boolean;
}

/** Contrato de correção por importType. Ausência ⇒ correção indisponível para o tipo. */
export const CORRECTABLE_FIELDS: Record<string, Record<string, CorrectionFieldSpec>> = {
  price_research: {
    description: { logical: "description", rawKey: "rawDescription", kind: "text",    maxLen: 2000, nullable: false },
    quantity:    { logical: "quantity",    rawKey: "rawQuantity",    kind: "decimal", maxLen: 100,  nullable: false },
    unit:        { logical: "unit",        rawKey: "rawUnit",        kind: "unit",    maxLen: 50,   nullable: false },
    unitPrice:   { logical: "unitPrice",   rawKey: "rawUnitPrice",   kind: "decimal", maxLen: 100,  nullable: false },
    totalPrice:  { logical: "totalPrice",  rawKey: "rawTotalPrice",  kind: "decimal", maxLen: 100,  nullable: true  },
  },
};

export function isImportTypeCorrectable(importType: string): boolean {
  return Object.prototype.hasOwnProperty.call(CORRECTABLE_FIELDS, importType);
}

/** Mapa logical→rawKey para computar o conteúdo efetivo (raw + overlay). */
export function logicalToRawKey(importType: string): Record<string, string> {
  const specs = CORRECTABLE_FIELDS[importType] ?? {};
  const out: Record<string, string> = {};
  for (const spec of Object.values(specs)) out[spec.logical] = spec.rawKey;
  return out;
}

// ─── Normalização por tipo ───────────────────────────────────────────────────────

function normalizeText(v: string, max: number): string {
  return v.replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Normaliza número em pt-BR ou en-US para string canônica ("1234.56").
 * Aceita "1.234,56", "1234,56", "1234.56", "1234". Rejeita não-numérico.
 */
export function normalizeDecimal(v: string): string | null {
  const raw = v.trim();
  if (raw === "") return null;
  let s = raw.replace(/[^\d.,-]/g, "");
  if (s === "" || s === "-" || s === "." || s === ",") return null;
  if (s.includes(",") && s.includes(".")) {
    // separador decimal = o ÚLTIMO símbolo; o outro é agrupador de milhar.
    s = s.lastIndexOf(",") > s.lastIndexOf(".")
      ? s.replace(/\./g, "").replace(",", ".")
      : s.replace(/,/g, "");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return String(n);
}

export type FieldValidation =
  | { ok: true; value: string | null }
  | { ok: false; code: string; message: string };

export function validateField(spec: CorrectionFieldSpec, input: unknown): FieldValidation {
  if (input === null) {
    if (spec.nullable) return { ok: true, value: null };
    return { ok: false, code: "NOT_NULLABLE", message: `Campo "${spec.logical}" não pode ser vazio.` };
  }
  if (typeof input !== "string" && typeof input !== "number") {
    return { ok: false, code: "INVALID_TYPE", message: `Campo "${spec.logical}" deve ser texto ou número.` };
  }
  const str = String(input);
  if (str.length > spec.maxLen) {
    return { ok: false, code: "TOO_LONG", message: `Campo "${spec.logical}" excede ${spec.maxLen} caracteres.` };
  }
  if (spec.kind === "decimal") {
    const norm = normalizeDecimal(str);
    if (norm === null) return { ok: false, code: "INVALID_NUMBER", message: `Campo "${spec.logical}" deve ser numérico.` };
    return { ok: true, value: norm };
  }
  const text = normalizeText(str, spec.maxLen);
  if (text === "" && !spec.nullable) {
    return { ok: false, code: "NOT_NULLABLE", message: `Campo "${spec.logical}" não pode ser vazio.` };
  }
  return { ok: true, value: text };
}

export type CorrectionsValidation =
  | { ok: true; overlay: Record<string, string | null>; changedFields: string[] }
  | { ok: false; code: string; message: string; field?: string };

/**
 * Valida um patch de correção contra a allowlist do importType. Rejeita tipo não corrigível,
 * patch vazio, campos desconhecidos (raw e provenance) e valores inválidos. Retorna o overlay
 * NORMALIZADO (chaveado por nome lógico) pronto para mesclar em correctedPayload.
 */
/**
 * Conteúdo EFETIVO = raw* imutável + overlay de correção (overlay vence). Puro/testável.
 * `item` traz os raw* e o `correctedPayload` (overlay por nome lógico).
 */
export function computeEffectiveContent(
  item: Record<string, unknown> & { correctedPayload?: unknown },
  importType: string,
): Record<string, string | null> {
  const specs = CORRECTABLE_FIELDS[importType] ?? {};
  const overlay = (item.correctedPayload && typeof item.correctedPayload === "object"
    ? item.correctedPayload as Record<string, string | null>
    : {});
  const out: Record<string, string | null> = {};
  for (const spec of Object.values(specs)) {
    out[spec.logical] = Object.prototype.hasOwnProperty.call(overlay, spec.logical)
      ? overlay[spec.logical]
      : ((item[spec.rawKey] as string | null | undefined) ?? null);
  }
  return out;
}

export function validateCorrections(importType: string, corrections: unknown): CorrectionsValidation {
  const specs = CORRECTABLE_FIELDS[importType];
  if (!specs) {
    return { ok: false, code: "CAPABILITY_UNAVAILABLE", message: `Correção não disponível para o tipo "${importType}".` };
  }
  if (corrections == null || typeof corrections !== "object" || Array.isArray(corrections)) {
    return { ok: false, code: "INVALID_PATCH", message: "Correção inválida." };
  }
  const entries = Object.entries(corrections as Record<string, unknown>);
  if (entries.length === 0) {
    return { ok: false, code: "EMPTY", message: "Nenhuma correção informada." };
  }
  const overlay: Record<string, string | null> = {};
  const changedFields: string[] = [];
  for (const [key, value] of entries) {
    const spec = specs[key];
    if (!spec) {
      return { ok: false, code: "UNKNOWN_FIELD", message: `Campo não permitido: "${key}".`, field: key };
    }
    const r = validateField(spec, value);
    if (!r.ok) return { ok: false, code: r.code, message: r.message, field: key };
    overlay[key] = r.value;
    changedFields.push(key);
  }
  return { ok: true, overlay, changedFields };
}
