/**
 * Reprocessamento SEGURO da extração de uma sessão (Layout v2) — regra de domínio PURA.
 *
 * Uma sessão pode ser reextraída SOMENTE se nenhuma decisão humana existe sobre o staging atual:
 *   - status `awaiting_review` (nunca aprovada/rejeitada/arquivada) e importação de LINHAS (não documental);
 *   - nenhuma promoção (projeção `promotionStatus` e ledger `import_promotions`);
 *   - todos os itens `pending` (nenhum aceito, rejeitado ou pulado);
 *   - nenhum item corrigido (`correctionRevision` > 0) e nenhum histórico de correção na sessão;
 *   - nenhuma reextração em andamento (reserva `stage = reprocessing` dentro do prazo de validade).
 * Qualquer intervenção humana ⇒ REPROCESS = FORBIDDEN. O reprocessamento substitui apenas a extração ainda não
 * revisada, na MESMA sessão (mesmo original, checksum e linhagem) — nunca cria sessão, pesquisa ou promoção.
 */

/** Estágio de RESERVA da reextração (a sessão continua `awaiting_review`; o staging antigo segue intacto). */
export const REEXTRACTION_STAGE = "reprocessing";
/** Validade da reserva: uma reserva mais antiga (processo reiniciado no meio) pode ser retomada. */
export const REEXTRACTION_LEASE_MS = 15 * 60_000;

export type ReprocessBlocker =
  | "NOT_AWAITING_REVIEW"
  | "DOCUMENT_IMPORT"
  | "PROMOTED"
  | "ITEMS_REVIEWED"
  | "ITEMS_CORRECTED"
  | "REPROCESS_IN_PROGRESS";

export const REPROCESS_BLOCKER_MESSAGE: Record<ReprocessBlocker, string> = {
  NOT_AWAITING_REVIEW:   "A sessão não está aguardando revisão.",
  DOCUMENT_IMPORT:       "Importação de documento (DFD/ETP/TR) não usa reextração de itens.",
  PROMOTED:              "A sessão já foi promovida ao domínio.",
  ITEMS_REVIEWED:        "Há itens já aceitos, rejeitados ou pulados — decisões humanas não são sobrescritas.",
  ITEMS_CORRECTED:       "Há itens corrigidos por revisor — correções humanas não são sobrescritas.",
  REPROCESS_IN_PROGRESS: "Já existe um reprocessamento em andamento para esta sessão.",
};

/** Texto institucional exibido antes da confirmação. */
export const REPROCESS_EXPLANATION =
  "Reprocessar substitui apenas a extração ainda não revisada. Nenhuma decisão humana será sobrescrita.";

export interface ReprocessFacts {
  status:            string;
  isDocumentImport:  boolean;
  promotionStatus:   string | null;
  hasPromotionLedger: boolean;
  stage:             string | null;
  /** Última atualização da sessão (idade da reserva). */
  updatedAt:         Date | null;
  now:               Date;
  staging: { total: number; pending: number; approved: number; rejected: number; skipped: number; corrected: number };
  /** Linhas de histórico de correção humana da sessão. */
  correctionHistory: number;
}

export interface ReprocessEligibility {
  eligible: boolean;
  blockers: ReprocessBlocker[];
  /** Mensagem acionável (primeiro bloqueio) — ou a explicação institucional quando elegível. */
  message:  string;
}

export function isReextractionReservationActive(stage: string | null, updatedAt: Date | null, now: Date): boolean {
  if (stage !== REEXTRACTION_STAGE) return false;
  if (!updatedAt) return true;
  return now.getTime() - updatedAt.getTime() < REEXTRACTION_LEASE_MS;
}

export function assessReprocessEligibility(f: ReprocessFacts): ReprocessEligibility {
  const blockers: ReprocessBlocker[] = [];
  if (f.status !== "awaiting_review") blockers.push("NOT_AWAITING_REVIEW");
  if (f.isDocumentImport) blockers.push("DOCUMENT_IMPORT");
  if ((f.promotionStatus ?? "none") !== "none" || f.hasPromotionLedger) blockers.push("PROMOTED");
  if (f.staging.approved + f.staging.rejected + f.staging.skipped > 0 || f.staging.pending !== f.staging.total) blockers.push("ITEMS_REVIEWED");
  if (f.staging.corrected > 0 || f.correctionHistory > 0) blockers.push("ITEMS_CORRECTED");
  if (isReextractionReservationActive(f.stage, f.updatedAt, f.now)) blockers.push("REPROCESS_IN_PROGRESS");
  return {
    eligible: blockers.length === 0,
    blockers,
    message: blockers.length === 0 ? REPROCESS_EXPLANATION : REPROCESS_BLOCKER_MESSAGE[blockers[0]],
  };
}

/** Registro append-only de uma reextração (em `extractionSummary.reextractions`) — sem conteúdo do documento. */
export interface ReextractionRecord {
  at:                  string;
  actorUserId:         number;
  reason:              string;
  correlationId:       string | null;
  sourceChecksum:      string | null;
  previous: { parserVersion: string | null; layoutVersion: string | null; fingerprint: string | null; stagedCount: number };
  next:     { parserVersion: string; layoutVersion: string | null; fingerprint: string | null; stagedCount: number };
}
