/**
 * Pesquisa de Preços — helpers PUROS da revisão por ITEM LÓGICO (testáveis sem DOM).
 *
 * O servidor projeta as cotações (uma linha de staging por cotação) em itens lógicos; aqui só se formata e se
 * rotula. Regra fundamental: ITENS e COTAÇÕES são contados e rotulados separadamente — nunca quoteCount como
 * itemCount. Médias chegam em CENTAVOS (cálculo sempre do servidor).
 */
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { formatCentsBRL } from "@/lib/money";

type RouterOutputs = inferRouterOutputs<AppRouter>;
export type PriceResearchReview = RouterOutputs["ingestion"]["getPriceResearchReview"];
export type PriceResearchReviewGroup = PriceResearchReview["groups"][number];
export type PriceResearchReviewQuote = PriceResearchReviewGroup["quotes"][number];
export type ReviewGroupStatus = PriceResearchReviewGroup["status"];
export type QuoteStatus = PriceResearchReviewQuote["status"];
export type GroupReviewAction = "approved" | "rejected" | "skipped";

export const GROUP_STATUS_LABEL: Record<ReviewGroupStatus, string> = {
  pending:            "Pendente",
  partially_reviewed: "Revisão parcial",
  reviewed:           "Revisado",
  rejected:           "Rejeitado",
};

export const GROUP_STATUS_TONE: Record<ReviewGroupStatus, string> = {
  pending:            "border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-200",
  partially_reviewed: "border-sky-300 text-sky-800 dark:border-sky-800 dark:text-sky-200",
  reviewed:           "border-green-300 text-green-800 dark:border-green-800 dark:text-green-200",
  rejected:           "border-red-300 text-red-800 dark:border-red-800 dark:text-red-200",
};

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  pending:  "Pendente",
  approved: "Aceita",
  rejected: "Rejeitada",
  skipped:  "Pulada",
};

export const UNIDENTIFIED_SOURCE_LABEL = "Fonte não identificada";

export function formatMoney(cents: number | null | undefined): string {
  return cents == null ? "—" : formatCentsBRL(cents);
}

/** Quantidade canônica ("1", "12.5") → pt-BR com 2 casas ("1,00", "12,50"). */
export function formatQuantity(q: string | null | undefined): string {
  if (q == null || q.trim() === "") return "—";
  const n = Number(q);
  if (!Number.isFinite(n)) return q;
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
export const itemsLabel = (n: number) => plural(n, "item", "itens");
export const quotesLabel = (n: number) => plural(n, "cotação", "cotações");

/** Contadores da revisão: ITENS e COTAÇÕES em níveis separados. */
export function reviewCounters(counts: PriceResearchReview["counts"]) {
  return {
    primary: [
      { key: "items",   label: "Itens",           value: counts.logicalItems },
      { key: "quotes",  label: "Cotações",        value: counts.quotes },
      { key: "pending", label: "Itens pendentes", value: counts.items.pending + counts.items.partially_reviewed },
      { key: "reviewed", label: "Itens revisados", value: counts.items.reviewed },
      { key: "rejected", label: "Itens rejeitados", value: counts.items.rejected },
    ],
    /** Linha secundária — status das COTAÇÕES (nunca misturado com o de itens). */
    quoteLine: `Cotações: ${counts.quoteStatus.pending} pendentes · ${counts.quoteStatus.approved} aceitas · ${counts.quoteStatus.rejected} rejeitadas · ${counts.quoteStatus.skipped} puladas`,
  };
}

export type ReconciliationTone = "ok" | "mismatch" | "unavailable";

/** Reconciliação média do documento × média calculada — nunca escolhe silenciosamente uma das duas. */
export function reconciliationView(g: Pick<PriceResearchReviewGroup, "documentAverageCents" | "extractedAverageCents" | "averageMatches">): { tone: ReconciliationTone; label: string } {
  if (g.averageMatches === true) return { tone: "ok", label: "Valores reconciliados" };
  if (g.averageMatches === false) return { tone: "mismatch", label: "Divergência na média — revisão necessária" };
  return { tone: "unavailable", label: g.documentAverageCents == null ? "Média não informada no documento" : "Sem cotações válidas para conferir" };
}

/** Preço médio principal do item: o das cotações consideradas (igual ao extraído enquanto nada foi excluído). */
export function mainAverage(g: Pick<PriceResearchReviewGroup, "consideredAverageCents" | "extractedAverageCents" | "hasExclusions">): { cents: number | null; label: string } {
  return g.hasExclusions
    ? { cents: g.consideredAverageCents, label: "Preço médio (após revisão)" }
    : { cents: g.extractedAverageCents, label: "Preço médio" };
}

export interface WarningLike { code: string; severity: "info" | "warning"; message: string; count: number }

/** Separa advertências OPERACIONAIS (pedem ação) das INFORMAÇÕES TÉCNICAS da extração. */
export function splitWarnings<T extends { severity?: string }>(warnings: readonly T[] | null | undefined): { operational: T[]; technical: T[] } {
  const list = warnings ?? [];
  return { operational: list.filter((w) => w.severity !== "info"), technical: list.filter((w) => w.severity === "info") };
}

export function quoteSourceLabel(q: Pick<PriceResearchReviewQuote, "sourceLabel">): string {
  return q.sourceLabel ?? UNIDENTIFIED_SOURCE_LABEL;
}

/** Cotações pendentes do item (as únicas que a decisão por item afeta). */
export function pendingQuoteCount(g: Pick<PriceResearchReviewGroup, "statusCounts">): number {
  return g.statusCounts.pending;
}

/** O item aceita decisão em lote? (identidade consistente e ao menos uma cotação pendente). */
export function canDecideGroup(g: Pick<PriceResearchReviewGroup, "identity" | "statusCounts">): boolean {
  return g.identity.status === "consistent" && g.statusCounts.pending > 0;
}

/** Explicação da decisão por item antes de confirmar (o que exatamente será afetado). */
export function groupDecisionSummary(action: GroupReviewAction, groups: readonly Pick<PriceResearchReviewGroup, "statusCounts">[]): string {
  const quotes = groups.reduce((a, g) => a + g.statusCounts.pending, 0);
  const verb = action === "approved" ? "aceitas" : action === "rejected" ? "rejeitadas" : "puladas";
  return `${itemsLabel(groups.length)} · ${quotesLabel(quotes)} pendente(s) serão ${verb}. Decisões já registradas em cotações individuais são preservadas.`;
}

/** Alterna a expansão de um item (conjunto imutável). */
export function toggleExpanded(expanded: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(expanded);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
}

/** Localização legível da cotação no documento (sem estrutura interna). */
export function formatQuoteLineage(l: PriceResearchReviewQuote["lineage"]): string | null {
  const parts: string[] = [];
  if (l.sheet) parts.push(`planilha "${l.sheet}"`);
  if (l.page != null) parts.push(`pág. ${l.page}`);
  if (l.row != null) parts.push(`linha ${l.row}`);
  if (l.column != null) parts.push(`coluna ${l.column}`);
  return parts.length ? parts.join(", ") : null;
}
