/**
 * PR B.2.4 — Lógica pura de elegibilidade de promoção ao domínio (cliente).
 *
 * Espelha o contrato do backend: só sessões APROVADAS, sem pendências, de tipo promovível e ainda
 * não promovidas podem ser promovidas. Só `price_research` tem destino de domínio real nesta versão.
 */

/** Tipos de importação com destino de domínio real (promovível). */
export const PROMOTABLE_IMPORT_TYPES = ["price_research"] as const;

export function isPromotableType(importType: string | undefined | null): boolean {
  return !!importType && (PROMOTABLE_IMPORT_TYPES as readonly string[]).includes(importType);
}

export interface PromotableSessionView {
  status?: string;
  importType?: string;
  promotionStatus?: string;
}

/** Elegibilidade de promoção: aprovada + tipo promovível + não promovida + sem pendências. */
export function canPromoteSession(session: PromotableSessionView | null | undefined, pending: number): boolean {
  if (!session) return false;
  return (
    session.status === "approved" &&
    isPromotableType(session.importType) &&
    (session.promotionStatus ?? "none") !== "promoted" &&
    pending === 0
  );
}

/** Mensagem acionável para conflito de promoção concorrente. */
export function promotionConflictMessage(error: string): string {
  return /CONFLICT/i.test(error)
    ? "Esta sessão já está sendo promovida ou já foi promovida. Recarregue para ver o estado atual."
    : error;
}

// ─── R9 / SEM-053 — prévia do impacto da promoção (números SEMPRE do servidor) ──────────

/** Item detalhado da prévia (contrato de `ingestion.previewPromotion`). */
export interface PromotionPreviewItemView {
  itemId: string;
  description: string;
  status: string;
  beforeQuoteCount: number;
  afterQuoteCount: number;
  beforeAverageCents: number;
  afterAverageCents: number;
}

/** Prévia calculada pelo servidor (mesmo código da promoção, sem escrita). */
export interface PromotionPreviewView {
  quotesToPromote: number;
  intelligentItems: {
    create: number; merge: number; unchanged: number; preserved: number;
    sourceChanged: number; sourceChangedApproved: number; reviewRequired: number; reconciled: number;
  };
  merges: PromotionPreviewItemView[];
  sourceChanges: PromotionPreviewItemView[];
  detailLimit: number;
}

export interface PromotionImpactLine {
  key: "quotes" | "create" | "merge" | "source_changed" | "review_required" | "unchanged";
  text: string;
  /** Efeito sobre itens EXISTENTES (destacado na confirmação). */
  affectsExisting: boolean;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * Linhas institucionais do impacto (sem cálculo no cliente: só formatação dos contadores do servidor). Linhas com
 * contagem zero são omitidas, exceto cotações e novos itens (sempre informados).
 */
export function promotionImpactLines(p: PromotionPreviewView): PromotionImpactLine[] {
  const ii = p.intelligentItems;
  const lines: PromotionImpactLine[] = [
    { key: "quotes", affectsExisting: false, text: `${plural(p.quotesToPromote, "cotação aprovada será gravada", "cotações aprovadas serão gravadas")} na Pesquisa de Preços deste processo.` },
    { key: "create", affectsExisting: false, text: `${plural(ii.create, "Item Inteligente novo será criado", "Itens Inteligentes novos serão criados")}.` },
  ];
  if (ii.merge > 0) {
    lines.push({ key: "merge", affectsExisting: true, text: `${plural(ii.merge, "Item Inteligente existente terá", "Itens Inteligentes existentes terão")} as cotações MESCLADAS e a média/quantidade de cotações RECALCULADAS.` });
  }
  if (ii.sourceChanged > 0) {
    const approved = ii.sourceChangedApproved > 0
      ? ` ${plural(ii.sourceChangedApproved, "deles está aprovado: a aprovação deixará", "deles estão aprovados: a aprovação deixará")} de corresponder às cotações vigentes até nova revisão (aplicar as cotações atualizadas devolve o item a análise).`
      : "";
    lines.push({ key: "source_changed", affectsExisting: true, text: `${plural(ii.sourceChanged, "Item Inteligente já decidido será marcado", "Itens Inteligentes já decididos serão marcados")} como "Fonte alterada" — números preservados, revisão humana necessária.${approved}` });
  }
  if (ii.reviewRequired > 0) {
    lines.push({ key: "review_required", affectsExisting: true, text: `${plural(ii.reviewRequired, "Item Inteligente existente será marcado", "Itens Inteligentes existentes serão marcados")} como "Identidade a revisar" (ambiguidade com a nova pesquisa; nada será fundido).` });
  }
  const untouched = ii.unchanged + ii.preserved;
  if (untouched > 0) {
    lines.push({ key: "unchanged", affectsExisting: false, text: `${plural(untouched, "Item Inteligente existente permanece", "Itens Inteligentes existentes permanecem")} sem alteração.` });
  }
  return lines;
}

/** A promoção altera algo JÁ EXISTENTE (mescla, fonte alterada ou identidade a revisar)? */
export function promotionAffectsExisting(p: PromotionPreviewView): boolean {
  const ii = p.intelligentItems;
  return ii.merge + ii.sourceChanged + ii.reviewRequired > 0;
}
