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

/**
 * Chave da RESERVA no `extraction_summary` da sessão (JSON já existente — sem migration). A reserva tem DONO: só quem
 * a detém (mesmo `token`) aplica (commit) ou devolve (release). Uma reserva vencida retomada por outro pedido ganha
 * token novo; o worker anterior, se ainda vivo, não consegue mais aplicar nem desfazer o estágio (compare-and-set).
 * A troca do JSON também renova `updatedAt` (ON UPDATE CURRENT_TIMESTAMP): a retomada passa a valer por 15 min.
 */
export const REEXTRACTION_LEASE_KEY = "reextractionLease";

export interface ReextractionLease {
  /** Identificador aleatório do dono da reserva (não é segredo: só distingue reservas concorrentes). */
  readonly token: string;
  readonly reservedAt: string;
  /** Estágio que a sessão tinha ANTES da primeira reserva (devolvido ao liberar). */
  readonly previousStage: string | null;
}

/** Reserva registrada no sumário (null quando ausente ou malformada — nunca presume dono). */
export function reextractionLeaseOf(summary: unknown): ReextractionLease | null {
  const raw = (summary as Record<string, unknown> | null | undefined)?.[REEXTRACTION_LEASE_KEY];
  if (!raw || typeof raw !== "object") return null;
  const l = raw as Record<string, unknown>;
  if (typeof l.token !== "string" || l.token.length === 0 || typeof l.reservedAt !== "string") return null;
  const previousStage = typeof l.previousStage === "string" ? l.previousStage : null;
  return { token: l.token, reservedAt: l.reservedAt, previousStage };
}

/**
 * Estágio a devolver quando a reserva for liberada. Numa retomada (a sessão já está `reprocessing`), devolver
 * `reprocessing` deixaria a sessão presa: usa o estágio anterior registrado pela reserva original, ou `awaiting_review`.
 */
export function stageToRestore(currentStage: string | null, summary: unknown): string | null {
  if (currentStage !== REEXTRACTION_STAGE) return currentStage;
  return reextractionLeaseOf(summary)?.previousStage ?? "awaiting_review";
}

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

// ─── M8 (P1-C) — revalidação da ANÁLISE de proveniência (sessão legada) ─────────────────────────────────────────────

/**
 * Diferente da reextração: NÃO substitui o staging — só reanalisa o arquivo original (mesmo checksum) para gravar a
 * evidência da análise de declaração do documento. Por isso vale também com revisões/correções/aprovação já feitas.
 * Nunca para sessão promovida (o histórico concluído é imutável) nem durante uma reextração.
 */
export type ProvenanceRevalidationBlocker =
  | "NOT_PRICE_RESEARCH" | "NOT_REVIEWABLE" | "PROMOTED" | "REPROCESS_IN_PROGRESS" | "NO_CHECKSUM" | "ALREADY_CURRENT" | "COVERAGE_INCOMPLETE";

export const PROVENANCE_REVALIDATION_BLOCKER_MESSAGE: Record<ProvenanceRevalidationBlocker, string> = {
  NOT_PRICE_RESEARCH:    "A revalidação de proveniência só se aplica à Pesquisa de Preços.",
  NOT_REVIEWABLE:        "A sessão não está em revisão nem aprovada.",
  PROMOTED:              "A sessão já foi promovida; o histórico concluído não é reprocessado.",
  REPROCESS_IN_PROGRESS: "Há uma reextração em andamento; ela já registrará a análise vigente.",
  NO_CHECKSUM:           "A sessão não tem o checksum do arquivo original; reenvie o arquivo.",
  ALREADY_CURRENT:       "A análise de proveniência desta sessão já está na versão vigente.",
  COVERAGE_INCOMPLETE:   "O arquivo excede o limite de páginas analisadas; reanalisá-lo não conclui a análise — envie o arquivo dividido em partes menores.",
};

export interface ProvenanceRevalidationFacts {
  importType: string;
  status: string;
  promotionStatus: string | null;
  hasPromotionLedger: boolean;
  stage: string | null;
  updatedAt: Date | null;
  now: Date;
  checksum: string | null;
  /** A evidência gravada já é a vigente (assessProvenanceScan ok). */
  scanCurrent: boolean;
  /** A extração registrou lacuna do próprio arquivo (ex.: PAGE_LIMIT) — reanalisar o mesmo arquivo não a remove. */
  fileCoverageGap?: boolean;
}

export function assessProvenanceRevalidation(f: ProvenanceRevalidationFacts): { eligible: boolean; blockers: ProvenanceRevalidationBlocker[]; message: string } {
  const blockers: ProvenanceRevalidationBlocker[] = [];
  if (f.importType !== "price_research") blockers.push("NOT_PRICE_RESEARCH");
  if (f.status !== "awaiting_review" && f.status !== "approved") blockers.push("NOT_REVIEWABLE");
  if ((f.promotionStatus ?? "none") !== "none" || f.hasPromotionLedger) blockers.push("PROMOTED");
  if (isReextractionReservationActive(f.stage, f.updatedAt, f.now)) blockers.push("REPROCESS_IN_PROGRESS");
  if (!f.checksum) blockers.push("NO_CHECKSUM");
  if (f.scanCurrent) blockers.push("ALREADY_CURRENT");
  if (f.fileCoverageGap) blockers.push("COVERAGE_INCOMPLETE");
  return { eligible: blockers.length === 0, blockers, message: blockers.length === 0 ? "" : PROVENANCE_REVALIDATION_BLOCKER_MESSAGE[blockers[0]] };
}
