/**
 * Valores canônicos do catálogo v2: NORMALIZAÇÃO (validação do que a fonte entrega) e FORMATAÇÃO determinística pt-BR.
 *
 * Puro e independente de locale: o mesmo valor canônico produz o mesmo texto em qualquer servidor. A normalização nunca
 * "conserta" um valor errado — valor fora do contrato do tipo é recusado (`VALUE_TYPE_INVALID` na composição).
 */
import { formatBRL } from "../money";
import { isSha256 } from "./types";
import {
  DURATION_UNITS, type DurationUnit, type DurationValue, type ScalarType2, type TableColumnDef, type VariableDef2,
} from "./variableCatalog2";

export type NormalizeResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string };

const bad = (reason: string): NormalizeResult => ({ ok: false, reason });
const good = (value: unknown): NormalizeResult => ({ ok: true, value });

/** Guardas técnicas de implementação (não regras jurídicas): limitam o tamanho de um valor canônico. */
export const MAX_TABLE_ROWS = 5000;
export const MAX_LIST_ITEMS = 5000;
const MAX_PLAIN_NUMBER = 1e15;
const MAX_TEXT_CHARS = 200_000;

export function isRealCalendarDate(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d) || m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d <= dim;
}

/** Dígitos verificadores do CNPJ (14 dígitos; rejeita sequências repetidas). */
export function isValidCnpjDigits(digits: string): boolean {
  if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) return false;
  const calc = (len: number): number => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(digits[12]) && calc(13) === Number(digits[13]);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;
const URL_RE = /^https?:\/\/[^\s<>"]+$/i;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Normaliza um valor ESCALAR conforme o tipo do catálogo. */
export function normalizeScalar(type: ScalarType2, raw: unknown): NormalizeResult {
  switch (type) {
    case "string":
    case "text":
      return typeof raw === "string" && raw.length <= MAX_TEXT_CHARS ? good(raw) : bad("esperado texto");
    case "integer":
      return typeof raw === "number" && Number.isSafeInteger(raw) ? good(raw) : bad("esperado inteiro");
    case "number":
      return typeof raw === "number" && Number.isFinite(raw) && Math.abs(raw) < MAX_PLAIN_NUMBER ? good(raw) : bad("esperado número finito");
    case "boolean":
      return typeof raw === "boolean" ? good(raw) : bad("esperado booleano");
    case "money":
      return typeof raw === "number" && Number.isSafeInteger(raw) ? good(raw) : bad("esperado valor em centavos (inteiro)");
    case "percent":
      return typeof raw === "number" && Number.isFinite(raw) && Math.abs(raw) <= 1_000_000 ? good(raw) : bad("esperado percentual (pontos percentuais, número finito)");
    case "date": {
      const m = typeof raw === "string" ? DATE_RE.exec(raw) : null;
      return m && isRealCalendarDate(Number(m[1]), Number(m[2]), Number(m[3])) ? good(raw) : bad("esperada data real AAAA-MM-DD");
    }
    case "time":
      return typeof raw === "string" && TIME_RE.test(raw) ? good(raw) : bad("esperado horário HH:MM");
    case "datetime": {
      const m = typeof raw === "string" ? DATETIME_RE.exec(raw) : null;
      return m && isRealCalendarDate(Number(m[1]), Number(m[2]), Number(m[3])) ? good(raw) : bad("esperado AAAA-MM-DDTHH:MM (horário local, sem fuso)");
    }
    case "url":
      return typeof raw === "string" && URL_RE.test(raw) ? good(raw) : bad("esperada URL http(s)");
    case "cnpj": {
      if (typeof raw !== "string") return bad("esperado CNPJ");
      const digits = raw.replace(/[.\-/]/g, "");
      return isValidCnpjDigits(digits) ? good(digits) : bad("CNPJ inválido (14 dígitos com dígito verificador)");
    }
  }
}

function normalizeDuration(raw: unknown): NormalizeResult {
  if (!isPlainObject(raw) || Object.keys(raw).some((k) => k !== "amount" && k !== "unit")) return bad("esperada duração { amount, unit }");
  if (typeof raw.amount !== "number" || !Number.isSafeInteger(raw.amount) || raw.amount < 0) return bad("duração.amount deve ser inteiro ≥ 0");
  if (!(DURATION_UNITS as readonly unknown[]).includes(raw.unit)) return bad(`duração.unit fora de ${DURATION_UNITS.join("/")}`);
  return good({ amount: raw.amount, unit: raw.unit as DurationUnit } satisfies DurationValue);
}

function normalizeDocumentRef(raw: unknown): NormalizeResult {
  if (!isPlainObject(raw)) return bad("esperado pin de documento oficial");
  const { documentId, lineageId, version, contentHash, title } = raw;
  if (typeof documentId !== "string" || !documentId || typeof lineageId !== "string" || !lineageId
      || typeof version !== "number" || !Number.isSafeInteger(version) || version < 1
      || !isSha256(contentHash) || typeof title !== "string" || !title.trim()) {
    return bad("pin exige documentId + lineageId + version + contentHash + title");
  }
  return good({ documentId, lineageId, version, contentHash, title });
}

export interface TableRowsNormalization {
  readonly ok: true;
  readonly value: readonly Readonly<Record<string, unknown>>[];
}

/** Normaliza as linhas de uma tabela pelo esquema de colunas. Coluna fora do esquema é descartada (nunca renderizável). */
export function normalizeTableRows(columns: readonly TableColumnDef[], raw: unknown): NormalizeResult {
  if (!Array.isArray(raw)) return bad("esperada lista de linhas");
  if (raw.length > MAX_TABLE_ROWS) return bad(`tabela excede ${MAX_TABLE_ROWS} linhas`);
  const rows: Record<string, unknown>[] = [];
  for (let r = 0; r < raw.length; r++) {
    const row = raw[r];
    if (!isPlainObject(row)) return bad(`linha ${r + 1}: esperado objeto`);
    const out: Record<string, unknown> = {};
    for (const col of columns) {
      const cell = Object.prototype.hasOwnProperty.call(row, col.key) ? row[col.key] : undefined;
      if (cell === undefined || cell === null || cell === "") {
        if (col.required !== false) return bad(`linha ${r + 1}: coluna ${col.key} obrigatória ausente`);
        continue;
      }
      const n = normalizeScalar(col.type, cell);
      if (!n.ok) return bad(`linha ${r + 1}, coluna ${col.key}: ${n.reason}`);
      out[col.key] = n.value;
    }
    rows.push(out);
  }
  return good(rows);
}

/** Normaliza o valor canônico de uma variável do catálogo v2 (já sabida PRESENTE). */
export function normalizeValue2(def: VariableDef2, raw: unknown): NormalizeResult {
  switch (def.type) {
    case "enum":
      return typeof raw === "string" && (def.enumValues ?? []).includes(raw) ? good(raw) : bad(`valor fora do conjunto fechado do enum ${def.name}`);
    case "duration":
      return normalizeDuration(raw);
    case "document_ref":
      return normalizeDocumentRef(raw);
    case "table":
      return normalizeTableRows(def.columns ?? [], raw);
    case "list": {
      if (!Array.isArray(raw)) return bad("esperada lista");
      if (raw.length > MAX_LIST_ITEMS) return bad(`lista excede ${MAX_LIST_ITEMS} itens`);
      const out: unknown[] = [];
      for (let i = 0; i < raw.length; i++) {
        const n = normalizeScalar(def.itemType ?? "string", raw[i]);
        if (!n.ok) return bad(`item ${i + 1}: ${n.reason}`);
        out.push(n.value);
      }
      return good(out);
    }
    default:
      return normalizeScalar(def.type as ScalarType2, raw);
  }
}

// ─── Formatação ────────────────────────────────────────────────────────────────────────────────────────────────────

function groupThousands(intDigits: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** pt-BR determinístico: inteiros com milhar (`1.234`), decimais com vírgula e até 6 casas (`1.234,5`). */
export function formatDecimalPtBr(n: number): string {
  const neg = n < 0 ? "-" : "";
  if (Number.isInteger(n)) return `${neg}${groupThousands(String(Math.abs(n)))}`;
  const fixed = Math.abs(n).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  const [i, f] = fixed.split(".");
  return `${neg}${groupThousands(i)}${f ? `,${f}` : ""}`;
}

function inlineText(s: string): string {
  return s.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

export function formatCnpj(digits: string): string {
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

const UNIT_LABELS: Readonly<Record<DurationUnit, readonly [string, string]>> = {
  minute: ["minuto", "minutos"], hour: ["hora", "horas"], day: ["dia", "dias"], businessDay: ["dia útil", "dias úteis"], month: ["mês", "meses"], year: ["ano", "anos"],
};

export function formatDuration(d: DurationValue): string {
  const [one, many] = UNIT_LABELS[d.unit];
  return `${formatDecimalPtBr(d.amount)} ${d.amount === 1 ? one : many}`;
}

export function formatScalar(type: ScalarType2, v: unknown): string {
  switch (type) {
    case "string": case "text": case "url": return inlineText(v as string);
    case "integer": case "number": return formatDecimalPtBr(v as number);
    case "boolean": return v ? "Sim" : "Não";
    case "money": return formatBRL(v as number);
    case "percent": return `${formatDecimalPtBr(v as number)}%`;
    case "date": {
      const m = DATE_RE.exec(v as string)!;
      return `${m[3]}/${m[2]}/${m[1]}`;
    }
    case "time": {
      const m = TIME_RE.exec(v as string)!;
      return `${m[1]}h${m[2]}`;
    }
    case "datetime": {
      const m = DATETIME_RE.exec(v as string)!;
      return `${m[3]}/${m[2]}/${m[1]} às ${m[4]}h${m[5]}`;
    }
    case "cnpj": return formatCnpj(v as string);
  }
}

/** Texto inline de uma variável JÁ normalizada. `table` nunca é inline (só por `dataTable`). */
export function formatValue2(def: VariableDef2, v: unknown): string {
  switch (def.type) {
    case "enum": return inlineText(v as string);
    case "duration": return formatDuration(v as DurationValue);
    case "document_ref": {
      const d = v as { title: string; version: number };
      return `${inlineText(d.title)}, versão ${d.version}`;
    }
    case "list": return (v as unknown[]).map((x) => formatScalar(def.itemType ?? "string", x)).join("; ");
    case "table": return "";
    default: return formatScalar(def.type as ScalarType2, v);
  }
}
