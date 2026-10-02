/**
 * R6 / PR-13 (SEM-008, INV-09) — helper de teste: cria os "Itens da contratação" a partir da Pesquisa de Preços com a
 * quantidade PREVISTA informada pela pessoa (decisão humana explícita), via o MESMO serviço do router
 * (`prepareItemCandidates` + `confirmItemCandidates`). Sem isso TR/Edital são fail-closed (CANONICAL_ITEMS_REQUIRED):
 * a quantidade da cotação nunca vira necessidade por omissão.
 *
 * `planned` mapeia descrição → quantidade prevista; ausente ⇒ a pessoa ADOTA explicitamente a quantidade da fonte
 * ("Usar N" — `adoptSourceQuantity: true`), o que é uma decisão registrada, não um fallback.
 */
import { confirmItemCandidates, prepareItemCandidates } from "../../services/procurementItemsService";

export async function confirmCanonicalItemsFromResearch(params: {
  organizationId: number;
  processId: string;
  actorUserId: number;
  idempotencyKey: string;
  planned?: Readonly<Record<string, string | number>>;
}): Promise<void> {
  const correlationId = `canon-${params.idempotencyKey}`;
  const p = await prepareItemCandidates({ organizationId: params.organizationId, processId: params.processId, correlationId, source: "price_research" });
  await confirmItemCandidates({
    organizationId: params.organizationId, processId: params.processId, actorUserId: params.actorUserId, correlationId,
    source: "price_research", expectedSourceDigest: p.sourceDigest, idempotencyKey: params.idempotencyKey,
    decisions: p.candidates.map((c) => {
      const q = params.planned?.[c.description];
      return q !== undefined
        ? { candidateKey: c.candidateKey, action: "create" as const, plannedQuantity: q }
        : { candidateKey: c.candidateKey, action: "create" as const, adoptSourceQuantity: true };
    }),
  });
}
