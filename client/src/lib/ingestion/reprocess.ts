/**
 * Layout v2 — ação governada "Reprocessar extração" (pt-BR institucional), a partir da elegibilidade PERSISTIDA
 * informada pelo servidor (getSessionStatus.reprocess). Puro e testável. O servidor revalida tudo a cada pedido.
 *
 * Só é ofertada quando NENHUMA decisão humana existe (nenhum item aceito/rejeitado/pulado/corrigido e nenhuma
 * promoção). Reprocessar substitui apenas a extração ainda não revisada, na mesma sessão.
 */

export const REPROCESS_NOTICE =
  "Reprocessar substitui apenas a extração ainda não revisada. Nenhuma decisão humana será sobrescrita.";
export const REPROCESS_REASON_MIN = 10;

export interface ReprocessStatusLike {
  eligible?: boolean;
  inProgress?: boolean;
  blockers?: string[];
  message?: string;
}

export interface ReprocessView {
  /** Mostrar o botão (elegível e sem reprocessamento em andamento). */
  showAction: boolean;
  /** Reprocessamento em andamento (reserva ativa) — revisão deve aguardar. */
  inProgress: boolean;
  /** Explicação do bloqueio quando há intervenção humana (nunca vazio quando `blocked`). */
  blockedReason: string | null;
}

export function describeReprocess(r: ReprocessStatusLike | null | undefined): ReprocessView {
  if (!r) return { showAction: false, inProgress: false, blockedReason: null };
  if (r.inProgress) return { showAction: false, inProgress: true, blockedReason: null };
  if (r.eligible) return { showAction: true, inProgress: false, blockedReason: null };
  const humanDecision = (r.blockers ?? []).some((b) => b === "ITEMS_REVIEWED" || b === "ITEMS_CORRECTED" || b === "PROMOTED");
  return { showAction: false, inProgress: false, blockedReason: humanDecision ? (r.message ?? null) : null };
}

export function isValidReprocessReason(reason: string): boolean {
  return reason.trim().length >= REPROCESS_REASON_MIN;
}
