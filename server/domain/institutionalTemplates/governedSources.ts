/**
 * Fontes canônicas GOVERNADAS por decisão institucional (Institutional Templates — multi-modelo).
 *
 * Algumas autoridades do Edital não existem como dado estruturado no domínio e SÃO decisões humanas do órgão:
 *  - CERTAME_CONFIG  configuração decidida do certame (modo de disputa, datas/horários, casas decimais, intervalo mínimo,
 *                    duração da etapa, prorrogação, regra aberto/fechado, janelas operacionais, regime de participação);
 *  - POLICY          política institucional vigente do órgão (chave → valores escalares);
 *  - BUDGET          divulgação do orçamento (público | sigiloso) — governa se valores aparecem no documento.
 * Todas são gravadas no ledger EXISTENTE `institutional_decisions` (append-only, revisão monotônica com CAS, idempotência,
 * autoridade DECLARADA e `NOT_VALIDATED_POLICY_PENDING`): nenhum segundo ledger. O conteúdo estruturado viaja em `evidence`
 * como `schema:<contrato>` + `payload:<JSON canônico>` + `hash:<sha256>`; a leitura RECALCULA o hash (adulteração ⇒ fail-closed).
 *
 * O LiciGov NÃO cadastra o certame em nenhuma plataforma (BLL ou outra): esta configuração é a DECISÃO do órgão registrada
 * no sistema, insumo do documento. Nenhum valor é hardcoded por plataforma — plataforma é só o `platform` do binding.
 * Puro, determinístico, sem I/O.
 */
import { fail, issue, ok, type TemplateIssue, type TemplateResult } from "./types";
import { templateCanonicalJson, templateHash } from "./semanticHash";

export const CERTAME_CONFIG_SCHEMA = "certame-config/1";
export const POLICY_PAYLOAD_SCHEMA = "institutional-policy/1";
export const BUDGET_DISCLOSURES = ["publico", "sigiloso"] as const;
export type BudgetDisclosure = (typeof BUDGET_DISCLOSURES)[number];

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Nome de marco do cronograma: identificador endereçável por caminho de catálogo (`[a-z0-9_]`, sem hífen). */
const MILESTONE_RE = /^[a-z][a-z0-9_]{0,47}$/;
const IDENT_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_ENTRIES = 50;
const MAX_TEXT = 500;

// ─── Configuração do certame ─────────────────────────────────────────────────────────────────────────────────────

export interface MinimumBidInterval { readonly kind: "AMOUNT_CENTS" | "PERCENT_BP"; readonly value: number }
export interface ScheduleMilestone { readonly date: string; readonly time?: string }
export interface OperationalWindow { readonly key: string; readonly startTime: string; readonly endTime: string }

export interface CertameConfig {
  readonly schema: typeof CERTAME_CONFIG_SCHEMA;
  /** Modo de disputa (slug livre, ex.: aberto, aberto-fechado): a plataforma/regra é do órgão, não do código. */
  readonly disputeMode?: string;
  /** Regra aberto/fechado (slug livre). */
  readonly openClosedRule?: string;
  readonly decimalPlaces?: number;
  readonly minimumBidInterval?: MinimumBidInterval;
  readonly stageDurationMinutes?: number;
  readonly extensionRule?: string;
  readonly extensionMinutes?: number;
  /** Marcos nomeados (identificador `[a-z0-9_]`, endereçável pelo catálogo) → data (AAAA-MM-DD) e hora opcional (HH:MM). */
  readonly schedule?: Readonly<Record<string, ScheduleMilestone>>;
  readonly operationalWindows?: readonly OperationalWindow[];
  /** Regime de participação declarado: padrão + por lote (código do lote) + por item (id canônico). Item > lote > padrão. */
  readonly participation?: {
    readonly default?: string;
    readonly byLot?: Readonly<Record<string, string>>;
    readonly byItem?: Readonly<Record<string, string>>;
  };
}

const CERTAME_KEYS = new Set([
  "schema", "disputeMode", "openClosedRule", "decimalPlaces", "minimumBidInterval", "stageDurationMinutes", "extensionRule",
  "extensionMinutes", "schedule", "operationalWindows", "participation",
]);

const bad = (path: string, message: string): TemplateIssue => issue("SOURCE_PAYLOAD_INVALID", path, message);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const posInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

function slugIssue(path: string, v: unknown): TemplateIssue[] {
  return typeof v === "string" && SLUG_RE.test(v) && v.length <= 64 ? [] : [bad(path, "slug inválido (a-z, 0-9 e hífens, até 64)")];
}

/** Contrato FECHADO `certame-config/1`: chave desconhecida é recusada (nada entra "por acidente"). */
export function validateCertameConfig(raw: unknown): TemplateResult<CertameConfig> {
  if (!isObj(raw)) return fail([bad("", "configuração do certame deve ser um objeto")]);
  const issues: TemplateIssue[] = [];
  for (const k of Object.keys(raw)) if (!CERTAME_KEYS.has(k)) issues.push(bad(k, `campo fora do contrato ${CERTAME_CONFIG_SCHEMA}: ${k}`));
  if (raw.schema !== CERTAME_CONFIG_SCHEMA) issues.push(bad("schema", `schema deve ser ${CERTAME_CONFIG_SCHEMA}`));
  for (const k of ["disputeMode", "openClosedRule", "extensionRule"] as const) if (raw[k] !== undefined) issues.push(...slugIssue(k, raw[k]));
  if (raw.decimalPlaces !== undefined && !(typeof raw.decimalPlaces === "number" && Number.isInteger(raw.decimalPlaces) && raw.decimalPlaces >= 0 && raw.decimalPlaces <= 4)) {
    issues.push(bad("decimalPlaces", "casas decimais deve ser inteiro entre 0 e 4"));
  }
  for (const k of ["stageDurationMinutes", "extensionMinutes"] as const) if (raw[k] !== undefined && !posInt(raw[k])) issues.push(bad(k, "deve ser inteiro positivo (minutos)"));
  if (raw.minimumBidInterval !== undefined) {
    const m = raw.minimumBidInterval;
    if (!isObj(m) || (m.kind !== "AMOUNT_CENTS" && m.kind !== "PERCENT_BP") || !posInt(m.value) || Object.keys(m).some((k) => k !== "kind" && k !== "value")) {
      issues.push(bad("minimumBidInterval", "intervalo mínimo deve ser { kind: AMOUNT_CENTS | PERCENT_BP, value: inteiro > 0 }"));
    }
  }
  if (raw.schedule !== undefined) {
    if (!isObj(raw.schedule) || Object.keys(raw.schedule).length > 20) issues.push(bad("schedule", "cronograma deve ser objeto com até 20 marcos"));
    else {
      for (const [key, m] of Object.entries(raw.schedule)) {
        if (!MILESTONE_RE.test(key)) issues.push(bad(`schedule.${key}`, "nome do marco inválido (minúsculas, dígitos e _; começa por letra; até 48)"));
        if (!isObj(m) || typeof m.date !== "string" || !DATE_RE.test(m.date) || Number.isNaN(Date.parse(`${m.date}T00:00:00Z`))
          || (m.time !== undefined && !(typeof m.time === "string" && TIME_RE.test(m.time))) || Object.keys(m).some((k) => k !== "date" && k !== "time")) {
          issues.push(bad(`schedule.${key}`, "marco deve ser { date: AAAA-MM-DD, time?: HH:MM }"));
        }
      }
    }
  }
  if (raw.operationalWindows !== undefined) {
    if (!Array.isArray(raw.operationalWindows) || raw.operationalWindows.length > 20) issues.push(bad("operationalWindows", "janelas deve ser lista com até 20"));
    else {
      const keys = new Set<string>();
      raw.operationalWindows.forEach((w, i) => {
        const p = `operationalWindows[${i}]`;
        if (!isObj(w) || typeof w.key !== "string" || !SLUG_RE.test(w.key) || typeof w.startTime !== "string" || !TIME_RE.test(w.startTime)
          || typeof w.endTime !== "string" || !TIME_RE.test(w.endTime) || w.startTime >= w.endTime || Object.keys(w).some((k) => !["key", "startTime", "endTime"].includes(k))) {
          issues.push(bad(p, "janela deve ser { key: slug, startTime: HH:MM, endTime: HH:MM > início }"));
        } else if (keys.has(w.key)) issues.push(bad(p, `janela duplicada: ${w.key}`));
        else keys.add(w.key);
      });
    }
  }
  if (raw.participation !== undefined) {
    const p = raw.participation;
    if (!isObj(p) || Object.keys(p).some((k) => !["default", "byLot", "byItem"].includes(k))) issues.push(bad("participation", "participação deve ter apenas default, byLot e byItem"));
    else {
      if (p.default !== undefined) issues.push(...slugIssue("participation.default", p.default));
      for (const k of ["byLot", "byItem"] as const) {
        const m = p[k];
        if (m === undefined) continue;
        if (!isObj(m) || Object.keys(m).length > 200) issues.push(bad(`participation.${k}`, "mapa inválido (até 200 entradas)"));
        else for (const [ref, regime] of Object.entries(m)) {
          if (ref.trim() === "" || ref.length > 64) issues.push(bad(`participation.${k}.${ref}`, "referência vazia ou longa demais"));
          issues.push(...slugIssue(`participation.${k}.${ref}`, regime));
        }
      }
    }
  }
  return issues.length ? fail(issues) : ok(raw as unknown as CertameConfig);
}

/** Regime de participação declarado para um item: item > lote > padrão; ausente ⇒ `null` (nunca inferido). */
export function participationRegimeFor(config: CertameConfig | null, ref: { readonly itemKey: string; readonly lotCode: string | null }): string | null {
  const p = config?.participation;
  if (!p) return null;
  return p.byItem?.[ref.itemKey] ?? (ref.lotCode ? p.byLot?.[ref.lotCode] : undefined) ?? p.default ?? null;
}

// ─── Política institucional e divulgação do orçamento ────────────────────────────────────────────────────────────

/** Chave de política: identificador seguro para caminho de catálogo (`[A-Za-z0-9_]`). */
export const POLICY_KEY_RE = /^[a-z][a-z0-9_]{0,47}$/;
export type PolicyScalar = string | number | boolean;

/** Payload de política: objeto PLANO de escalares (sem aninhamento, sem null), chaves seguras para caminho. */
export function validatePolicyPayload(raw: unknown): TemplateResult<Readonly<Record<string, PolicyScalar>>> {
  if (!isObj(raw)) return fail([bad("", "política deve ser um objeto plano")]);
  const entries = Object.entries(raw);
  const issues: TemplateIssue[] = [];
  if (entries.length === 0 || entries.length > MAX_ENTRIES) issues.push(bad("", `política deve ter de 1 a ${MAX_ENTRIES} campos`));
  for (const [k, v] of entries) {
    if (!IDENT_RE.test(k)) issues.push(bad(k, "nome de campo inválido (letras, dígitos e _)"));
    if (typeof v === "string") { if (v.trim() === "" || v.length > MAX_TEXT) issues.push(bad(k, `texto vazio ou acima de ${MAX_TEXT} caracteres`)); }
    else if (typeof v === "number") { if (!Number.isFinite(v)) issues.push(bad(k, "número deve ser finito")); }
    else if (typeof v !== "boolean") issues.push(bad(k, "valor deve ser texto, número ou booleano (sem aninhamento)"));
  }
  return issues.length ? fail(issues) : ok(raw as Readonly<Record<string, PolicyScalar>>);
}

// ─── Codec do payload em `evidence` (ledger existente) ───────────────────────────────────────────────────────────

export interface EncodedPayload { readonly evidence: string[]; readonly hash: string }

/** `evidence = [schema:<s>, payload:<JSON canônico>, hash:<sha256 do payload canônico>]` (uma linha cada). */
export function encodeGovernedPayload(schema: string, payload: unknown): EncodedPayload {
  const json = templateCanonicalJson(payload);
  const hash = templateHash(payload);
  return { evidence: [`schema:${schema}`, `payload:${json}`, `hash:${hash}`], hash };
}

/** Decodifica e VERIFICA a integridade: schema esperado, JSON válido e hash recalculado. Qualquer divergência ⇒ `null`. */
export function decodeGovernedPayload(evidence: readonly string[], expectedSchema: string): { payload: unknown; hash: string } | null {
  const pick = (name: string) => evidence.find((e) => e.startsWith(`${name}:`))?.slice(name.length + 1) ?? null;
  const schema = pick("schema"), json = pick("payload"), hash = pick("hash");
  if (schema !== expectedSchema || json === null || hash === null) return null;
  let payload: unknown;
  try { payload = JSON.parse(json); } catch { return null; }
  return templateHash(payload) === hash && templateCanonicalJson(payload) === json ? { payload, hash } : null;
}
