/**
 * R9 / SEM-048 — Governança da CORREÇÃO de extração frente à revisão/aprovação/promoção (puro, sem I/O).
 *
 * Princípio institucional: "operador revisa; gestor promove". Uma decisão humana (aceitar/rejeitar/pular o item,
 * aprovar a sessão) vale para o CONTEÚDO que foi visto. Corrigir o conteúdo depois disso não pode herdar a
 * decisão em silêncio:
 *   - sessão já PROMOVIDA ⇒ correção RECUSADA (SESSION_ALREADY_PROMOTED): o domínio (Pesquisa/Itens Inteligentes)
 *     já foi gerado a partir do conteúdo aprovado e não diverge em silêncio do staging;
 *   - sessão fora de revisão (rejeitada/arquivada/em processamento) ⇒ correção RECUSADA (SESSION_NOT_UNDER_REVIEW);
 *   - item já decidido (aceito/rejeitado/pulado) ⇒ a correção REABRE a revisão do item (volta a `pending`) — o
 *     item lógico (grupo) que o contém deixa de estar "revisado";
 *   - sessão já APROVADA ⇒ a aprovação é INVALIDADA (volta a `awaiting_review`): nova aprovação humana é exigida
 *     antes da promoção.
 */
import { createHash } from "crypto";

export type CorrectionRefusal = "SESSION_ALREADY_PROMOTED" | "SESSION_NOT_UNDER_REVIEW";

export const CORRECTION_REFUSAL_MESSAGE: Record<CorrectionRefusal, string> = {
  SESSION_ALREADY_PROMOTED:
    "SESSION_ALREADY_PROMOTED: Esta importação já foi promovida à Pesquisa de Preços; o conteúdo do staging não pode mais ser corrigido. Ajuste os dados no domínio (Itens Inteligentes) ou faça uma nova importação.",
  SESSION_NOT_UNDER_REVIEW:
    "SESSION_NOT_UNDER_REVIEW: A sessão não está em revisão (aguardando revisão ou aprovada); a correção não é permitida.",
};

/** Estados de sessão em que o conteúdo do staging ainda pode ser corrigido (com reabertura, se aprovado). */
const CORRECTABLE_SESSION_STATUSES = new Set(["awaiting_review", "approved"]);

export interface CorrectionReviewInput {
  sessionStatus:   string;
  promotionStatus: string | null | undefined;
  itemReviewStatus: string;
}

export type CorrectionReviewPlan =
  | { ok: false; refusal: CorrectionRefusal }
  | {
      ok: true;
      /** O item já tinha decisão humana: volta a `pending` (a decisão valia para o conteúdo anterior). */
      reopenItem: boolean;
      /** Status anterior do item (auditoria da reabertura). */
      previousItemStatus: string;
      /** A sessão estava aprovada: a aprovação é invalidada (volta a `awaiting_review`). */
      reopenSession: boolean;
    };

/** Decide o efeito de uma correção sobre a revisão/aprovação (fonte única; o serviço aplica sob lock). */
export function planCorrectionReview(input: CorrectionReviewInput): CorrectionReviewPlan {
  if ((input.promotionStatus ?? "none") === "promoted") return { ok: false, refusal: "SESSION_ALREADY_PROMOTED" };
  if (!CORRECTABLE_SESSION_STATUSES.has(input.sessionStatus)) return { ok: false, refusal: "SESSION_NOT_UNDER_REVIEW" };
  return {
    ok: true,
    reopenItem:         input.itemReviewStatus !== "pending",
    previousItemStatus: input.itemReviewStatus,
    reopenSession:      input.sessionStatus === "approved",
  };
}

/** Operação lógica da idempotência da correção (a chave fica vinculada a ela). */
export const CORRECTION_IDEMPOTENCY_OPERATION = "ingestion.correctItem";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).sort()
      .map((k) => [k, canonical((value as Record<string, unknown>)[k])]);
  }
  return value ?? null;
}

/**
 * Hash CANÔNICO do pedido de correção (chaves ordenadas; tenant do contexto). Mesma chave + mesmo hash ⇒ replay
 * sem nova escrita; mesma chave + hash diferente ⇒ CONFLICT. Inclui a operação: a chave não é reaproveitável
 * entre operações distintas.
 */
export function correctionPayloadHash(p: {
  organizationId: number; importSessionId: number; itemId: number; expectedRevision: number;
  corrections: unknown; justification: string;
}): string {
  return createHash("sha256").update(JSON.stringify([
    `${CORRECTION_IDEMPOTENCY_OPERATION}/v1`, p.organizationId, p.importSessionId, p.itemId, p.expectedRevision,
    canonical(p.corrections), p.justification.trim(),
  ])).digest("hex");
}

/**
 * Compatibilidade com o histórico anterior ao R9 (idempotência só por chave em `import_item_corrections`): um
 * registro com a mesma chave só é replay se for do MESMO item e produziu o MESMO overlay e justificativa.
 */
export function isSameCorrection(
  prior: { stagingItemId: number; afterPayload: unknown; justification: string },
  next:  { itemId: number; overlay: Record<string, unknown>; justification: string },
): boolean {
  if (prior.stagingItemId !== next.itemId) return false;
  if (prior.justification.trim() !== next.justification.trim()) return false;
  const after = (prior.afterPayload && typeof prior.afterPayload === "object" ? prior.afterPayload : {}) as Record<string, unknown>;
  return Object.entries(next.overlay).every(([k, v]) => JSON.stringify(canonical(after[k])) === JSON.stringify(canonical(v)));
}
