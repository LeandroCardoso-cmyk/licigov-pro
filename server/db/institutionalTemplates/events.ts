/**
 * Institutional Templates — ledger APPEND-ONLY do ciclo de vida (revisão e binding).
 * Id determinístico por (tenant, tipo, assunto, estado destino): reexecutar a transação (retry de deadlock/replay)
 * converge no MESMO evento. Nunca há UPDATE/DELETE nesta tabela.
 */
import { institutionalTemplateEventsTable } from "../../../drizzle/schema";
import { deterministicTemplateId } from "./ids";
import { isDuplicateKey, type TemplatesContext, type TemplatesTx } from "./executor";

export type TemplateEventType =
  | "REVISION_CREATED" | "REVISION_APPROVED" | "REVISION_PUBLISHED" | "REVISION_DEPRECATED"
  | "BINDING_CREATED" | "BINDING_DEACTIVATED";

export interface TemplateEventInput {
  readonly identityId: string;
  readonly revisionId?: string;
  readonly bindingId?: string;
  readonly eventType: TemplateEventType;
  readonly fromStatus?: string;
  readonly toStatus?: string;
  readonly decisionId?: string | null;
}

export async function recordTemplateEvent(tx: TemplatesTx, ctx: TemplatesContext, e: TemplateEventInput): Promise<string> {
  const subject = e.revisionId ?? e.bindingId ?? e.identityId;
  const id = deterministicTemplateId("tpe", ctx.organizationId, e.eventType, subject, e.toStatus ?? "");
  try {
    await tx.insert(institutionalTemplateEventsTable).values({
      id, organizationId: ctx.organizationId, identityId: e.identityId,
      revisionId: e.revisionId ?? null, bindingId: e.bindingId ?? null, eventType: e.eventType,
      fromStatus: e.fromStatus ?? "", toStatus: e.toStatus ?? "", decisionId: e.decisionId ?? null,
      actorUserId: ctx.actorUserId, correlationId: ctx.correlationId.slice(0, 64),
    });
  } catch (err) {
    if (!isDuplicateKey(err)) throw err; // replay do mesmo evento: já registrado
  }
  return id;
}
