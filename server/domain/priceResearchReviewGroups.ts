/**
 * Pesquisa de Preços — PROJEÇÃO DE REVISÃO por ITEM LÓGICO (leitura; nada é persistido).
 *
 * O staging guarda uma linha por COTAÇÃO (evidência de preço individual, auditável). A revisão humana, porém, é
 * sobre o ITEM: descrição/unidade/quantidade + suas cotações + média + reconciliação. Esta projeção agrupa as
 * linhas de staging em itens lógicos SEM alterar o modelo canônico (cada cotação continua sendo uma linha com
 * identidade, valor, lineage, warnings, confiança e status próprios).
 *
 * Identidade do item (determinística; sem fuzzy, sem LLM, sem similaridade):
 *   1. chave lógica CANÔNICA do domínio — `intelligentItemLogicalKey` (descrição normalizada | unidade canônica |
 *      quantidade em milésimos) sobre o conteúdo EFETIVO (raw + correção). É a MESMA identidade que a promoção usa
 *      para consolidar cotações em Itens Inteligentes ⇒ N grupos revisados = N Itens Inteligentes promovidos.
 *   2. conferida contra a identidade ESTRUTURAL produzida pelo parser (linha do documento: página/tabela/linha e o
 *      identificador hierárquico do layout). Divergência entre as duas NUNCA é resolvida em silêncio:
 *        - duas linhas distintas do documento (com várias cotações cada) caindo na mesma chave ⇒ ITEM_IDENTITY_COLLISION;
 *        - uma linha do documento repartida em chaves diferentes (ex.: descrição corrigida em uma cotação) ⇒
 *          ITEM_IDENTITY_SPLIT.
 *      Em ambos os casos o grupo fica `identityStatus: "ambiguous"` e a decisão EM LOTE do item é bloqueada
 *      (fail closed) — as cotações continuam revisáveis individualmente.
 *
 * Médias (nenhuma sobrescreve a outra):
 *   - documentAverageCents   → média IMPRESSA no documento (evidência histórica; vem da reconciliação do layout);
 *   - extractedAverageCents  → média calculada de TODAS as cotações com valor válido (como extraídas/corrigidas);
 *   - consideredAverageCents → média das cotações com valor válido NÃO rejeitadas/puladas (reflete a revisão).
 *
 * Puro e determinístico: mesma entrada ⇒ mesma saída (ordem, chaves, revisões).
 */
import { createHash } from "crypto";
import { averageCents, type Cents } from "./money";
import { computeEffectiveContent, resolveEffectiveMoney, resolveEffectiveQuantity } from "./importCorrectionFields";
import { intelligentItemLogicalKey, normalizeDescription } from "./priceQuoteConsolidation";

/** Tolerância da reconciliação média impressa × calculada (mesma do layout: 1 centavo). */
export const REVIEW_AVERAGE_TOLERANCE_CENTS = 1;

export type QuoteReviewStatus = "pending" | "approved" | "rejected" | "skipped";

/**
 * Status DERIVADO do item (nunca persistido):
 *   pending            → nenhuma cotação decidida;
 *   partially_reviewed → há cotações decididas e cotações pendentes;
 *   reviewed           → nenhuma pendente e ao menos uma aceita (o item será promovido com as aceitas);
 *   rejected           → nenhuma pendente e nenhuma aceita (todas rejeitadas/puladas — o item não será promovido).
 */
export type ReviewGroupStatus = "pending" | "partially_reviewed" | "reviewed" | "rejected";

export type GroupIdentityStatus = "consistent" | "ambiguous";

/** Linha de staging (subconjunto) que a projeção consome. */
export interface ReviewStagingRow {
  id:                  number;
  rawDescription:      string | null;
  rawQuantity:         string | null;
  rawUnit:             string | null;
  rawUnitPrice:        string | null;
  rawTotalPrice?:      string | null;
  rawSupplier?:        string | null;
  rawBrand?:           string | null;
  rawModel?:           string | null;
  rawNotes?:           string | null;
  rawSource?:          string | null;
  rawTypedValues?:     unknown;
  rawMetadata?:        unknown;
  sourceLocation?:     unknown;
  confidenceMetadata?: unknown;
  extractionWarnings?: unknown;
  reviewStatus:        QuoteReviewStatus;
  correctionRevision?: number | null;
  correctedPayload?:   unknown;
}

export interface ReviewWarning {
  code:     string;
  severity: "info" | "warning";
  message:  string;
  /** Quantas cotações do item carregam a advertência (1 para advertências do próprio grupo). */
  count:    number;
}

/** Localização estrutural da cotação no documento (sem conteúdo). */
export interface QuoteLineage {
  page:       number | null;
  sheet:      string | null;
  tableIndex: number | null;
  row:        number | null;
  column:     number | null;
  /** Identificador hierárquico do item no documento (layout), ex. "I / 001 / 003". */
  identifier: string | null;
  /** Chave estrutural da linha do documento (null quando o parser não a informa). */
  sourceRowKey: string | null;
}

export interface PriceResearchReviewQuote {
  stagingRowId:    number;
  /** Identidade REAL da fonte (fornecedor/fonte efetivos). `null` ⇒ "Fonte não identificada". */
  sourceLabel:     string | null;
  sourceResolved:  boolean;
  /** Valor unitário efetivo em centavos; `null` quando ausente/ambíguo/inválido (não entra em média). */
  amountCents:     Cents | null;
  amountIssue:     "ambiguous" | "invalid" | "empty" | null;
  /** Texto exibido no documento (raw imutável) — evidência. */
  rawAmount:       string | null;
  status:          QuoteReviewStatus;
  corrected:       boolean;
  correctionRevision: number;
  confidence:      number | null;
  warnings:        ReviewWarning[];
  lineage:         QuoteLineage;
}

export interface ReviewStatusCounts { pending: number; approved: number; rejected: number; skipped: number }

export interface PriceResearchReviewGroup {
  /** Chave ESTÁVEL do grupo (hash da chave lógica canônica). Não é PK nem identidade oficial. */
  groupKey:        string;
  /** Revisão otimista do grupo (membros + status + revisão de correção). Muda ⇒ decisão em lote rejeitada. */
  revision:        string;
  /** Ordem de exibição (1-based, determinística — ordem do documento). */
  position:        number;
  description:     string;
  unit:            string;
  /** Quantidade canônica (decimal com ponto) ou null. */
  quantity:        string | null;
  identity: {
    status:         GroupIdentityStatus;
    /** Identificadores hierárquicos do documento presentes no grupo (ordenados). */
    identifiers:    string[];
    sourceRowKeys:  string[];
  };
  quoteCount:          number;
  /** Cotações com valor válido (> 0). */
  pricedQuoteCount:    number;
  /** Cotações com valor válido e não rejeitadas/puladas. */
  consideredQuoteCount: number;
  statusCounts:        ReviewStatusCounts;
  status:              ReviewGroupStatus;
  documentAverageCents:   Cents | null;
  extractedAverageCents:  Cents | null;
  consideredAverageCents: Cents | null;
  /** extraída × documento: true/false; null quando o documento não informa a média. */
  averageMatches:      boolean | null;
  /** Há cotações excluídas (rejeitadas/puladas) — a média considerada difere da extraída por decisão humana. */
  hasExclusions:       boolean;
  unresolvedSourceCount: number;
  warnings:            ReviewWarning[];
  quotes:              PriceResearchReviewQuote[];
}

export interface PriceResearchReviewProjection {
  logicalItemCount: number;
  quoteCount:       number;
  /** Contagem de ITENS por status derivado. */
  itemStatusCounts: Record<ReviewGroupStatus, number>;
  /** Contagem de COTAÇÕES por status de revisão (inclui as sem item identificado). */
  quoteStatusCounts: ReviewStatusCounts;
  groups:           PriceResearchReviewGroup[];
  /** Linhas sem descrição efetiva: não formam item (a promoção também as ignora), mas seguem revisáveis. */
  unassignedQuotes: PriceResearchReviewQuote[];
  ambiguousGroupCount: number;
}

// ─── helpers puros ───────────────────────────────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v == null) return null;
  if (typeof v === "string") {
    try { const p = JSON.parse(v) as unknown; return p && typeof p === "object" && !Array.isArray(p) ? p as Record<string, unknown> : null; } catch { return null; }
  }
  return typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
}
function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") { try { const p = JSON.parse(v) as unknown; return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const clean = (v: string | null | undefined): string => (v ?? "").toString().replace(/\s+/g, " ").trim();

/** Chave estável do grupo a partir da chave lógica canônica. */
export function reviewGroupKey(logicalKey: string): string {
  return createHash("sha256").update(`price-review-group:v1:${logicalKey}`).digest("hex").slice(0, 32);
}

/** Lineage estrutural de uma linha de staging (layout primeiro; sourceLocation como fallback). */
export function quoteLineage(row: Pick<ReviewStagingRow, "rawMetadata" | "sourceLocation">): QuoteLineage {
  const layout = asRecord(asRecord(row.rawMetadata)?.layout);
  const prov = asRecord(row.sourceLocation);
  const loc = asRecord(prov?.location) ?? {};
  const page = num(layout?.page) ?? num(loc.page);
  const sheet = str(loc.sheet);
  const tableIndex = num(layout?.tableIndex) ?? num(prov?.tableIndex);
  const row_ = num(layout?.row) ?? num(loc.row);
  const column = num(loc.column);
  const identifier = str(layout?.identifier);
  const sourceRowKey = row_ === null ? null
    : `${sheet !== null ? `s:${sheet}` : `p:${page ?? 0}`}|t:${tableIndex ?? 0}|r:${row_}`;
  return { page, sheet, tableIndex, row: row_, column, identifier, sourceRowKey };
}

/** Média impressa no documento para a linha (reconciliação do layout), se houver. */
function documentAverageOf(row: ReviewStagingRow): Cents | null {
  const recon = asRecord(asRecord(asRecord(row.rawMetadata)?.layout)?.reconciliation);
  const v = num(recon?.documentAverageCents);
  return v !== null && v > 0 ? Math.round(v) : null;
}

function confidenceOf(meta: unknown): number | null {
  const m = asRecord(meta);
  if (!m) return null;
  const c = m.overallScore ?? m.averageConfidence ?? m.score ?? m.confidence;
  return typeof c === "number" && c >= 0 && c <= 1 ? c : null;
}

function warningsOf(v: unknown): ReviewWarning[] {
  const out: ReviewWarning[] = [];
  for (const w of asArray(v)) {
    const r = asRecord(w);
    if (!r) continue;
    const code = str(r.code) ?? "WARNING";
    out.push({ code, severity: r.severity === "info" ? "info" : "warning", message: str(r.message) ?? code, count: 1 });
  }
  return out;
}

/** Agrega advertências por código (mensagem da primeira ocorrência; contagem de cotações). */
function aggregateWarnings(lists: ReviewWarning[][]): ReviewWarning[] {
  const byCode = new Map<string, ReviewWarning>();
  for (const list of lists) {
    const seen = new Set<string>();
    for (const w of list) {
      if (seen.has(w.code)) continue;
      seen.add(w.code);
      const prev = byCode.get(w.code);
      if (prev) { prev.count += 1; if (w.severity === "warning") prev.severity = "warning"; }
      else byCode.set(w.code, { ...w });
    }
  }
  return [...byCode.values()].sort((a, b) => (a.severity === b.severity ? a.code.localeCompare(b.code) : a.severity === "warning" ? -1 : 1));
}

/** Status derivado do item a partir das contagens das cotações. */
export function deriveGroupStatus(c: ReviewStatusCounts): ReviewGroupStatus {
  const total = c.pending + c.approved + c.rejected + c.skipped;
  if (c.pending === total) return "pending";
  if (c.pending > 0) return "partially_reviewed";
  return c.approved > 0 ? "reviewed" : "rejected";
}

/** Revisão otimista do grupo: membros + status + revisão de correção (ordenados). */
export function groupRevisionOf(members: readonly { id: number; reviewStatus: QuoteReviewStatus; correctionRevision?: number | null }[]): string {
  const sig = [...members].sort((a, b) => a.id - b.id).map((m) => `${m.id}:${m.reviewStatus}:${m.correctionRevision ?? 0}`).join("|");
  return createHash("sha256").update(sig).digest("hex").slice(0, 16);
}

function toQuote(row: ReviewStagingRow, eff: Record<string, string | null>): PriceResearchReviewQuote {
  const money = resolveEffectiveMoney(row as unknown as Record<string, unknown>, "unitPrice");
  const amountCents = money.cents !== null && money.cents > 0 ? money.cents : null;
  const amountIssue = amountCents !== null ? null
    : money.reason === "ambiguous" ? "ambiguous" : money.reason === "empty" ? "empty" : "invalid";
  const supplier = clean(eff.supplier);
  const source = clean(eff.source);
  const label = supplier || source || null;
  const overlay = asRecord(row.correctedPayload);
  return {
    stagingRowId: row.id,
    sourceLabel: label,
    sourceResolved: label !== null,
    amountCents,
    amountIssue,
    rawAmount: row.rawUnitPrice ?? null,
    status: row.reviewStatus,
    corrected: !!overlay && Object.keys(overlay).length > 0,
    correctionRevision: row.correctionRevision ?? 0,
    confidence: confidenceOf(row.confidenceMetadata),
    warnings: warningsOf(row.extractionWarnings),
    lineage: quoteLineage(row),
  };
}

function emptyCounts(): ReviewStatusCounts { return { pending: 0, approved: 0, rejected: 0, skipped: 0 }; }

/**
 * Projeta as linhas de staging de uma sessão de Pesquisa de Preços em itens lógicos com cotações subordinadas.
 * Lança `ReviewGroupKeyCollision` se duas chaves lógicas distintas produzirem a mesma `groupKey` (fail closed).
 */
export function buildPriceResearchReviewProjection(
  rows: readonly ReviewStagingRow[],
  options: { groupKeyOf?: (logicalKey: string) => string } = {},
): PriceResearchReviewProjection {
  const keyOf = options.groupKeyOf ?? reviewGroupKey;
  const ordered = [...rows].sort((a, b) => a.id - b.id);

  interface Acc { logicalKey: string; rows: ReviewStagingRow[]; quotes: PriceResearchReviewQuote[]; effs: Record<string, string | null>[] }
  const groups = new Map<string, Acc>();          // por groupKey
  const keyOwner = new Map<string, string>();     // groupKey → logicalKey (detecção de colisão)
  const unassignedQuotes: PriceResearchReviewQuote[] = [];
  const quoteStatusCounts = emptyCounts();
  const rowSize = new Map<string, number>();       // sourceRowKey → nº de cotações na sessão
  const rowGroups = new Map<string, Set<string>>(); // sourceRowKey → grupos onde aparece

  for (const row of ordered) {
    const eff = computeEffectiveContent(row as unknown as Record<string, unknown> & { correctedPayload?: unknown }, "price_research");
    const quote = toQuote(row, eff);
    quoteStatusCounts[row.reviewStatus] += 1;
    const rk = quote.lineage.sourceRowKey;
    if (rk) rowSize.set(rk, (rowSize.get(rk) ?? 0) + 1);

    const description = clean(eff.description ?? row.rawDescription);
    if (!normalizeDescription(description)) { unassignedQuotes.push(quote); continue; }
    const qty = resolveEffectiveQuantity(row as unknown as Record<string, unknown>);
    const logicalKey = intelligentItemLogicalKey({ description, unit: eff.unit ?? row.rawUnit, quantity: qty === null ? 0 : Number(qty) });
    const groupKey = keyOf(logicalKey);
    const owner = keyOwner.get(groupKey);
    if (owner !== undefined && owner !== logicalKey) throw new ReviewGroupKeyCollision(groupKey);
    keyOwner.set(groupKey, logicalKey);

    let acc = groups.get(groupKey);
    if (!acc) { acc = { logicalKey, rows: [], quotes: [], effs: [] }; groups.set(groupKey, acc); }
    acc.rows.push(row); acc.quotes.push(quote); acc.effs.push(eff);
    if (rk) { if (!rowGroups.has(rk)) rowGroups.set(rk, new Set()); rowGroups.get(rk)!.add(groupKey); }
  }

  const out: PriceResearchReviewGroup[] = [];
  let position = 0;
  for (const [groupKey, acc] of groups) { // Map preserva a 1ª aparição (ordem de staging = ordem do documento)
    position += 1;
    const first = acc.rows[0];
    const firstEff = acc.effs[0];
    const statusCounts = emptyCounts();
    for (const r of acc.rows) statusCounts[r.reviewStatus] += 1;

    const priced = acc.quotes.filter((q) => q.amountCents !== null);
    const considered = priced.filter((q) => q.status !== "rejected" && q.status !== "skipped");
    const extractedAverageCents = priced.length ? averageCents(priced.map((q) => q.amountCents!)) : null;
    const consideredAverageCents = considered.length ? averageCents(considered.map((q) => q.amountCents!)) : null;

    const groupWarnings: ReviewWarning[] = [];

    // Média impressa: única por item; valores diferentes entre linhas do mesmo grupo ⇒ não escolhe um.
    const docAvgs = [...new Set(acc.rows.map(documentAverageOf).filter((v): v is Cents => v !== null))];
    const documentAverageCents = docAvgs.length === 1 ? docAvgs[0] : null;
    if (docAvgs.length > 1) {
      groupWarnings.push({ code: "DOCUMENT_AVERAGE_INCONSISTENT", severity: "warning", count: 1,
        message: "As linhas deste item trazem médias impressas diferentes no documento — confira no original." });
    }
    const averageMatches = documentAverageCents !== null && extractedAverageCents !== null
      ? Math.abs(extractedAverageCents - documentAverageCents) <= REVIEW_AVERAGE_TOLERANCE_CENTS : null;
    if (averageMatches === false) {
      groupWarnings.push({ code: "GROUP_AVERAGE_MISMATCH", severity: "warning", count: 1,
        message: "A média impressa no documento difere da média calculada das cotações — revisão necessária." });
    }

    // Identidade estrutural × chave lógica.
    const multiRows = [...new Set(acc.quotes.map((q) => q.lineage.sourceRowKey).filter((k): k is string => !!k && (rowSize.get(k) ?? 0) > 1))];
    let ambiguous = false;
    if (multiRows.length > 1) {
      ambiguous = true;
      groupWarnings.push({ code: "ITEM_IDENTITY_COLLISION", severity: "warning", count: 1,
        message: `${multiRows.length} linhas distintas do documento resultaram no mesmo item (mesma descrição, unidade e quantidade). Revise as cotações individualmente.` });
    }
    if (multiRows.some((k) => (rowGroups.get(k)?.size ?? 0) > 1)) {
      ambiguous = true;
      groupWarnings.push({ code: "ITEM_IDENTITY_SPLIT", severity: "warning", count: 1,
        message: "Cotações da mesma linha do documento ficaram em itens diferentes (ex.: descrição, unidade ou quantidade corrigida em parte delas). Revise as cotações individualmente." });
    }

    const unresolvedSourceCount = acc.quotes.filter((q) => !q.sourceResolved).length;
    if (unresolvedSourceCount > 0) {
      groupWarnings.push({ code: "SOURCE_IDENTITY_UNRESOLVED", severity: "warning", count: unresolvedSourceCount,
        message: `${unresolvedSourceCount} cotação(ões) sem fonte identificada — informe a fonte na revisão.` });
    }
    const invalidAmounts = acc.quotes.length - priced.length;
    if (invalidAmounts > 0) {
      groupWarnings.push({ code: "QUOTE_WITHOUT_VALID_AMOUNT", severity: "warning", count: invalidAmounts,
        message: `${invalidAmounts} cotação(ões) sem valor válido — não entram na média.` });
    }

    const quoteWarnings = aggregateWarnings(acc.quotes.map((q) => q.warnings))
      .filter((w) => !groupWarnings.some((g) => g.code === w.code) && w.code !== "DOCUMENT_AVERAGE_MISMATCH");
    const identifiers = [...new Set(acc.quotes.map((q) => q.lineage.identifier).filter((v): v is string => !!v))].sort();
    const sourceRowKeys = [...new Set(acc.quotes.map((q) => q.lineage.sourceRowKey).filter((v): v is string => !!v))].sort();
    const qty = resolveEffectiveQuantity(first as unknown as Record<string, unknown>);

    out.push({
      groupKey,
      revision: groupRevisionOf(acc.rows),
      position,
      description: clean(firstEff.description ?? first.rawDescription),
      unit: clean(firstEff.unit ?? first.rawUnit),
      quantity: qty,
      identity: { status: ambiguous ? "ambiguous" : "consistent", identifiers, sourceRowKeys },
      quoteCount: acc.quotes.length,
      pricedQuoteCount: priced.length,
      consideredQuoteCount: considered.length,
      statusCounts,
      status: deriveGroupStatus(statusCounts),
      documentAverageCents,
      extractedAverageCents,
      consideredAverageCents,
      averageMatches,
      hasExclusions: statusCounts.rejected + statusCounts.skipped > 0,
      unresolvedSourceCount,
      warnings: [...groupWarnings, ...quoteWarnings],
      quotes: acc.quotes,
    });
  }

  const itemStatusCounts: Record<ReviewGroupStatus, number> = { pending: 0, partially_reviewed: 0, reviewed: 0, rejected: 0 };
  for (const g of out) itemStatusCounts[g.status] += 1;

  return {
    logicalItemCount: out.length,
    quoteCount: ordered.length,
    itemStatusCounts,
    quoteStatusCounts,
    groups: out,
    unassignedQuotes,
    ambiguousGroupCount: out.filter((g) => g.identity.status === "ambiguous").length,
  };
}

export class ReviewGroupKeyCollision extends Error {
  constructor(readonly groupKey: string) {
    super(`Colisão de chave de agrupamento (${groupKey}); projeção interrompida.`);
    this.name = "ReviewGroupKeyCollision";
  }
}

// ─── decisão em nível de item (planejamento puro) ─────────────────────────────────

export type GroupReviewAction = "approved" | "rejected" | "skipped";

export interface GroupReviewRequest { groupKey: string; expectedRevision: string }

export type GroupReviewPlanError =
  | { code: "GROUP_NOT_FOUND"; groupKey: string }
  | { code: "STALE_REVISION"; groupKey: string; currentRevision: string }
  | { code: "IDENTITY_AMBIGUOUS"; groupKey: string }
  | { code: "DUPLICATE_GROUP"; groupKey: string };

export interface GroupReviewPlanEntry {
  group: PriceResearchReviewGroup;
  /** Cotações PENDENTES do item (as únicas afetadas — decisões humanas anteriores são preservadas). */
  quoteIds: number[];
}

export type GroupReviewPlan = { ok: true; entries: GroupReviewPlanEntry[] } | { ok: false; error: GroupReviewPlanError };

/**
 * Planeja a decisão sobre itens lógicos: valida pertencimento (a groupKey precisa existir NESTA projeção — IDs de
 * cotação nunca vêm do cliente), revisão otimista e identidade consistente. Afeta só as cotações pendentes.
 */
export function planGroupReview(projection: PriceResearchReviewProjection, requests: readonly GroupReviewRequest[]): GroupReviewPlan {
  const byKey = new Map(projection.groups.map((g) => [g.groupKey, g]));
  const seen = new Set<string>();
  const entries: GroupReviewPlanEntry[] = [];
  for (const r of requests) {
    if (seen.has(r.groupKey)) return { ok: false, error: { code: "DUPLICATE_GROUP", groupKey: r.groupKey } };
    seen.add(r.groupKey);
    const group = byKey.get(r.groupKey);
    if (!group) return { ok: false, error: { code: "GROUP_NOT_FOUND", groupKey: r.groupKey } };
    if (group.revision !== r.expectedRevision) return { ok: false, error: { code: "STALE_REVISION", groupKey: r.groupKey, currentRevision: group.revision } };
    if (group.identity.status === "ambiguous") return { ok: false, error: { code: "IDENTITY_AMBIGUOUS", groupKey: r.groupKey } };
    entries.push({ group, quoteIds: group.quotes.filter((q) => q.status === "pending").map((q) => q.stagingRowId) });
  }
  return { ok: true, entries };
}
