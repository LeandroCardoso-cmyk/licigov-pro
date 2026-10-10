/**
 * Preparação OPERACIONAL do Edital institucional (UI) — ZERO_REENTRY, orientada por exceções. Lógica pura, sem React/rede.
 *
 * O SERVIDOR classifica cada variável do modelo (autoridade canônica, perfil do órgão, projeção do TR, decisão do certame,
 * condicional, pós-homologação) e devolve só o que importa; aqui se converte o que a pessoa digita para o valor CANÔNICO do
 * catálogo (money = centavos, percent = pontos, datas ISO, duração {amount, unit}, lista, tabela), monta a seção COMPLETA (o
 * servidor substitui a seção declarada) e planeja o "Salvar preparação": uma confirmação de UX, várias escritas SEQUENCIAIS pelas
 * autoridades existentes, cada uma com idempotência própria e CAS encadeado. A validação final é sempre do servidor.
 */
/** Espelho da DSL de condições do servidor (`Cond2`). Só para mostrar/ocultar AO VIVO; a autoridade final é o composer. */
export type Cond =
  | { op: "eq" | "ne"; var: string; value: string | number | boolean }
  | { op: "in"; var: string; values: (string | number)[] }
  | { op: "gt" | "gte" | "lt" | "lte"; var: string; value: number }
  | { op: "present" | "absent"; var: string }
  | { op: "and" | "or"; of: Cond[] }
  | { op: "not"; of: Cond };

const isAbsent = (v: unknown): boolean => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

export function evaluateCond(c: Cond, facts: Readonly<Record<string, unknown>>): boolean {
  switch (c.op) {
    case "and": return c.of.map((x) => evaluateCond(x, facts)).every(Boolean);
    case "or": return c.of.map((x) => evaluateCond(x, facts)).some(Boolean);
    case "not": return !evaluateCond(c.of, facts);
    case "present": return !isAbsent(facts[c.var]);
    case "absent": return isAbsent(facts[c.var]);
    case "in": return !isAbsent(facts[c.var]) && c.values.some((v) => v === facts[c.var]);
    case "gt": case "gte": case "lt": case "lte": {
      const o = facts[c.var];
      if (typeof o !== "number" || !Number.isFinite(o)) return false;
      return c.op === "gt" ? o > c.value : c.op === "gte" ? o >= c.value : c.op === "lt" ? o < c.value : o <= c.value;
    }
    case "eq": return !isAbsent(facts[c.var]) && facts[c.var] === c.value;
    case "ne": return !(!isAbsent(facts[c.var]) && facts[c.var] === c.value);
  }
}

export interface PrepColumn { key: string; type: string; label: string; required: boolean }
export type FieldStatus =
  | "AUTO" | "ORG_REUSED" | "DECIDED" | "PENDING" | "OPTIONAL" | "AWAITING" | "UPSTREAM" | "ORG_DEFAULT" | "PENDING_TR" | "PROFILE_INCOMPLETE"
  | "CANONICAL_UNRESOLVED" | "HIDDEN_CONDITIONAL" | "HIDDEN_POST_AWARD";
export type AuthorityClass =
  | "EXISTING_CANONICAL" | "ORG_ROLE_PROFILE" | "ORG_POLICY_PROFILE" | "UPSTREAM_PROCESS" | "UPSTREAM_DFD" | "UPSTREAM_ETP" | "UPSTREAM_ITEMS"
  | "UPSTREAM_PRICE_RESEARCH" | "UPSTREAM_TR" | "TRUE_PROCESS_DECISION" | "CONDITIONAL" | "POST_AWARD";
export type PreparationClass = "CANONICAL" | "ORG_PROFILE" | "TR_PROJECTION" | "PROCESS_DECISION" | "CONDITIONAL" | "POST_AWARD";
export interface PrepOrigin { label: string; ref?: Readonly<Record<string, string | number>> }
export interface PrepField {
  name: string; source: string; path: string; type: string; description: string; required: boolean; conditional: boolean;
  requiredWhenVariables: readonly string[]; requiredWhen?: Cond; enumValues?: readonly string[]; itemType?: string; columns?: readonly PrepColumn[];
  hasValue: boolean; currentValue?: unknown;
  class: PreparationClass; rule: string; authority?: AuthorityClass; entry?: "NONE" | "TR_SECTION" | "ORG_PROFILE" | "PREPARATION";
  status: FieldStatus; editable: boolean; displayValue?: unknown; origin?: PrepOrigin; reason?: string; canOverrideDefault?: boolean; defaultEligible?: boolean;
  /** Havia valor legado no ledger neste caminho, hoje coberto por autoridade canônica/TR exato: preservado como história e IGNORADO. */
  shadowedLegacy?: boolean;
}
export type TrPinState = { state: "NOT_SELECTED" } | { state: "VALID"; ref: { documentId: string; version: number; contentHash: string } } | { state: "INVALID"; code: string };
export interface PrepSection { source: string; scope: "ORG" | "PROCESS"; fields: readonly PrepField[]; pendingRequired: number }
export interface CanonicalReadOnlyField { name: string; source: string; path: string; type: string; description: string; status: FieldStatus; displayValue?: unknown; origin: PrepOrigin }
export interface SummaryGroup { id: string; title: string; total: number; resolved: number; reused: number; pending: number; blockedCanonical: number }
export interface PreparationMetrics {
  TOTAL_TEMPLATE_FIELDS: number; AUTO_RESOLVED: number; ORG_REUSED: number; TR_PROJECTED: number; DECIDED: number; CONDITIONAL_HIDDEN: number;
  POST_AWARD_HIDDEN: number; OPTIONAL_HIDDEN: number; MANUAL_DECISIONS_VISIBLE: number; LEGACY_SHADOWED: number;
  UPSTREAM_TR_REUSED?: number; TR_PENDING?: number; PROFILE_INCOMPLETE?: number; ORG_ROLES_REUSED?: number; ORG_POLICIES_REUSED?: number;
  ORG_DEFAULTS_APPLIED?: number; BY_AUTHORITY?: Partial<Record<AuthorityClass, number>>;
}
export interface UpstreamView {
  trDigest: string;
  trPending: { name: string; description: string; reason?: string }[];
  profilePending: { name: string; description: string; reason: string; role?: string }[];
}
export interface PreparationStateView {
  status: "READY_FOR_PREPARATION"; revisionId: string; catalogVersion: string;
  revisions: { process: number; organization: number; budget: number };
  budgetDisclosure: "publico" | "sigiloso" | null;
  participation: { default?: string; byLot?: Record<string, string>; byItem?: Record<string, string> } | null;
  participationPending: boolean;
  trPin: TrPinState;
  sections: PrepSection[]; facts: Record<string, unknown>; canonicalFields: CanonicalReadOnlyField[];
  orgProfile: { revision: number; hash: string | null } | null;
  upstream?: UpstreamView;
  summary: { groups: SummaryGroup[]; reusedAutomatically: number; pendingDecisions: number };
  metrics: PreparationMetrics;
}

export const DURATION_UNIT_LABEL: Record<string, string> = {
  minute: "minuto(s)", hour: "hora(s)", day: "dia(s)", businessDay: "dia(s) útil(eis)", month: "mês(es)", year: "ano(s)",
};

export const SOURCE_TITLE: Record<string, string> = {
  IDENTITY: "Identidade do órgão", POLICY: "Política do órgão", PROCESS: "Dados do processo", TR: "Dados do TR", CERTAME_CONFIG: "Configuração do certame",
  ITEMS: "Itens e participação", BUDGET: "Orçamento", NORMATIVE: "Fundamentos normativos", LIFECYCLE: "Ciclo de vida",
};

// ─── valor do formulário ────────────────────────────────────────────────────────

export type TableRowForm = Record<string, string>;
export type FormValue = string | { amount: string; unit: string } | TableRowForm[];

const centsToText = (cents: number): string => {
  const neg = cents < 0; const abs = Math.abs(Math.trunc(cents));
  const int = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${neg ? "-" : ""}${int},${String(abs % 100).padStart(2, "0")}`;
};
const numToText = (n: number): string => String(n).replace(".", ",");

/** Valor canônico → texto do controle. */
export function scalarToText(type: string, value: unknown): string {
  if (value === undefined || value === null) return "";
  switch (type) {
    case "money": return typeof value === "number" ? centsToText(value) : String(value);
    case "percent": case "number": case "integer": return typeof value === "number" ? numToText(value) : String(value);
    case "boolean": return value === true ? "true" : value === false ? "false" : "";
    default: return String(value);
  }
}

/** Valor canônico corrente → valor de formulário (inicial). */
export function toFormValue(f: Pick<PrepField, "type" | "itemType" | "columns">, value: unknown): FormValue {
  if (f.type === "duration") {
    const d = value as { amount?: number; unit?: string } | undefined;
    return { amount: d && typeof d.amount === "number" ? String(d.amount) : "", unit: d?.unit ?? "day" };
  }
  if (f.type === "list") return Array.isArray(value) ? value.map((v) => scalarToText(f.itemType ?? "string", v)).join("\n") : "";
  if (f.type === "table") {
    return Array.isArray(value)
      ? value.map((row) => Object.fromEntries((f.columns ?? []).map((c) => [c.key, scalarToText(c.type, (row as Record<string, unknown>)[c.key])])))
      : [];
  }
  return scalarToText(f.type, value);
}

export type ParseResult = { ok: true; value: unknown } | { ok: false; error: string };
const okv = (value: unknown): ParseResult => ({ ok: true, value });
const err = (error: string): ParseResult => ({ ok: false, error });

/** Decimal pt-BR ("1.234,56") ou ponto ("1234.56") → número. */
function parseDecimal(raw: string): number | null {
  const t = raw.trim().replace(/\s/g, "");
  if (!/^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+([.,]\d+)?$/.test(t)) return null;
  const normalized = /,/.test(t) ? t.replace(/\./g, "").replace(",", ".") : /^-?\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, "") : t;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Texto do controle → valor canônico escalar. Vazio ⇒ `undefined` (campo não informado). */
export function parseScalar(type: string, raw: string, enumValues?: readonly string[]): ParseResult {
  const t = raw.trim();
  if (t === "") return okv(undefined);
  switch (type) {
    case "string": case "text": return okv(raw.trim());
    case "enum": return enumValues && !enumValues.includes(t) ? err("Escolha uma das opções.") : okv(t);
    case "boolean": return t === "true" ? okv(true) : t === "false" ? okv(false) : err("Escolha Sim ou Não.");
    case "integer": { const n = parseDecimal(t); return n !== null && Number.isInteger(n) ? okv(n) : err("Informe um número inteiro."); }
    case "number": { const n = parseDecimal(t); return n !== null ? okv(n) : err("Informe um número."); }
    case "percent": { const n = parseDecimal(t); return n !== null && n >= 0 && n <= 100 ? okv(n) : err("Informe um percentual entre 0 e 100."); }
    case "money": { const n = parseDecimal(t); return n !== null && n >= 0 ? okv(Math.round(n * 100)) : err("Informe um valor em reais (ex.: 1.234,56)."); }
    case "date": return /^\d{4}-\d{2}-\d{2}$/.test(t) ? okv(t) : err("Informe a data (AAAA-MM-DD).");
    case "time": return /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? okv(t) : err("Informe a hora (HH:MM).");
    case "datetime": return /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(t) ? okv(t) : err("Informe data e hora.");
    case "url": return /^https?:\/\/[^\s<>"]+$/i.test(t) ? okv(t) : err("Informe uma URL iniciada por http:// ou https://.");
    case "cnpj": { const d = t.replace(/\D/g, ""); return d.length === 14 ? okv(d) : err("Informe um CNPJ com 14 dígitos."); }
    default: return okv(t);
  }
}

/** Valor de formulário → valor canônico do campo. Vazio ⇒ `undefined`. */
export function parseField(f: PrepField, form: FormValue | undefined): ParseResult {
  if (form === undefined) return okv(undefined);
  if (f.type === "duration") {
    const d = form as { amount: string; unit: string };
    if (!d.amount?.trim()) return okv(undefined);
    const n = parseDecimal(d.amount);
    if (n === null || !Number.isInteger(n) || n < 0) return err("Informe a quantidade (número inteiro).");
    return okv({ amount: n, unit: d.unit });
  }
  if (f.type === "list") {
    const lines = String(form).split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return okv(undefined);
    const out: unknown[] = [];
    for (const [i, line] of lines.entries()) {
      const r = parseScalar(f.itemType ?? "string", line);
      if (!r.ok) return err(`Item ${i + 1}: ${r.error}`);
      out.push(r.value);
    }
    return okv(out);
  }
  if (f.type === "table") {
    const rows = (form as TableRowForm[]).filter((row) => Object.values(row).some((v) => v.trim() !== ""));
    if (rows.length === 0) return okv(undefined);
    const out: Record<string, unknown>[] = [];
    for (const [i, row] of rows.entries()) {
      const o: Record<string, unknown> = {};
      for (const c of f.columns ?? []) {
        const r = parseScalar(c.type, row[c.key] ?? "");
        if (!r.ok) return err(`Linha ${i + 1} — ${c.label}: ${r.error}`);
        if (r.value === undefined) { if (c.required) return err(`Linha ${i + 1} — ${c.label}: obrigatório.`); continue; }
        o[c.key] = r.value;
      }
      out.push(o);
    }
    return okv(out);
  }
  return parseScalar(f.type, String(form), f.enumValues);
}

// ─── seção ──────────────────────────────────────────────────────────────────────

export type SectionEdits = Readonly<Record<string, FormValue>>;

/** Constrói a seção COMPLETA (path → valor canônico): campos tocados vêm da edição; os demais mantêm o valor DECLARADO armazenado. */
export function buildSectionFields(section: PrepSection, edits: SectionEdits): { fields: Record<string, unknown>; errors: Record<string, string> } {
  const fields: Record<string, unknown> = {}; const errors: Record<string, string> = {};
  for (const f of section.fields) {
    // Autoridade CANONICAL nunca é reenviada (o servidor a recusa e preserva qualquer valor legado como história).
    if (f.class === "CANONICAL") continue;
    if (Object.prototype.hasOwnProperty.call(edits, f.path)) {
      const r = parseField(f, edits[f.path]);
      if (!r.ok) errors[f.path] = r.error; else if (r.value !== undefined) fields[f.path] = r.value;
    } else if (f.hasValue) fields[f.path] = f.currentValue;
  }
  return { fields, errors };
}

// ─── visões orientadas por exceção ────────────────────────────────────────────────

export interface PendingItem { section: PrepSection; field: PrepField }
const bySectionOrder = (state: PreparationStateView, status: FieldStatus[], editableOnly: boolean): PendingItem[] =>
  state.sections.flatMap((section) => section.fields.filter((f) => status.includes(f.status) && (!editableOnly || f.editable)).map((field) => ({ section, field })));

/** O que a pessoa precisa decidir AGORA (obrigatório, aplicável e sem valor). */
export const pendingItems = (state: PreparationStateView): PendingItem[] => bySectionOrder(state, ["PENDING"], true);
/** Perfil do órgão pendente (configurar UMA vez): pendências de escopo ORG, em bloco separado. */
export const orgProfilePending = (state: PreparationStateView): UpstreamView["profilePending"] => state.upstream?.profilePending ?? [];
/** Parâmetros estruturados do TR ainda não confirmados (informar no TR, não na preparação do Edital). */
export const trParamsPending = (state: PreparationStateView): UpstreamView["trPending"] => state.upstream?.trPending ?? [];
/** Pendências do processo (certame/TR/processo). */
export const processPending = (state: PreparationStateView): PendingItem[] => pendingItems(state).filter((p) => p.section.scope === "PROCESS");
/** Decisões opcionais (inclui as que ATIVAM campos adicionais): recolhidas por padrão. */
export const optionalItems = (state: PreparationStateView): PendingItem[] => bySectionOrder(state, ["OPTIONAL"], true);
/** "Ver dados reaproveitados": automático, perfil do órgão e decisões já registradas. */
export const reusedItems = (state: PreparationStateView): PendingItem[] => bySectionOrder(state, ["AUTO", "ORG_REUSED", "DECIDED", "UPSTREAM", "ORG_DEFAULT"], false);

export function sectionHasPending(state: PreparationStateView, source: string): boolean {
  return pendingItems(state).some((p) => p.section.source === source);
}

/** Texto legível de um valor canônico (explicabilidade e revisão antes de salvar). */
export function formatDisplay(type: string, value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  switch (type) {
    case "money": return typeof value === "number" ? `R$ ${centsToText(value)}` : String(value);
    case "percent": return typeof value === "number" ? `${numToText(value)}%` : String(value);
    case "boolean": return value === true ? "Sim" : value === false ? "Não" : String(value);
    case "duration": { const d = value as { amount?: number; unit?: string }; return d && typeof d.amount === "number" ? `${d.amount} ${DURATION_UNIT_LABEL[d.unit ?? ""] ?? d.unit}` : String(value); }
    case "list": return Array.isArray(value) ? value.map(String).join("; ") : String(value);
    case "table": return Array.isArray(value) ? `${value.length} linha(s)` : String(value);
    case "date": { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value)); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(value); }
    case "datetime": { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})$/.exec(String(value)); return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}` : String(value); }
    default: return String(value);
  }
}


// ─── status AO VIVO (condicionais ativam/ocultam conforme a pessoa decide) ───────────────────

export interface LiveField { status: FieldStatus; /** valor digitado nesta sessão (já convertido) */ edited: boolean }

/** Reavalia as condições com os valores digitados por cima dos fatos do servidor. Nada é gravado; o composer segue sendo a autoridade. */
export function liveStatuses(state: PreparationStateView, edits: Readonly<Record<string, SectionEdits>>): Map<string, LiveField> {
  const facts: Record<string, unknown> = { ...state.facts };
  const editedNames = new Set<string>();
  for (const sec of state.sections) {
    for (const f of sec.fields) {
      if (!f.editable || !Object.prototype.hasOwnProperty.call(edits[sec.source] ?? {}, f.path)) continue;
      const r = parseField(f as PrepField, (edits[sec.source] ?? {})[f.path]);
      if (!r.ok) continue;
      if (r.value === undefined) delete facts[f.name]; else { facts[f.name] = r.value; editedNames.add(f.name); }
    }
  }
  const inactive = new Set<string>();
  const conditional = state.sections.flatMap((s) => s.fields).filter((f) => f.requiredWhen);
  for (let round = 0; round < 12; round++) {
    let changed = false;
    for (const f of conditional) {
      if (inactive.has(f.name)) continue;
      const visible = Object.fromEntries(Object.entries(facts).filter(([k]) => !inactive.has(k)));
      if (!evaluateCond(f.requiredWhen!, visible)) { inactive.add(f.name); delete facts[f.name]; changed = true; }
    }
    if (!changed) break;
  }
  const out = new Map<string, LiveField>();
  for (const sec of state.sections) {
    for (const f of sec.fields) {
      const edited = editedNames.has(f.name);
      let status: FieldStatus = f.status;
      if (inactive.has(f.name)) status = "HIDDEN_CONDITIONAL";
      else if (f.requiredWhen && f.editable && f.status !== "AUTO") {
        // Condição ativa: sem valor ⇒ pendência; com valor (registrado ou digitado) ⇒ resolvida.
        status = isAbsent(facts[f.name]) ? "PENDING" : f.status === "PENDING" || f.status === "HIDDEN_CONDITIONAL" || f.status === "OPTIONAL" ? "DECIDED" : f.status;
      }
      out.set(f.name, { status, edited });
    }
  }
  return out;
}

/** Pendências ao vivo: obrigatórias/ativas, editáveis e AINDA sem valor (digitado ou registrado). */
export function livePendingItems(state: PreparationStateView, edits: Readonly<Record<string, SectionEdits>>): PendingItem[] {
  const live = liveStatuses(state, edits);
  return state.sections.flatMap((section) => section.fields
    .filter((f) => f.editable && live.get(f.name)?.status === "PENDING" && !live.get(f.name)?.edited)
    .map((field) => ({ section, field })));
}

/** Decisões opcionais ao vivo (as que ainda não têm valor e não estão ocultas). */
export function liveOptionalItems(state: PreparationStateView, edits: Readonly<Record<string, SectionEdits>>): PendingItem[] {
  const live = liveStatuses(state, edits);
  return state.sections.flatMap((section) => section.fields
    .filter((f) => f.editable && f.status === "OPTIONAL" && live.get(f.name)?.status === "OPTIONAL")
    .map((field) => ({ section, field })));
}

// ─── "Salvar preparação do Edital": UMA confirmação, várias escritas SEQUENCIAIS ─────────────

export type WriteKind = "ORG" | "PROCESS" | "DISCLOSURE";
export interface PlannedWrite {
  /** Identidade estável da escrita (base da chave de idempotência por tentativa). */
  id: string;
  kind: WriteKind;
  source?: string;
  fields?: Record<string, unknown>;
  participation?: { default?: string; byLot?: Record<string, string>; byItem?: Record<string, string> };
  disclosure?: "publico" | "sigiloso";
  /** Linhas do resumo "N decisões serão registradas". */
  lines: string[];
}
export interface SavePlan { writes: PlannedWrite[]; errors: Record<string, Record<string, string>>; decisionCount: number }

const ORG_ORDER = ["IDENTITY", "POLICY"] as const;
const PROCESS_ORDER = ["PROCESS", "TR", "CERTAME_CONFIG", "ITEMS", "BUDGET", "NORMATIVE", "LIFECYCLE"] as const;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function buildSavePlan(
  state: PreparationStateView,
  input: { edits: Readonly<Record<string, SectionEdits>>; disclosure: "" | "publico" | "sigiloso"; participationDefault: string | null },
): SavePlan {
  const writes: PlannedWrite[] = []; const errors: Record<string, Record<string, string>> = {}; let decisionCount = 0;
  const section = (source: string) => state.sections.find((s) => s.source === source);
  const sectionWrite = (source: string, kind: "ORG" | "PROCESS"): PlannedWrite | null => {
    const sec = section(source);
    if (!sec) return null;
    const built = buildSectionFields(sec, input.edits[source] ?? {});
    if (Object.keys(built.errors).length > 0) errors[source] = built.errors;
    const lines: string[] = [];
    for (const f of sec.fields) {
      if (!Object.prototype.hasOwnProperty.call(input.edits[source] ?? {}, f.path)) continue;
      const next = built.fields[f.path];
      if (next !== undefined && !same(next, f.hasValue ? f.currentValue : undefined)) lines.push(`${f.description || f.name}: ${formatDisplay(f.type, next)}`);
    }
    let participation: PlannedWrite["participation"];
    const pd = input.participationDefault?.trim();
    if (kind === "PROCESS" && source === "ITEMS" && pd && pd !== (state.participation?.default ?? "")) {
      participation = { ...(state.participation ?? {}), default: pd };
      lines.push(`Regime de participação padrão dos itens: ${pd}`);
    }
    if (lines.length === 0) return null;
    decisionCount += lines.length;
    return { id: `${kind}-${source}`, kind, source, fields: built.fields, ...(participation ? { participation } : {}), lines };
  };
  for (const s of ORG_ORDER) { const w = sectionWrite(s, "ORG"); if (w) writes.push(w); }
  if (input.disclosure && input.disclosure !== state.budgetDisclosure) {
    writes.push({ id: "DISCLOSURE", kind: "DISCLOSURE", disclosure: input.disclosure, lines: [`Divulgação do orçamento: ${input.disclosure === "sigiloso" ? "sigiloso" : "público"}`] });
    decisionCount++;
  }
  for (const s of PROCESS_ORDER) { const w = sectionWrite(s, "PROCESS"); if (w) writes.push(w); }
  // Participação sem edição de campos da seção ITEMS (ITEMS sem descritores editados): a escrita ainda precisa existir.
  const pd = input.participationDefault?.trim();
  if (pd && pd !== (state.participation?.default ?? "") && !writes.some((w) => w.id === "PROCESS-ITEMS")) {
    const sec = section("ITEMS");
    const built = sec ? buildSectionFields(sec, {}) : { fields: {} as Record<string, unknown> };
    writes.push({ id: "PROCESS-ITEMS", kind: "PROCESS", source: "ITEMS", fields: built.fields, participation: { ...(state.participation ?? {}), default: pd }, lines: [`Regime de participação padrão dos itens: ${pd}`] });
    decisionCount++;
  }
  return { writes, errors, decisionCount };
}

export interface SaveWriter { write(w: PlannedWrite, expectedRevision: number): Promise<{ revision: number }> }
export interface SaveOutcome {
  registered: PlannedWrite[];
  failed: { write: PlannedWrite; stale: boolean; message: string } | null;
  notExecuted: PlannedWrite[];
}

/**
 * Executa o plano em SEQUÊNCIA (nunca em paralelo). O CAS é encadeado por escopo: a revisão devolvida por uma escrita é o
 * `expectedRevision` da próxima do mesmo escopo; se outra pessoa gravou no meio, a próxima falha como obsoleta e a execução PARA
 * (sem sobrescrever). O que já foi registrado permanece e é informado.
 */
export async function executeSavePlan(
  writes: readonly PlannedWrite[], start: { organization: number; process: number; budget: number }, writer: SaveWriter,
  isStale: (e: unknown) => boolean,
): Promise<SaveOutcome> {
  const rev = { ...start };
  const scopeKey = (k: WriteKind) => (k === "ORG" ? "organization" : k === "PROCESS" ? "process" : "budget") as keyof typeof rev;
  const registered: PlannedWrite[] = [];
  for (let i = 0; i < writes.length; i++) {
    const w = writes[i];
    try {
      const r = await writer.write(w, rev[scopeKey(w.kind)]);
      rev[scopeKey(w.kind)] = r.revision;
      registered.push(w);
    } catch (e) {
      return { registered, failed: { write: w, stale: isStale(e), message: e instanceof Error ? e.message : String(e) }, notExecuted: writes.slice(i + 1) as PlannedWrite[] };
    }
  }
  return { registered, failed: null, notExecuted: [] };
}

/** CAS obsoleto (outra pessoa registrou antes): recarregar, avisar e exigir NOVA confirmação. */
export const isStaleSave = (code: string | undefined, message: string): boolean =>
  code === "CONFLICT" || /STALE_STATE|recarregue|outra pessoa registrou/i.test(message);

export const STALE_NOTICE = "Outra pessoa alterou estes dados antes do seu registro. Recarregamos o estado atual; revise e confirme novamente.";

// ─── preflight / revisão ────────────────────────────────────────────────────────

export interface PreflightIssueView { code: string; source?: string; path?: string; message: string }
export type PreflightView =
  | { status: "NOT_APPLICABLE" }
  | { status: "READY_FOR_COMPOSITION"; templateRevisionId: string; templateSemanticHash: string }
  | { status: "BLOCKED"; issues: readonly PreflightIssueView[]; pendingDecisions?: number };

/** O botão "Gerar edital com modelo institucional" só é operacional com BOUND + TR exato + preflight READY (o backend segue fail-closed). */
export function generateReady(bound: boolean, hasTrPin: boolean, preflight: PreflightView | undefined): { ready: boolean; reason?: string } {
  if (!bound) return { ready: true };
  if (!hasTrPin) return { ready: false, reason: "Confirme o TR oficial exato." };
  if (!preflight) return { ready: false, reason: "Verificando se as fontes estão prontas…" };
  if (preflight.status !== "READY_FOR_COMPOSITION") return { ready: false, reason: "Há pendências nas fontes do Edital: complete a preparação e verifique novamente." };
  return { ready: true };
}

export interface DeviationView { blockId: string; kind: "INCLUDED_BLOCK_REMOVED" | "EXCLUDED_BLOCK_INSERTED"; acknowledged: boolean }
export interface ReviewStateView {
  composedByTemplate: boolean; generationManifestId?: string; templateRevisionId?: string;
  unresolvedMarkers: { count: number; slots: readonly string[]; samples: readonly string[] };
  structuralDeviations: readonly DeviationView[];
  aiNarratives: readonly { slotKey: string; executionId: string; humanAccepted: boolean }[];
  revalidation: { status: "PASSED" | "BLOCKED"; issues: readonly { code: string; path: string; message: string }[] };
}

export const DEVIATION_LABEL: Record<DeviationView["kind"], string> = {
  INCLUDED_BLOCK_REMOVED: "Bloco do modelo removido ou substituído no texto",
  EXCLUDED_BLOCK_INSERTED: "Bloco não previsto pelo modelo inserido no texto",
};

export const pendingDeviations = (r: Pick<ReviewStateView, "structuralDeviations"> | undefined): DeviationView[] =>
  (r?.structuralDeviations ?? []).filter((d) => !d.acknowledged);

/** Resumo de prontidão para emitir: nada além de informar — a autoridade final é a revalidação do backend na emissão. */
export function reviewReadiness(r: ReviewStateView | undefined): { ready: boolean; blockers: string[] } {
  if (!r || !r.composedByTemplate) return { ready: true, blockers: [] };
  const blockers: string[] = [];
  if (r.unresolvedMarkers.count > 0) blockers.push(`${r.unresolvedMarkers.count} marcador(es) [REVISAR] pendente(s) no texto.`);
  const pend = pendingDeviations(r).length;
  if (pend > 0) blockers.push(`${pend} desvio(s) estrutural(is) sem reconhecimento humano.`);
  if (r.revalidation.status === "BLOCKED") for (const i of r.revalidation.issues) if (i.code !== "STRUCTURAL_DEVIATION_UNACKNOWLEDGED") blockers.push(i.message);
  return { ready: blockers.length === 0, blockers };
}

export interface AckOutcome { blockId: string; ok: boolean; error?: string }
export const summarizeAcks = (o: readonly AckOutcome[]): { done: number; failed: AckOutcome[] } => ({ done: o.filter((x) => x.ok).length, failed: o.filter((x) => !x.ok) });

