/**
 * R6 / PR-13 (SEM-008, INV-09) — helper de teste: cria os "Itens da contratação" a partir da Pesquisa de Preços com a
 * quantidade PREVISTA informada pela pessoa (decisão humana explícita), via o MESMO serviço do router
 * (`prepareItemCandidates` + `confirmItemCandidates`). Sem isso TR/Edital são fail-closed (CANONICAL_ITEMS_REQUIRED):
 * a quantidade da cotação nunca vira necessidade por omissão.
 *
 * `planned` mapeia descrição → quantidade prevista; ausente ⇒ a pessoa ADOTA explicitamente a quantidade da fonte
 * ("Usar N" — `adoptSourceQuantity: true`), o que é uma decisão registrada, não um fallback.
 */
import { getDb } from "../../db/connection";
import { procurementProcessesTable } from "../../../drizzle/schema";
import { confirmItemCandidates, createManualItem, prepareItemCandidates } from "../../services/procurementItemsService";

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

/**
 * HD-01 (opção A) — cria UM item canônico MANUAL com quantidade prevista INFORMADA (decisão humana explícita) para
 * processos de teste que não têm Pesquisa de Preços: TR/Edital NOVOS exigem Itens da contratação (CANONICAL_ITEMS_REQUIRED),
 * haja ou não cotação. Idempotente por processo (mesma chave ⇒ replay).
 */
export async function createCanonicalManualItem(params: {
  organizationId: number;
  processId: string;
  actorUserId: number;
  description?: string;
  unit?: string;
  plannedQuantity?: string | number;
  /** Smokes que geram TR/Edital para um `processId` sem linha em `procurement_processes`: cria a linha mínima (idempotente). */
  ensureProcess?: boolean;
}): Promise<void> {
  if (params.ensureProcess) {
    const db = await getDb();
    if (!db) throw new Error("DB indisponível para criar o processo de teste");
    await db.insert(procurementProcessesTable).values({
      id: params.processId, organizationId: params.organizationId, processNumber: params.processId, object: "Objeto de teste",
    }).onDuplicateKeyUpdate({ set: { processNumber: params.processId } });
  }
  await createManualItem({
    organizationId: params.organizationId, processId: params.processId, actorUserId: params.actorUserId,
    correlationId: `canon-manual-${params.processId}`, description: params.description ?? "Item de teste", unit: params.unit ?? "un",
    plannedQuantity: params.plannedQuantity ?? "1", idempotencyKey: `canon-manual-${params.processId}`,
  });
}
