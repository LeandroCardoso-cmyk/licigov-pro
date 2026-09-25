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
  /** Id estável do Item Canônico. */
  key: string;
  /** Fingerprint (descrição+unidade) — só para ligar linhas do DFD ao item. */
  fingerprint: string;
  /** Código do lote (quando a contratação é por lotes). */
  lotCode: string | null;
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
  /** Contratação por lotes ⇒ a tabela do DFD ganha a coluna "Lote". */
  hasLots: boolean;
}

function pv(f: CanonicalField): DFDPrefillValue {
  if (f.status === "conflict") return { value: null, origin: null, conflict: true };
  return { value: f.value === null ? null : String(f.value), origin: f.source?.type ?? null, conflict: false };
}

/** DFDPrefillProjection — o que o contexto sabe, no vocabulário do DFD. Fatos em conflito NÃO entram. */
export function buildDFDPrefill(ctx: ProcurementCanonicalContext): DFDPrefill {
  const obj = pv(ctx.process.object);
  const lotCode = new Map((ctx.lots ?? []).map((l) => [l.id, l.code]));
  const items = ctx.items
    .filter((i) => i.description.value !== null)
    .map((i) => ({
      key: i.key,
      fingerprint: i.fingerprint ?? canonicalItemKey(String(i.description.value), String(i.unit.value ?? "UN")),
      lotCode: i.lotId ? lotCode.get(i.lotId) ?? null : null,
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
    hasLots: items.some((i) => i.lotCode !== null),
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

function itemsTable(items: readonly DFDPrefillItem[], hasLots: boolean): string[] {
  if (hasLots) {
    return [
      "| Lote | Item | Descrição | Unidade | Quantidade prevista |",
      "| --- | --- | --- | --- | --- |",
      ...items.map((it, i) => `| ${cell(it.lotCode ?? "—")} | ${i + 1} | ${cell(it.description)} | ${cell(it.unit)} | ${formatQuantity(it.plannedQuantity)} |`),
    ];
  }
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
    ...(prefill.items.length ? itemsTable(prefill.items, prefill.hasLots) : [`Quantidade estimada: ${P} · Unidade: ${P}`]),
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

export interface ParsedDFDItem {
  fingerprint: string; lotCode: string | null; description: string; unit: string; quantityRaw: string; quantity: number | null;
  /** Número da coluna "Item" (posição exibida), quando presente. */
  itemNo: number | null;
}
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
  const splitRow = (r: string) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  const header = rows.map(splitRow).find((c) => c.some((x) => /quantidade prevista/i.test(x)));
  const hasItemsTable = !!header;
  const items: ParsedDFDItem[] = [];
  if (header) {
    // Colunas pelo NOME do cabeçalho (com ou sem "Lote") — robusto a reordenação manual.
    const col = (re: RegExp) => header.findIndex((x) => re.test(x));
    const iLot = col(/^lote$/i), iNo = col(/^item$/i), iDesc = col(/^descri/i), iUnit = col(/^unidade$/i), iQty = col(/quantidade prevista/i);
    for (const r of rows) {
      const cells = splitRow(r);
      if (cells === header || cells.length < header.length || cells.every((c) => /^:?-+:?$/.test(c)) || cells.join("|") === header.join("|")) continue;
      const description = cells[iDesc] ?? "";
      const unit = cells[iUnit] ?? "";
      const quantityRaw = cells[iQty] ?? "";
      if (!description || isPlaceholder(description)) continue;
      const lotRaw = iLot >= 0 ? (cells[iLot] ?? "").trim() : "";
      items.push({
        fingerprint: canonicalItemKey(description, unit), lotCode: lotRaw && lotRaw !== "—" && lotRaw !== "-" ? lotRaw : null,
        description, unit: unit || "UN", quantityRaw, quantity: parseQuantityPtBr(quantityRaw),
        itemNo: iNo >= 0 && /^\d+$/.test(cells[iNo] ?? "") ? Number(cells[iNo]) : null,
      });
    }
  }
  return { values, items, hasItemsTable };
}

/** Normaliza código de lote para comparação ("Lote 01" ≡ "01" ≡ "1"). */
function lotKey(code: string | null): string | null {
  if (!code) return null;
  const t = normalizeText(code).toUpperCase().replace(/^LOTE\s*/, "").trim();
  return /^\d+$/.test(t) ? String(Number(t)) : t;
}

export interface LinkedDFDRow {
  row: ParsedDFDItem;
  itemId: string | null;
  ambiguous: boolean;
  /** Como a linha foi ligada: linhagem persistida (id), vínculo de fonte persistido, ou recuperação por fingerprint. */
  via: "lineage" | "source_link" | "fingerprint" | null;
}

/** Chave estrutural da LINHA como escrita no DFD (descrição+unidade normalizadas + lote) — não é identidade do item. */
export function dfdRowKey(fingerprint: string, lotCode: string | null): string {
  return factValueHash(`dfd-row:v1:${fingerprint}:${lotKey(lotCode) ?? ""}`);
}

/**
 * Liga cada linha da tabela do DFD a UM Item Canônico. IDENTIDADE = `canonicalItemId` persistido na linhagem
 * do documento (marcador `pr:<canonicalItemId>=<itemNo>:<rowKey>` em `generated_documents.sources`):
 *  1. linhagem: (nº do item + chave da linha) exatos; depois só a chave da linha; depois só o nº — sempre
 *     sem ambiguidade e apenas para itens ATIVOS. Mudar descrição/unidade/lote do item na Área de Itens
 *     NÃO desfaz o vínculo (a linha continua apontando para o mesmo id);
 *  2. vínculo de fonte persistido (linha do DFD confirmada como item na Área de Itens);
 *  3. RECUPERAÇÃO controlada (documento legado/linha sem linhagem): fingerprint (+ lote) exato contra itens
 *     ainda não ligados — 1 ⇒ liga; 0 ⇒ não liga; >1 ⇒ AMBÍGUO (nunca escolhe).
 * Cada item liga-se a no máximo uma linha.
 */
export function linkDFDRows(
  parsed: ParsedDFD, items: readonly DFDPrefillItem[], sources: readonly string[],
  sourceLinks: ReadonlyArray<{ fingerprint: string; lotKey: string | null; itemId: string }> = [],
): LinkedDFDRow[] {
  const active = new Set(items.map((i) => i.key));
  const lineage = Object.entries(readMarkers(sources).rows).filter(([id]) => active.has(id));
  const used = new Set<string>();
  const out: LinkedDFDRow[] = parsed.items.map((row) => ({ row, itemId: null, ambiguous: false, via: null }));
  const assign = (i: number, id: string, via: LinkedDFDRow["via"]) => { out[i] = { ...out[i], itemId: id, via }; used.add(id); };
  const pass = (pred: (row: ParsedDFDItem, m: { itemNo: number; rowKey: string }) => boolean) => {
    out.forEach((o, i) => {
      if (o.itemId) return;
      const hits = lineage.filter(([id, m]) => !used.has(id) && pred(o.row, m));
      if (hits.length === 1) assign(i, hits[0][0], "lineage");
    });
  };
  const rk = (r: ParsedDFDItem) => dfdRowKey(r.fingerprint, r.lotCode);
  pass((r, m) => r.itemNo !== null && r.itemNo === m.itemNo && rk(r) === m.rowKey);
  pass((r, m) => rk(r) === m.rowKey);
  pass((r, m) => r.itemNo !== null && r.itemNo === m.itemNo);
  out.forEach((o, i) => {
    if (o.itemId) return;
    const hits = sourceLinks.filter((l) => active.has(l.itemId) && !used.has(l.itemId) && l.fingerprint === o.row.fingerprint && (l.lotKey ?? null) === lotKey(o.row.lotCode));
    if (hits.length === 1) assign(i, hits[0].itemId, "source_link");
  });
  out.forEach((o, i) => {
    if (o.itemId) return;
    const lk = lotKey(o.row.lotCode);
    const same = items.filter((it) => it.fingerprint === o.row.fingerprint && (lk === null || lotKey(it.lotCode) === lk) && !used.has(it.key));
    if (same.length === 1) assign(i, same[0].key, "fingerprint");
    else out[i] = { ...o, ambiguous: same.length > 1 };
  });
  return out;
}

/** Regrava a linhagem (`pr:`) a partir do vínculo ATUAL das linhas — preserva a identidade após edições. */
export function refreshRowLineage(content: string, sources: readonly string[], items: readonly DFDPrefillItem[]): string[] {
  const mk = readMarkers(sources);
  mk.rows = {};
  for (const l of linkDFDRows(parseDFD(content), items, sources)) {
    if (l.itemId && l.row.itemNo !== null) mk.rows[l.itemId] = { itemNo: l.row.itemNo, rowKey: dfdRowKey(l.row.fingerprint, l.row.lotCode) };
  }
  return writeMarkers(sources, mk);
}

// ─── Marcadores de linhagem (generated_documents.sources) ───────────────────────────────

export interface DFDMarkers {
  contextDigest: string | null;
  contextVersion: number | null;
  /** Valor pré-preenchido por campo: hash + origem (o que o sistema colocou lá). */
  prefill: Record<string, { hash: string; origin: DFDFieldOrigin }>;
  /** Rascunho de IA por campo: hash do texto + execução + digest do contexto usado. */
  ai: Record<string, { hash: string; executionId: string; contextDigest: string }>;
  /** LINHAGEM das linhas de item: canonicalItemId → (nº do item, chave da linha como escrita). */
  rows: Record<string, { itemNo: number; rowKey: string }>;
}

const MARKER_PREFIXES = ["ctx:", "ctxdigest:", "ctxv:", "pf:", "ai:", "pr:"];

export function isAssistMarker(m: string): boolean {
  return MARKER_PREFIXES.some((p) => m.startsWith(p));
}

export function readMarkers(sources: readonly string[]): DFDMarkers {
  const out: DFDMarkers = { contextDigest: null, contextVersion: null, prefill: {}, ai: {}, rows: {} };
  for (const s of sources ?? []) {
    let m: RegExpExecArray | null;
    if ((m = /^ctxdigest:([a-f0-9]+)$/.exec(s))) out.contextDigest = m[1];
    else if ((m = /^ctxv:(\d+)$/.exec(s))) out.contextVersion = Number(m[1]);
    else if ((m = /^pf:([^=]+)=([a-f0-9∅]+)@([a-z_]+)$/.exec(s))) out.prefill[m[1]] = { hash: m[2], origin: m[3] as DFDFieldOrigin };
    else if ((m = /^ai:([^=]+)=([a-f0-9]+)@([A-Za-z0-9_-]+)@([a-f0-9]+)$/.exec(s))) out.ai[m[1]] = { hash: m[2], executionId: m[3], contextDigest: m[4] };
    else if ((m = /^pr:([a-f0-9]+)=(\d+):([a-f0-9]{16})$/.exec(s))) out.rows[m[1]] = { itemNo: Number(m[2]), rowKey: m[3] };
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
  for (const k of Object.keys(mk.rows ?? {}).sort()) out.push(`pr:${k}=${mk.rows[k].itemNo}:${mk.rows[k].rowKey}`);
  return out;
}

/** Hash de valor de CAMPO do documento (mesma normalização dos fatos). */
export function fieldHash(v: FactValue): string {
  return factValueHash(v === null ? null : typeof v === "number" ? v : normalizeText(v));
}

/** Marcadores de prefill para o conteúdo recém-renderizado (só campos com valor vindo do contexto). */
export function prefillMarkers(prefill: DFDPrefill): DFDMarkers {
  const mk: DFDMarkers = { contextDigest: prefill.contextDigest.slice(0, 16), contextVersion: prefill.contextVersion, prefill: {}, ai: {}, rows: {} };
  for (const [k, v] of Object.entries(prefill.values)) {
    if (v.value !== null && v.origin) mk.prefill[k] = { hash: fieldHash(v.value), origin: v.origin };
  }
  prefill.items.forEach((it, i) => {
    if (it.plannedQuantity !== null && it.qtyOrigin) mk.prefill[`item:${it.key}`] = { hash: fieldHash(it.plannedQuantity), origin: it.qtyOrigin };
    if (prefill.hasLots) mk.prefill[`itemlot:${it.key}`] = { hash: lotFieldHash(it.lotCode), origin: "user" };
    // Linhagem: a linha i+1 da tabela É o Item Canônico `it.key` (identidade persistida no documento).
    mk.rows[it.key] = { itemNo: i + 1, rowKey: dfdRowKey(it.fingerprint, it.lotCode) };
  });
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

function lotFieldHash(code: string | null): string {
  return fieldHash(lotKey(code === "—" ? null : code) ?? "—");
}

function prefillValueOf(prefill: DFDPrefill, key: string): DFDPrefillValue {
  if (key.startsWith("itemlot:")) {
    const it = prefill.items.find((i) => `itemlot:${i.key}` === key);
    return it ? { value: it.lotCode ?? "—", origin: "user", conflict: false } : { value: null, origin: null, conflict: false };
  }
  if (key.startsWith("item:")) {
    const it = prefill.items.find((i) => `item:${i.key}` === key);
    if (!it) return { value: null, origin: null, conflict: false };
    return { value: it.plannedQuantity === null ? null : formatQuantity(it.plannedQuantity), origin: it.qtyOrigin, conflict: it.qtyConflict };
  }
  return prefill.values[key] ?? { value: null, origin: null, conflict: false };
}

function docValueOf(parsed: ParsedDFD, linked: readonly LinkedDFDRow[], key: string): string | null {
  if (key.startsWith("itemlot:")) {
    const it = linked.find((l) => l.itemId !== null && `itemlot:${l.itemId}` === key)?.row;
    return it ? it.lotCode ?? "—" : null;
  }
  if (key.startsWith("item:")) {
    const it = linked.find((l) => l.itemId !== null && `item:${l.itemId}` === key)?.row;
    return it && it.quantity !== null ? formatQuantity(it.quantity) : null;
  }
  return parsed.values[key] ?? null;
}

function hashOfField(key: string, v: string | null): string {
  if (v === null) return fieldHash(null);
  if (key.startsWith("itemlot:")) return lotFieldHash(v);
  if (key.startsWith("item:")) {
    const n = parseQuantityPtBr(v);
    return fieldHash(n);
  }
  return fieldHash(v);
}

function itemLabel(prefill: DFDPrefill, key: string): string {
  const lot = key.startsWith("itemlot:");
  const k = key.slice(lot ? 8 : 5);
  const d = prefill.items.find((i) => i.key === k)?.description ?? "item";
  return lot ? `Lote — ${d}` : `Quantidade prevista — ${d}`;
}

/**
 * Estado de cada campo = f(conteúdo atual, marcadores gravados, projeção ATUAL do contexto). Nada é
 * persistido: reload/polling nunca "voltam" um valor — só o conteúdo salvo manda.
 */
export function computeDFDFieldStates(content: string, sources: readonly string[], current: DFDPrefill): DFDFieldView[] {
  const parsed = parseDFD(content);
  const linked = linkDFDRows(parsed, current.items, sources);
  const mk = readMarkers(sources);
  // Lote por item só quando a tabela do DFD tem a coluna "Lote" e a contratação usa lotes.
  const lotCol = current.hasLots && parsed.items.length > 0 && hasLotColumn(content);
  const keys: string[] = [
    ...Object.keys(DFD_FIELD_LABELS), ...current.items.map((i) => `item:${i.key}`),
    ...(lotCol ? current.items.map((i) => `itemlot:${i.key}`) : []),
  ];
  return keys.map((key) => {
    const doc = docValueOf(parsed, linked, key);
    const ctx = prefillValueOf(current, key);
    const pf = mk.prefill[key];
    const ai = mk.ai[key];
    const docH = hashOfField(key, doc);
    const ctxH = ctx.value === null ? null : hashOfField(key, ctx.value);
    const label = key.startsWith("item") && key.includes(":") ? itemLabel(current, key) : DFD_FIELD_LABELS[key] ?? key;
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

/** Linhas da tabela do DFD sem Item Canônico correspondente (o DFD não cria itens sozinho). */
export function unlinkedDFDRows(content: string, sources: readonly string[], current: DFDPrefill): ParsedDFDItem[] {
  return linkDFDRows(parseDFD(content), current.items, sources).filter((l) => l.itemId === null).map((l) => l.row);
}

function hasLotColumn(content: string): boolean {
  return /^\|\s*Lote\s*\|/im.test(content);
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
  } else if (key.startsWith("itemlot:")) {
    const next = reconcileItemLot(lines, content, sources, key.slice(8), current);
    if (!next) return null;
    lines = next;
  } else if (key.startsWith("item:")) {
    lines = reconcileItemRow(lines, content, sources, key.slice(5), current);
  } else return null;
  const mk = readMarkers(sources);
  mk.prefill[key] = { hash: hashOfField(key, ctx.value), origin: ctx.origin ?? "derived" };
  const newContent = lines.join("\n");
  let newSources = writeMarkers(sources, mk);
  // A linha continua sendo o MESMO Item Canônico: a linhagem é regravada a partir do vínculo atual.
  if (key.startsWith("item")) newSources = refreshRowLineage(newContent, newSources, current.items);
  return { content: newContent, sources: newSources };
}

/** Atualiza a célula "Lote" da linha ligada ao item (o item e o id NÃO mudam — só o pertencimento exibido). */
function reconcileItemLot(lines: string[], content: string, sources: readonly string[], itemKey: string, current: DFDPrefill): string[] | null {
  const it = current.items.find((i) => i.key === itemKey);
  if (!it || !hasLotColumn(content)) return null;
  const rows = itemTableRows(lines);
  if (!rows) return null;
  const idx = linkDFDRows(parseDFD(content), current.items, sources).findIndex((l) => l.itemId === itemKey);
  if (idx < 0 || rows.data[idx] === undefined) return null;
  const c = rows.split(lines[rows.data[idx]]);
  c[rows.header.findIndex((x) => /^lote$/i.test(x))] = cell(it.lotCode ?? "—");
  return lines.map((l, i) => (i === rows.data[idx] ? `| ${c.join(" | ")} |` : l));
}

/** Linhas físicas da tabela de itens: cabeçalho e linhas de dados na MESMA ordem em que parseDFD as lê. */
function itemTableRows(lines: string[]): { header: string[]; data: number[]; all: number[]; split: (l: string) => string[] } | null {
  const s = sections(lines).find((x) => x.n === 4);
  if (!s) return null;
  const all: number[] = [];
  lines.forEach((l, i) => { if (i > s.start && i < s.end && /^\|/.test(l.trim())) all.push(i); });
  const split = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((x) => x.trim());
  const hi = all.find((i) => /quantidade prevista/i.test(lines[i]));
  if (hi === undefined) return null;
  const header = split(lines[hi]);
  const iDesc = header.findIndex((x) => /^descri/i.test(x));
  const data = all.filter((i) => {
    const c = split(lines[i]);
    return !(/quantidade prevista/i.test(lines[i]) || c.every((x) => /^:?-+:?$/.test(x))) && c.length >= header.length && !!c[iDesc] && !isPlaceholder(c[iDesc]);
  });
  return { header, data, all, split };
}

function reconcileItemRow(lines: string[], content: string, sources: readonly string[], itemKey: string, current: DFDPrefill): string[] {
  const it = current.items.find((i) => i.key === itemKey);
  if (!it) return lines;
  const parsed = parseDFD(content);
  if (!parsed.hasItemsTable) {
    // Sem tabela ainda: materializa a tabela com este item (nada do documento é removido).
    const s = sections(lines).find((x) => x.n === 4);
    if (!s) return lines;
    const body = lines.slice(s.start + 1, s.end).filter((l) => l.trim() !== "" && !/^Quantidade estimada:/.test(l));
    return replaceSectionBody(lines, 4, [...itemsTable([it], current.hasLots), ...body]);
  }
  const s = sections(lines).find((x) => x.n === 4)!;
  const tableRows: number[] = [];
  lines.forEach((l, i) => { if (i > s.start && i < s.end && /^\|/.test(l.trim())) tableRows.push(i); });
  const split = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((x) => x.trim());
  const header = split(lines[tableRows.find((i) => /quantidade prevista/i.test(lines[i]))!]);
  const iQty = header.findIndex((x) => /quantidade prevista/i.test(x));
  const hasLotCol = header.some((x) => /^lote$/i.test(x));
  const linked = linkDFDRows(parsed, current.items, sources);
  const idx = linked.findIndex((l) => l.itemId === itemKey);
  // Linhas de dados na MESMA ordem em que parseDFD as leu.
  const dataRows = tableRows.filter((i) => {
    const c = split(lines[i]);
    return !(/quantidade prevista/i.test(lines[i]) || c.every((x) => /^:?-+:?$/.test(x))) && c.length >= header.length;
  }).filter((i) => {
    const c = split(lines[i]);
    const d = c[header.findIndex((x) => /^descri/i.test(x))] ?? "";
    return !!d && !isPlaceholder(d);
  });
  if (idx >= 0 && dataRows[idx] !== undefined) {
    const c = split(lines[dataRows[idx]]);
    c[iQty] = formatQuantity(it.plannedQuantity);
    return lines.map((l, i) => (i === dataRows[idx] ? `| ${c.join(" | ")} |` : l));
  }
  // Item conhecido pelo contexto e ausente no DFD: adiciona a linha ao fim da tabela.
  const lastRow = tableRows[tableRows.length - 1];
  const n = parsed.items.length + 1;
  const row = hasLotCol
    ? `| ${cell(it.lotCode ?? "—")} | ${n} | ${cell(it.description)} | ${cell(it.unit)} | ${formatQuantity(it.plannedQuantity)} |`
    : `| ${n} | ${cell(it.description)} | ${cell(it.unit)} | ${formatQuantity(it.plannedQuantity)} |`;
  const out = [...lines];
  out.splice(lastRow + 1, 0, row);
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
    const [a, b] = path.split(".") as [keyof ProcurementCanonicalContext, string];
    return ((ctx[a] as unknown as Record<string, CanonicalField>)[b]);
  };
  for (const [fieldKey, path] of ASSERTABLE) {
    const v = parsed.values[fieldKey];
    if (v === null) continue;
    if (fieldHash(v) === resolved(path).valueHash) continue;
    out.push({ path, value: normalizeText(v), basisValueHash: mk.prefill[fieldKey]?.hash ?? resolved(path).valueHash ?? null, fieldKey });
  }
  // Itens: o DFD NÃO cria itens (dono = Itens da contratação). Só a quantidade PREVISTA de linhas ligadas
  // a UM Item Canônico é afirmada; linhas sem item ficam como "sem correspondência" (candidatos).
  for (const l of linkDFDRows(parsed, buildDFDPrefill(ctx).items, sources)) {
    if (!l.itemId || l.row.quantity === null) continue;
    const known = ctx.items.find((i) => i.key === l.itemId)!;
    if (fieldHash(l.row.quantity) === (known.plannedQuantity.valueHash ?? null)) continue;
    const basis = known.plannedQuantity.status === "conflict" ? mk.prefill[`item:${l.itemId}`]?.hash ?? null
      : mk.prefill[`item:${l.itemId}`]?.hash ?? known.plannedQuantity.valueHash ?? null;
    out.push({ path: itemPath(l.itemId, "plannedQuantity"), value: l.row.quantity, basisValueHash: basis, fieldKey: `item:${l.itemId}` });
  }
  return out;
}

/** Contagem segura (sem texto) do desfecho dos campos — métrica de redução de trabalho manual. */
export function summarizeFieldStates(views: readonly DFDFieldView[]): Record<DFDFieldState, number> {
  const out: Record<DFDFieldState, number> = { prefilled: 0, ai_draft: 0, user_modified: 0, stale: 0, conflict: 0, available: 0, unknown: 0 };
  for (const v of views) out[v.state]++;
  return out;
}
