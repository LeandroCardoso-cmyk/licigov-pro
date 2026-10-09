/**
 * Preparação OPERACIONAL do Edital institucional (UI) — lógica pura, sem React/rede.
 *
 * Os descritores dos campos vêm do SERVIDOR (catálogo da revisão exata vinculada); aqui só se converte o que a pessoa digita para o
 * valor CANÔNICO do catálogo (money = centavos inteiros, percent = pontos, datas ISO, duração {amount, unit}, lista de escalares,
 * tabela por colunas) e se monta a seção COMPLETA (o servidor substitui a seção declarada). Nenhum JSON técnico é exigido da pessoa.
 * Campos de autoridade canônica nunca chegam aqui como editáveis. A validação final é sempre do servidor.
 */
export interface PrepColumn { key: string; type: string; label: string; required: boolean }
export interface PrepField {
  name: string; source: string; path: string; type: string; description: string; required: boolean; conditional: boolean;
  requiredWhenVariables: readonly string[]; enumValues?: readonly string[]; itemType?: string; columns?: readonly PrepColumn[];
  hasValue: boolean; currentValue?: unknown;
}
export interface PrepSection { source: string; scope: "ORG" | "PROCESS"; fields: readonly PrepField[]; pendingRequired: number }

export type SectionStatus = "COMPLETO" | "PENDENTE" | "CONDICIONAL";
export const STATUS_LABEL: Record<SectionStatus, string> = { COMPLETO: "Completo", PENDENTE: "Pendente", CONDICIONAL: "Condicional" };

export const DURATION_UNIT_LABEL: Record<string, string> = {
  minute: "minuto(s)", hour: "hora(s)", day: "dia(s)", businessDay: "dia(s) útil(eis)", month: "mês(es)", year: "ano(s)",
};

export interface PrepGroup { id: string; title: string; sources: readonly string[] }
/** Ordem operacional (1 órgão … 8 ciclo de vida). O orçamento inclui a divulgação público/sigiloso (tratada à parte). */
export const PREP_GROUPS: readonly PrepGroup[] = [
  { id: "orgao", title: "1. Órgão (identidade e política)", sources: ["IDENTITY", "POLICY"] },
  { id: "processo", title: "2. Processo", sources: ["PROCESS"] },
  { id: "tr", title: "3. Termo de Referência", sources: ["TR"] },
  { id: "certame", title: "4. Configuração do certame", sources: ["CERTAME_CONFIG"] },
  { id: "itens", title: "5. Itens e participação", sources: ["ITEMS"] },
  { id: "orcamento", title: "6. Orçamento e divulgação", sources: ["BUDGET"] },
  { id: "normativo", title: "7. Fundamentos normativos", sources: ["NORMATIVE"] },
  { id: "ciclo", title: "8. Ciclo de vida", sources: ["LIFECYCLE"] },
];

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

/** Constrói a seção COMPLETA (path → valor canônico): campos tocados vêm da edição; os demais mantêm o valor corrente. */
export function buildSectionFields(section: PrepSection, edits: SectionEdits): { fields: Record<string, unknown>; errors: Record<string, string> } {
  const fields: Record<string, unknown> = {}; const errors: Record<string, string> = {};
  for (const f of section.fields) {
    if (Object.prototype.hasOwnProperty.call(edits, f.path)) {
      const r = parseField(f, edits[f.path]);
      if (!r.ok) errors[f.path] = r.error; else if (r.value !== undefined) fields[f.path] = r.value;
    } else if (f.hasValue) fields[f.path] = f.currentValue;
  }
  return { fields, errors };
}

/** Campos obrigatórios ainda sem valor APÓS aplicar as edições (a obrigatoriedade condicional é decidida pelo servidor). */
export function missingRequired(section: PrepSection, edits: SectionEdits): PrepField[] {
  const { fields } = buildSectionFields(section, edits);
  return section.fields.filter((f) => f.required && !f.conditional && fields[f.path] === undefined);
}

export function sectionStatus(section: PrepSection): SectionStatus {
  if (section.pendingRequired > 0) return "PENDENTE";
  return section.fields.some((f) => f.conditional && !f.hasValue) ? "CONDICIONAL" : "COMPLETO";
}

export function groupStatus(sections: readonly PrepSection[], disclosureRecorded = true): SectionStatus {
  if (!disclosureRecorded || sections.some((s) => sectionStatus(s) === "PENDENTE")) return "PENDENTE";
  return sections.some((s) => sectionStatus(s) === "CONDICIONAL") ? "CONDICIONAL" : "COMPLETO";
}

export interface GroupView { group: PrepGroup; sections: PrepSection[] }
export function groupSections(sections: readonly PrepSection[]): GroupView[] {
  return PREP_GROUPS.map((group) => ({ group, sections: group.sources.flatMap((s) => sections.filter((x) => x.source === s)) }))
    .filter((g) => g.sections.length > 0);
}

/** Pendências totais (campos obrigatórios sem valor) — o botão "Gerar" só fica operacional com preflight READY, não com isto. */
export const totalPending = (sections: readonly PrepSection[]): number => sections.reduce((a, s) => a + s.pendingRequired, 0);

/** CAS obsoleto (outra pessoa registrou antes): recarregar, avisar e exigir NOVA confirmação. */
export const isStaleSave = (code: string | undefined, message: string): boolean =>
  code === "CONFLICT" || /STALE_STATE|recarregue|outra pessoa registrou/i.test(message);

export const STALE_NOTICE = "Outra pessoa alterou estes dados antes do seu registro. Recarregamos o estado atual; revise e confirme novamente.";

// ─── preflight / revisão ────────────────────────────────────────────────────────

export interface PreflightIssueView { code: string; source?: string; path?: string; message: string }
export type PreflightView =
  | { status: "NOT_APPLICABLE" }
  | { status: "READY_FOR_COMPOSITION"; templateRevisionId: string; templateSemanticHash: string }
  | { status: "BLOCKED"; issues: readonly PreflightIssueView[] };

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
