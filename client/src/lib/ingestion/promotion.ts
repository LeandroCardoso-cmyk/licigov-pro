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
