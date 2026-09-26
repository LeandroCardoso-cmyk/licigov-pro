/**
 * R1 / PR-01A (NEW-001, P1 operacional) — atribuição de responsável por etapa ATÔMICA e replay-safe.
 *
 * Antes: `assignStage` gravava a atribuição, a notificação e o activity log em três chamadas independentes (cada
 * uma com `getDb()` próprio, sem transação). Com o ENUM físico sem `stage_assigned`, a atribuição ficava gravada,
 * a notificação falhava e a requisição respondia erro — estado parcial; e, como `stage_assignments` não tem chave
 * única em (processId, docType), cada retry INSERIA outra linha.
 *
 * Agora (uma transação MySQL local, tudo-ou-nada):
 *   1. lock da linha-pai `processes` por (processId, organizationId) — mutex por processo + re-verificação do tenant;
 *   2. leitura das linhas atuais da etapa e decisão determinística (`decideStageAssignment`);
 *   3. `unchanged` ⇒ commit sem escrita (sucesso idempotente: sem nova notificação nem novo activity log);
 *   4. `insert`/`update` ⇒ atribuição + notificação `stage_assigned` + activity log de sucesso; COMMIT ALL ou
 *      ROLLBACK ALL.
 *
 * Os três writes são persistência LOCAL (auditado): `notifications` é só uma tabela lida pelo `notificationsRouter`
 * — nenhum dispatcher/e-mail/webhook a consome (o EmailDispatcher lê `email_outbox`). Nenhuma chamada remota entra
 * na transação. Os gates de tenant/permissão/alvo continuam no router (#260) e rodam ANTES; aqui o tenant do
 * processo é re-verificado sob lock. FAIL-CLOSED: sem banco, lança (nunca finge sucesso).
 */
import { TRPCError } from "@trpc/server";
import { getDb } from "../db/connection";
import {
  getStageAssignmentRowsTx, insertActivityLogForOrganizationTx, insertNotificationTx, insertStageAssignmentTx,
  lockProcessForOrganizationTx, updateStageAssignmentTx, type StageDocType,
} from "../db/collaboration";
import { decideStageAssignment, normalizeStageNote, type StageAssignmentDecision } from "../domain/stageAssignment";
import { serviceLogger } from "./observabilityService";

const log = serviceLogger("stageAssignmentService");

export interface AssignStageAtomicallyParams {
  organizationId: number;
  processId: number;
  docType: StageDocType;
  assignedUserId: number;
  assignedBy: number;
  note?: string | null;
  /** Conteúdo da notificação `stage_assigned` (montado pelo router; semântica preservada). */
  notification: { title: string; message: string };
  /** Activity log de sucesso (correlationId já normalizado ao tamanho da coluna pelo chamador). */
  activity: { action: string; details: string; correlationId: string | null };
}

export interface AssignStageAtomicallyResult {
  decision: StageAssignmentDecision;
  changed: boolean;
}

export async function assignStageAtomically(p: AssignStageAtomicallyParams): Promise<AssignStageAtomicallyResult> {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível — atribuição de etapa não persistida (fail-closed).");
  const note = normalizeStageNote(p.note);

  const decision = await db.transaction(async (tx): Promise<StageAssignmentDecision> => {
    if (!(await lockProcessForOrganizationTx(tx, p.processId, p.organizationId))) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Processo não encontrado." });
    }
    const current = await getStageAssignmentRowsTx(tx, p.processId, p.docType);
    const d = decideStageAssignment(current, { assignedUserId: p.assignedUserId, note });
    if (d === "unchanged") return d;

    if (d === "insert") {
      await insertStageAssignmentTx(tx, {
        processId: p.processId, docType: p.docType, assignedUserId: p.assignedUserId, assignedBy: p.assignedBy, note,
      });
    } else {
      await updateStageAssignmentTx(tx, p.processId, p.docType, { assignedUserId: p.assignedUserId, assignedBy: p.assignedBy, note });
    }
    await insertNotificationTx(tx, {
      userId: p.assignedUserId,
      title: p.notification.title,
      message: p.notification.message,
      type: "stage_assigned",
      processId: p.processId,
      isRead: false,
    });
    await insertActivityLogForOrganizationTx(tx, {
      processId: p.processId,
      userId: p.assignedBy,
      action: p.activity.action,
      details: p.activity.details,
      correlationId: p.activity.correlationId,
    }, p.organizationId);
    return d;
  });

  log.info("stage_assignment_applied", {
    organizationId: p.organizationId, processId: p.processId, docType: p.docType,
    decision, correlationId: p.activity.correlationId,
  });
  return { decision, changed: decision !== "unchanged" };
}
