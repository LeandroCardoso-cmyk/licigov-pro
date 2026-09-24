/**
 * DFD assistido — projeção do Contexto Canônico sobre o MESMO DFD de sempre (mesmas seções e rótulos do
 * art. 12, §1º; mesmo textarea). O DFD continua um documento markdown editável; esta camada:
 *   - PRÉ-PREENCHE deterministicamente os fatos já conhecidos (sem IA para fatos);
 *   - registra a ORIGEM de cada campo em marcadores de linhagem (`generated_documents.sources`, primitive
 *     existente — zero schema novo para o documento);
 *   - deriva o ESTADO de cada campo (pré-preenchido / rascunho de IA / alterado por você / desatualizado /
 *     em conflito / disponível / não definido);
 *   - reconcilia campo a campo apenas por AÇÃO EXPLÍCITA (nunca sobrescreve edição humana);
 *   - extrai do DFD salvo as AFIRMAÇÕES humanas que alimentam o contexto para as etapas seguintes.
 * Puro e determinístico (sem I/O).
 */
import {
  CANONICAL_CONTEXT_VERSION, factValueHash, normalizeText, itemPath, canonicalItemKey,
  type ProcurementCanonicalContext, type CanonicalField, type ContextSourceType, type ContextPath, type FactValue,
} from "./canonicalProcurementContext";
import { formatBRL } from "./money";

export const DFD_PREFILL_VERSION = "dfd-prefill/1";

// ─── Campos do DFD (os MESMOS rótulos do template existente) ──────────────────────────

export type DFDFieldKey =
  | "identificacao.objeto" | "identificacao.unidade" | "identificacao.responsavel"
  | "justificativa" | "descricao" | "planejamento" | "orcamento"
  | "prioridade.grau" | "prioridade.prazo"
  | `item:${string}`;

export const DFD_FIELD_LABELS: Readonly<Record<string, string>> = {
  "identificacao.objeto": "Objeto",
  "identificacao.unidade": "Setor/unidade demandante",
  "identificacao.responsavel": "Responsável pela demanda",
  justificativa: "Justificativa da necessidade",
  descricao: "Descrição sucinta do objeto",
  planejamento: "Previsão no planejamento (PCA)",
  orcamento: "Estimativa preliminar de recursos",
  "prioridade.grau": "Grau de prioridade",
  "prioridade.prazo": "Prazo pretendido",
};

/** Fato canônico que cada campo reflete (campos sem fato: narrativa ou valor derivado). */
export const DFD_FIELD_FACT: Readonly<Record<string, ContextPath | null>> = {
  "identificacao.objeto": "process.object",
  "identificacao.unidade": "demand.requestingUnit",
  "identificacao.responsavel": "demand.responsibleParty",
  justificativa: null,
  descricao: "process.object",
  planejamento: "planning.pcaAlignment",
  orcamento: null,
  "prioridade.grau": "planning.priority",
  "prioridade.prazo": "planning.desiredDate",
};

/** Campos que o humano pode afirmar como FATO ao salvar o DFD (objeto é do Processo; descrição idem). */
const ASSERTABLE: ReadonlyArray<[DFDFieldKey, ContextPath]> = [
  ["identificacao.unidade", "demand.requestingUnit"],
  ["identificacao.responsavel", "demand.responsibleParty"],
  ["planejamento", "planning.pcaAlignment"],
  ["prioridade.grau", "planning.priority"],
  ["prioridade.prazo", "planning.desiredDate"],
];

/** Origem exibível de um campo: fonte do contexto, cálculo do sistema ou rascunho de IA. */
export type DFDFieldOrigin = ContextSourceType | "derived";

// ─── Placeholders e textos-guia (idênticos ao template histórico) ──────────────────────

const P = "[preencher]";
const QTY_UNDEFINED = "[a definir]";
const PRIORITY_PLACEHOLDER = "[baixa/média/alta]";
const HINT_DESC = "_Detalhar características essenciais, natureza (bem/serviço) e finalidade, se necessário._";

function justificationPlaceholder(obj: string): string[] {
  return [
    `Descrever a necessidade pública que motiva a contratação de "${obj}", com o `,
    `problema a ser resolvido e o interesse público envolvido. ${P}`,
  ];
}

function isPlaceholder(v: string | null | undefined): boolean {
  const t = normalizeText(v ?? "");
  return t === "" || t.includes(P) || t.includes(QTY_UNDEFINED) || t === PRIORITY_PLACEHOLDER;
}

// ─── Projeção (prefill) ─────────────────────────────────────────────────────────────────

export interface DFDPrefillValue { value: string | null; origin: DFDFieldOrigin | null; conflict: boolean }

export interface DFDPrefillItem {
  key: string;
  description: string;
  unit: string;
  plannedQuantity: number | null;
  qtyOrigin: DFDFieldOrigin | null;
  qtyConflict: boolean;
}

export interface DFDPrefill {
  contractVersion: typeof DFD_PREFILL_VERSION;
  contextVersion: number;
  contextDigest: string;
  object: string | null;
  values: Record<string, DFDPrefillValue>;
  items: DFDPrefillItem[];
}

function pv(f: CanonicalField): DFDPrefillValue {
  if (f.status === "conflict") return { value: null, origin: null, conflict: true };
  return { value: f.value === null ? null : String(f.value), origin: f.source?.type ?? null, conflict: false };
}

/** DFDPrefillProjection — o que o contexto sabe, no vocabulário do DFD. Fatos em conflito NÃO entram. */
export function buildDFDPrefill(ctx: ProcurementCanonicalContext): DFDPrefill {
  const obj = pv(ctx.process.object);
  const items = ctx.items
    .filter((i) => i.description.value !== null)
    .map((i) => ({
      key: i.key,
      description: String(i.description.value),
      unit: String(i.unit.value ?? "UN"),
      plannedQuantity: i.plannedQuantity.status === "conflict" ? null : i.plannedQuantity.value,
      qtyOrigin: i.plannedQuantity.status === "conflict" ? null : i.plannedQuantity.source?.type ?? null,
      qtyConflict: i.plannedQuantity.status === "conflict",
    }));
  const budget = budgetLine(ctx);
  return {
    contractVersion: DFD_PREFILL_VERSION,
    contextVersion: ctx.version,
    contextDigest: ctx.digest,
    object: obj.value,
    values: {
      "identificacao.objeto": obj,
      "identificacao.unidade": pv(ctx.demand.requestingUnit),
      "identificacao.responsavel": pv(ctx.demand.responsibleParty),
      descricao: obj,
      planejamento: pv(ctx.planning.pcaAlignment),
      orcamento: budget ? { value: budget, origin: "derived", conflict: false } : { value: null, origin: null, conflict: false },
      "prioridade.grau": pv(ctx.planning.priority),
      "prioridade.prazo": pv(ctx.planning.desiredDate),
    },
    items,
  };
}

function budgetLine(ctx: ProcurementCanonicalContext): string | null {
  if (!ctx.priceContext.complete || ctx.priceContext.estimatedTotalCents === null) return null;
  return `Estimativa preliminar: ${formatBRL(ctx.priceContext.estimatedTotalCents)} — soma de quantidade prevista × preço de referência unitário da Pesquisa de Preços (${ctx.items.length} item(ns)).`;
}

// ─── Renderização (MESMO template: seções, rótulos e ordem) ─────────────────────────────

export function formatQuantity(q: number | null): string {
  if (q === null) return QTY_UNDEFINED;
  return Number.isInteger(q) ? String(q) : String(q).replace(".", ",");
}

function cell(s: string): string {
  return normalizeText(s).replace(/\|/g, "/");
}

function itemsTable(items: readonly DFDPrefillItem[]): string[] {
  return [
    "| Item | Descrição | Unidade | Quantidade prevista |",
    "| --- | --- | --- | --- |",
    ...items.map((it, i) => `| ${i + 1} | ${cell(it.description)} | ${cell(it.unit)} | ${formatQuantity(it.plannedQuantity)} |`),
  ];
}

/** Renderiza o DFD. Sem contexto além do objeto ⇒ mesmo texto histórico (mesmos placeholders). */
export function renderDFDContent(prefill: DFDPrefill, justification?: string | null): string {
  const obj = prefill.object?.trim() || "[descrever o objeto]";
  const v = (k: string) => prefill.values[k]?.value ?? null;
  const prio = v("prioridade.grau");
  const prazo = v("prioridade.prazo");
  return [
    "# DFD — Documento de Formalização da Demanda",
    "_Art. 12, §1º da Lei 14.133/2021 — rascunho estruturado (revisar e editar antes de prosseguir)._",
    "",
    "## 1. Identificação da demanda",
    `Objeto: ${obj}`,
    `Setor/unidade demandante: ${v("identificacao.unidade") ?? P}`,
    `Responsável pela demanda: ${v("identificacao.responsavel") ?? P}`,
    "",
    "## 2. Justificativa da necessidade da contratação",
    ...(justification && justification.trim() ? justification.trim().split("\n") : justificationPlaceholder(obj)),
    "",
    "## 3. Descrição sucinta do objeto",
    ...(prefill.object ? [prefill.object.trim(), HINT_DESC] : [`${obj} — detalhar características essenciais, natureza (bem/serviço) e finalidade. ${P}`]),
    "",
    "## 4. Quantitativo estimado e unidade",
    ...(prefill.items.length ? itemsTable(prefill.items) : [`Quantidade estimada: ${P} · Unidade: ${P}`]),
    `Memória de cálculo/critério da estimativa: ${P}`,
    "",
    "## 5. Previsão da contratação no planejamento",
    v("planejamento") ?? `Alinhamento ao Plano de Contratações Anual (PCA) e ao planejamento do órgão. ${P}`,
    "",
    "## 6. Estimativa preliminar de recursos orçamentários",
    v("orcamento") ?? `Indicar a previsão orçamentária preliminar, se disponível. ${P}`,
    "",
    "## 7. Grau de prioridade e prazo desejado",
    `Prioridade: ${prio ?? PRIORITY_PLACEHOLDER} · Prazo pretendido para a contratação: ${prazo ?? P}`,
    "",
    "> Rascunho gerado pelo sistema para estruturação da demanda. Revisão obrigatória",
    "> pelo servidor responsável antes de avançar para o ETP.",
  ].join("\n");
}

// ─── Leitura do DFD (campo a campo) ──────────────────────────────────────────────────────

export interface ParsedDFDItem { key: string; description: string; unit: string; quantityRaw: string; quantity: number | null }
export interface ParsedDFD { values: Record<string, string | null>; items: ParsedDFDItem[]; hasItemsTable: boolean }

interface Section { n: number; start: number; end: number } // [start, end) em linhas, start = heading

function sections(lines: readonly string[]): Section[] {
  const out: Section[] = [];
  lines.forEach((l, i) => {
    const m = /^##\s*(\d+)\./.exec(l);
    if (m) {
      if (out.length) out[out.length - 1].end = i;
      out.push({ n: Number(m[1]), start: i, end: lines.length });
    }
  });
  // O rodapé ("> ...") não pertence à seção 7.
  const last = out[out.length - 1];
  if (last) {
    let e = last.end;
    while (e > last.start + 1 && (/^>/.test(lines[e - 1]) || lines[e - 1].trim() === "")) e--;
    last.end = e;
  }
  return out;
}

function sectionBody(lines: readonly string[], s: Section | undefined): string[] {
  if (!s) return [];
  return lines.slice(s.start + 1, s.end).filter((l) => l.trim() !== "");
}

const LABELS: ReadonlyArray<[DFDFieldKey, RegExp]> = [
  ["identificacao.objeto", /^Objeto:\s*(.*)$/],
  ["identificacao.unidade", /^Setor\/unidade demandante:\s*(.*)$/],
  ["identificacao.responsavel", /^Responsável pela demanda:\s*(.*)$/],
];
const PRIORITY_RE = /^Prioridade:\s*(.*?)\s*·\s*Prazo pretendido para a contratação:\s*(.*)$/;

export function parseQuantityPtBr(raw: string): number | null {
  const t = raw.trim();
  if (!t || isPlaceholder(t)) return null;
  let s = t;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "");
  s = s.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function nonHint(lines: string[]): string | null {
  const v = lines.filter((l) => !/^_.*_$/.test(l.trim())).join("\n").trim();
  return isPlaceholder(v) ? null : v;
}

export function parseDFD(content: string): ParsedDFD {
  const lines = (content ?? "").split("\n");
  const sec = sections(lines);
  const byN = (n: number) => sec.find((s) => s.n === n);
  const values: Record<string, string | null> = {};
  const s1 = sectionBody(lines, byN(1));
  for (const [key, re] of LABELS) {
    const line = s1.find((l) => re.test(l));
    const v = line ? re.exec(line)![1].trim() : null;
    values[key] = v && !isPlaceholder(v) ? v : null;
  }
  values.justificativa = nonHint(sectionBody(lines, byN(2)));
  values.descricao = nonHint(sectionBody(lines, byN(3)));
  values.planejamento = nonHint(sectionBody(lines, byN(5)));
  values.orcamento = nonHint(sectionBody(lines, byN(6)));
  const prioLine = sectionBody(lines, byN(7)).find((l) => PRIORITY_RE.test(l));
  const pm = prioLine ? PRIORITY_RE.exec(prioLine) : null;
  values["prioridade.grau"] = pm && !isPlaceholder(pm[1]) ? pm[1].trim() : null;
  values["prioridade.prazo"] = pm && !isPlaceholder(pm[2]) ? pm[2].trim() : null;

  const s4 = sectionBody(lines, byN(4));
  const rows = s4.filter((l) => /^\|/.test(l.trim()));
  const hasItemsTable = rows.some((r) => /quantidade prevista/i.test(r));
  const items: ParsedDFDItem[] = [];
  for (const r of rows) {
    const cells = r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    if (cells.length < 4 || /^-+$/.test(cells[0].replace(/\s|:/g, "")) || /^item$/i.test(cells[0])) continue;
    const [, description, unit, quantityRaw] = cells;
    if (!description || isPlaceholder(description)) continue;
    items.push({ key: canonicalItemKey(description, unit), description, unit: unit || "UN", quantityRaw, quantity: parseQuantityPtBr(quantityRaw) });
  }
  return { values, items, hasItemsTable };
}

// ─── Marcadores de linhagem (generated_documents.sources) ───────────────────────────────

export interface DFDMarkers {
  contextDigest: string | null;
  contextVersion: number | null;
  /** Valor pré-preenchido por campo: hash + origem (o que o sistema colocou lá). */
  prefill: Record<string, { hash: string; origin: DFDFieldOrigin }>;
  /** Rascunho de IA por campo: hash do texto + execução + digest do contexto usado. */
  ai: Record<string, { hash: string; executionId: string; contextDigest: string }>;
}

const MARKER_PREFIXES = ["ctx:", "ctxdigest:", "ctxv:", "pf:", "ai:"];

export function isAssistMarker(m: string): boolean {
  return MARKER_PREFIXES.some((p) => m.startsWith(p));
}

export function readMarkers(sources: readonly string[]): DFDMarkers {
  const out: DFDMarkers = { contextDigest: null, contextVersion: null, prefill: {}, ai: {} };
  for (const s of sources ?? []) {
    let m: RegExpExecArray | null;
    if ((m = /^ctxdigest:([a-f0-9]+)$/.exec(s))) out.contextDigest = m[1];
    else if ((m = /^ctxv:(\d+)$/.exec(s))) out.contextVersion = Number(m[1]);
    else if ((m = /^pf:([^=]+)=([a-f0-9∅]+)@([a-z_]+)$/.exec(s))) out.prefill[m[1]] = { hash: m[2], origin: m[3] as DFDFieldOrigin };
    else if ((m = /^ai:([^=]+)=([a-f0-9]+)@([A-Za-z0-9_-]+)@([a-f0-9]+)$/.exec(s))) out.ai[m[1]] = { hash: m[2], executionId: m[3], contextDigest: m[4] };
  }
  return out;
}

export function writeMarkers(base: readonly string[], mk: DFDMarkers): string[] {
  const kept = (base ?? []).filter((s) => !isAssistMarker(s));
  const out = [...kept, `ctx:${CANONICAL_CONTEXT_VERSION}`];
  if (mk.contextDigest) out.push(`ctxdigest:${mk.contextDigest}`);
  if (mk.contextVersion !== null) out.push(`ctxv:${mk.contextVersion}`);
  for (const k of Object.keys(mk.prefill).sort()) out.push(`pf:${k}=${mk.prefill[k].hash}@${mk.prefill[k].origin}`);
  for (const k of Object.keys(mk.ai).sort()) out.push(`ai:${k}=${mk.ai[k].hash}@${mk.ai[k].executionId}@${mk.ai[k].contextDigest}`);
  return out;
}

/** Hash de valor de CAMPO do documento (mesma normalização dos fatos). */
export function fieldHash(v: FactValue): string {
  return factValueHash(v === null ? null : typeof v === "number" ? v : normalizeText(v));
}

/** Marcadores de prefill para o conteúdo recém-renderizado (só campos com valor vindo do contexto). */
export function prefillMarkers(prefill: DFDPrefill): DFDMarkers {
  const mk: DFDMarkers = { contextDigest: prefill.contextDigest.slice(0, 16), contextVersion: prefill.contextVersion, prefill: {}, ai: {} };
  for (const [k, v] of Object.entries(prefill.values)) {
    if (v.value !== null && v.origin) mk.prefill[k] = { hash: fieldHash(v.value), origin: v.origin };
  }
  for (const it of prefill.items) {
    if (it.plannedQuantity !== null && it.qtyOrigin) mk.prefill[`item:${it.key}`] = { hash: fieldHash(it.plannedQuantity), origin: it.qtyOrigin };
  }
  return mk;
}

// ─── Estado por campo ─────────────────────────────────────────────────────────────────────

export type DFDFieldState =
  | "prefilled"      // valor do contexto, intocado
  | "ai_draft"       // rascunho de IA, intocado
  | "user_modified"  // alterado/informado por humano
  | "stale"          // pré-preenchido intocado, mas a informação de origem mudou
  | "conflict"       // editado por humano E o contexto hoje diz outra coisa; ou fontes em conflito
  | "available"      // campo vazio no DFD, mas o contexto já conhece o valor
  | "unknown";       // informação ainda não definida

export interface DFDFieldView {
  key: string;
  label: string;
  state: DFDFieldState;
  documentValue: string | null;
  contextValue: string | null;
  origin: DFDFieldOrigin | null;
  contextOrigin: DFDFieldOrigin | null;
  /** Há ação explícita de reconciliação disponível ("Atualizar no rascunho"). */
  reconcilable: boolean;
}

function prefillValueOf(prefill: DFDPrefill, key: string): DFDPrefillValue {
  if (key.startsWith("item:")) {
    const it = prefill.items.find((i) => `item:${i.key}` === key);
    if (!it) return { value: null, origin: null, conflict: false };
    return { value: it.plannedQuantity === null ? null : formatQuantity(it.plannedQuantity), origin: it.qtyOrigin, conflict: it.qtyConflict };
  }
  return prefill.values[key] ?? { value: null, origin: null, conflict: false };
}

function docValueOf(parsed: ParsedDFD, key: string): string | null {
  if (key.startsWith("item:")) {
    const it = parsed.items.find((i) => `item:${i.key}` === key);
    return it && it.quantity !== null ? formatQuantity(it.quantity) : null;
  }
  return parsed.values[key] ?? null;
}

function hashOfField(key: string, v: string | null): string {
  if (v === null) return fieldHash(null);
  if (key.startsWith("item:")) {
    const n = parseQuantityPtBr(v);
    return fieldHash(n);
  }
  return fieldHash(v);
}

function itemLabel(prefill: DFDPrefill, parsed: ParsedDFD, key: string): string {
  const k = key.slice(5);
  const d = prefill.items.find((i) => i.key === k)?.description ?? parsed.items.find((i) => i.key === k)?.description ?? "item";
  return `Quantidade prevista — ${d}`;
}

/**
 * Estado de cada campo = f(conteúdo atual, marcadores gravados, projeção ATUAL do contexto). Nada é
 * persistido: reload/polling nunca "voltam" um valor — só o conteúdo salvo manda.
 */
export function computeDFDFieldStates(content: string, sources: readonly string[], current: DFDPrefill): DFDFieldView[] {
  const parsed = parseDFD(content);
  const mk = readMarkers(sources);
  const keys: string[] = [
    ...Object.keys(DFD_FIELD_LABELS),
    ...[...new Set([...current.items.map((i) => `item:${i.key}`), ...parsed.items.map((i) => `item:${i.key}`)])],
  ];
  return keys.map((key) => {
    const doc = docValueOf(parsed, key);
    const ctx = prefillValueOf(current, key);
    const pf = mk.prefill[key];
    const ai = mk.ai[key];
    const docH = hashOfField(key, doc);
    const ctxH = ctx.value === null ? null : hashOfField(key, ctx.value);
    const label = key.startsWith("item:") ? itemLabel(current, parsed, key) : DFD_FIELD_LABELS[key] ?? key;
    const base = { key, label, documentValue: doc, contextValue: ctx.value, contextOrigin: ctx.origin };
    // Campo sem fato canônico (narrativa) não tem "contexto" a reconciliar.
    const narrative = key === "justificativa";

    if (ctx.conflict) return { ...base, state: "conflict" as const, origin: pf?.origin ?? null, reconcilable: false };
    if (ai && doc !== null && docH === ai.hash) return { ...base, state: "ai_draft" as const, origin: "ai_draft" as const, reconcilable: false };
    if (pf && doc !== null && docH === pf.hash) {
      const stale = !narrative && ctxH !== pf.hash;
      return { ...base, state: stale ? "stale" as const : "prefilled" as const, origin: pf.origin, reconcilable: stale && ctx.value !== null };
    }
    if (doc === null) {
      return ctx.value !== null && !narrative
        ? { ...base, state: "available" as const, origin: null, reconcilable: true }
        : { ...base, state: "unknown" as const, origin: null, reconcilable: false };
    }
    // Valor presente e diferente do que o sistema pôs: é do humano. O contexto concorda? (o próprio DFD
    // salvo alimenta o contexto — então concordar é o caso normal após salvar).
    // A descrição sucinta é o objeto DETALHADO pelo servidor: complementá-la não é divergência.
    if (!narrative && key !== "descricao" && ctxH !== null && ctxH !== docH && ctx.origin !== "dfd") {
      return { ...base, state: "conflict" as const, origin: "user" as const, reconcilable: true };
    }
    return { ...base, state: "user_modified" as const, origin: "user" as const, reconcilable: false };
  });
}

// ─── Reconciliação explícita e rascunho de IA ─────────────────────────────────────────────

function replaceSectionBody(lines: string[], n: number, body: string[]): string[] {
  const s = sections(lines).find((x) => x.n === n);
  if (!s) return lines;
  return [...lines.slice(0, s.start + 1), ...body, "", ...lines.slice(s.end).filter((l, i) => !(i === 0 && l.trim() === ""))];
}

function replaceLine(lines: string[], n: number, re: RegExp, newLine: string): string[] {
  const s = sections(lines).find((x) => x.n === n);
  if (!s) return lines;
  const idx = lines.findIndex((l, i) => i > s.start && i < s.end && re.test(l));
  if (idx >= 0) return lines.map((l, i) => (i === idx ? newLine : l));
  const out = [...lines];
  out.splice(s.start + 1, 0, newLine);
  return out;
}

/**
 * Aplica ao rascunho o valor ATUAL do contexto para UM campo (ação explícita "Atualizar no rascunho").
 * Não toca nenhum outro campo. Atualiza o marcador de prefill do campo (novo valor + origem).
 */
export function reconcileDFDField(
  content: string, sources: readonly string[], key: string, current: DFDPrefill,
): { content: string; sources: string[] } | null {
  const ctx = prefillValueOf(current, key);
  if (ctx.value === null || ctx.conflict || key === "justificativa") return null;
  let lines = content.split("\n");
  if (key === "identificacao.objeto") lines = replaceLine(lines, 1, LABELS[0][1], `Objeto: ${ctx.value}`);
  else if (key === "identificacao.unidade") lines = replaceLine(lines, 1, LABELS[1][1], `Setor/unidade demandante: ${ctx.value}`);
  else if (key === "identificacao.responsavel") lines = replaceLine(lines, 1, LABELS[2][1], `Responsável pela demanda: ${ctx.value}`);
  else if (key === "descricao") lines = replaceSectionBody(lines, 3, [ctx.value, HINT_DESC]);
  else if (key === "planejamento") lines = replaceSectionBody(lines, 5, [ctx.value]);
  else if (key === "orcamento") lines = replaceSectionBody(lines, 6, [ctx.value]);
  else if (key === "prioridade.grau" || key === "prioridade.prazo") {
    const p = parseDFD(content).values;
    const grau = key === "prioridade.grau" ? ctx.value : p["prioridade.grau"] ?? PRIORITY_PLACEHOLDER;
    const prazo = key === "prioridade.prazo" ? ctx.value : p["prioridade.prazo"] ?? P;
    lines = replaceLine(lines, 7, PRIORITY_RE, `Prioridade: ${grau} · Prazo pretendido para a contratação: ${prazo}`);
  } else if (key.startsWith("item:")) {
    lines = reconcileItemRow(lines, content, key.slice(5), current);
  } else return null;
  const mk = readMarkers(sources);
  mk.prefill[key] = { hash: hashOfField(key, ctx.value), origin: ctx.origin ?? "derived" };
  return { content: lines.join("\n"), sources: writeMarkers(sources, mk) };
}

function reconcileItemRow(lines: string[], content: string, itemKey: string, current: DFDPrefill): string[] {
  const it = current.items.find((i) => i.key === itemKey);
  if (!it) return lines;
  const parsed = parseDFD(content);
  if (!parsed.hasItemsTable) {
    // Sem tabela ainda: materializa a tabela com os itens do DOCUMENTO + este item (nada é removido).
    const s = sections(lines).find((x) => x.n === 4);
    if (!s) return lines;
    const body = lines.slice(s.start + 1, s.end).filter((l) => l.trim() !== "" && !/^Quantidade estimada:/.test(l));
    return replaceSectionBody(lines, 4, [...itemsTable([it]), ...body]);
  }
  const s = sections(lines).find((x) => x.n === 4)!;
  const rowIdx = lines.findIndex((l, i) => i > s.start && i < s.end && /^\|/.test(l.trim()) && (() => {
    const c = l.trim().replace(/^\||\|$/g, "").split("|").map((x) => x.trim());
    return c.length >= 4 && canonicalItemKey(c[1], c[2]) === itemKey;
  })());
  if (rowIdx >= 0) {
    const c = lines[rowIdx].trim().replace(/^\||\|$/g, "").split("|").map((x) => x.trim());
    return lines.map((l, i) => (i === rowIdx ? `| ${c[0]} | ${c[1]} | ${c[2]} | ${formatQuantity(it.plannedQuantity)} |` : l));
  }
  // Item conhecido pelo contexto e ausente no DFD: adiciona a linha ao fim da tabela.
  const lastRow = lines.reduce((acc, l, i) => (i > s.start && i < s.end && /^\|/.test(l.trim()) ? i : acc), -1);
  const n = parsed.items.length + 1;
  const out = [...lines];
  out.splice(lastRow + 1, 0, `| ${n} | ${cell(it.description)} | ${cell(it.unit)} | ${formatQuantity(it.plannedQuantity)} |`);
  return out;
}

/** Insere o rascunho de IA na seção 2 (justificativa) e grava o marcador de explicabilidade. */
export function applyAIJustification(
  content: string, sources: readonly string[], text: string, executionId: string, contextDigest: string,
): { content: string; sources: string[] } {
  const body = text.trim().split("\n");
  const lines = replaceSectionBody(content.split("\n"), 2, body);
  const mk = readMarkers(sources);
  mk.ai.justificativa = { hash: fieldHash(normalizeText(body.join("\n"))), executionId: executionId.replace(/[^A-Za-z0-9_-]/g, "") || "exec", contextDigest: contextDigest.slice(0, 16) };
  delete mk.prefill.justificativa;
  return { content: lines.join("\n"), sources: writeMarkers(sources, mk) };
}

// ─── Afirmações humanas extraídas do DFD salvo ─────────────────────────────────────────

export interface DFDAssertionDraft {
  path: ContextPath;
  value: FactValue;
  basisValueHash: string | null;
  fieldKey: string;
}

/**
 * O DFD SALVO é onde o servidor informa a necessidade UMA vez. Extrai, para os campos AFIRMÁVEIS, os
 * valores do documento que DIFEREM do contexto vigente (o que o humano informou/alterou). `basisValueHash`
 * = o valor pré-preenchido que o humano viu (superação consciente) — se o contexto mudou depois, fica
 * CONFLITO (não se escolhe em silêncio). Descrição/objeto seguem do Processo; justificativa é narrativa
 * (documento), não fato. Quantidade vinda da Pesquisa jamais é afirmada aqui.
 */
export function extractDFDAssertions(content: string, sources: readonly string[], ctx: ProcurementCanonicalContext): DFDAssertionDraft[] {
  const parsed = parseDFD(content);
  const mk = readMarkers(sources);
  const out: DFDAssertionDraft[] = [];
  const resolved = (path: ContextPath): CanonicalField => {
    const m = /^items\.([^.]+)\.(description|unit|plannedQuantity)$/.exec(path);
    if (m) {
      const it = ctx.items.find((i) => i.key === m[1]);
      return (it?.[m[2] as "description" | "unit" | "plannedQuantity"] ?? { valueHash: null }) as CanonicalField;
    }
    const [a, b] = path.split(".") as [keyof ProcurementCanonicalContext, string];
    return ((ctx[a] as unknown as Record<string, CanonicalField>)[b]);
  };
  for (const [fieldKey, path] of ASSERTABLE) {
    const v = parsed.values[fieldKey];
    if (v === null) continue;
    if (fieldHash(v) === resolved(path).valueHash) continue;
    out.push({ path, value: normalizeText(v), basisValueHash: mk.prefill[fieldKey]?.hash ?? resolved(path).valueHash ?? null, fieldKey });
  }
  for (const it of parsed.items) {
    const known = ctx.items.find((i) => i.key === it.key);
    if (!known || known.description.value === null) {
      out.push({ path: itemPath(it.key, "description"), value: normalizeText(it.description), basisValueHash: null, fieldKey: `item:${it.key}` });
      out.push({ path: itemPath(it.key, "unit"), value: normalizeText(it.unit), basisValueHash: null, fieldKey: `item:${it.key}` });
    }
    if (it.quantity !== null && fieldHash(it.quantity) !== (known?.plannedQuantity.valueHash ?? null)) {
      out.push({
        path: itemPath(it.key, "plannedQuantity"), value: it.quantity,
        basisValueHash: mk.prefill[`item:${it.key}`]?.hash ?? known?.plannedQuantity.valueHash ?? null, fieldKey: `item:${it.key}`,
      });
    }
  }
  return out;
}

/** Contagem segura (sem texto) do desfecho dos campos — métrica de redução de trabalho manual. */
export function summarizeFieldStates(views: readonly DFDFieldView[]): Record<DFDFieldState, number> {
  const out: Record<DFDFieldState, number> = { prefilled: 0, ai_draft: 0, user_modified: 0, stale: 0, conflict: 0, available: 0, unknown: 0 };
  for (const v of views) out[v.state]++;
  return out;
}
