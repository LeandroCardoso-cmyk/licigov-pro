/**
 * PROMPT 09 / Frente D — consistência entre anexos de tarefa (banco) e objetos no S3, sem subsistema novo:
 *  - EXCLUSÃO DA TAREFA (ponto único, usado por `departmentTasks.delete` e `task.delete`): remove antes os objetos dos anexos
 *    conhecidos (falha ⇒ nada é excluído; repetir é seguro — `DeleteObject` é idempotente e, em bucket versionado, cria
 *    marcador de exclusão sem eliminar versões); exclui a tarefa numa transação com a linha travada (serializa com o upload);
 *    um anexo que tenha entrado entre a listagem e a transação é tratado em seguida.
 *  - Objeto que não pôde ser removido nem ficou referenciado ⇒ registro DURÁVEL no activity_log
 *    (`task.attachment_storage_orphan`, com a chave) — inventário consultável para reconciliação; nunca silencioso.
 * Só chaves da PRÓPRIA tarefa (`attachmentStorageKey`) são tocadas; nada de outro tenant.
 */
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { storageDelete } from "../storage";
import { attachmentStorageKey } from "../domain/taskAttachmentStorage";
import { logActivity } from "./activityLogService";
import { serviceLogger } from "./observabilityService";

const log = serviceLogger("taskAttachmentStorage");

/** Registra, de forma durável, um objeto do S3 que ficou sem registro (para reconciliação). Nunca lança. */
export async function recordOrphanAttachmentObject(p: { organizationId: number; userId: number; taskId: number; s3Key: string; reason: string }): Promise<void> {
  log.error("task_attachment_storage_orphan", { organizationId: p.organizationId, taskId: p.taskId, reason: p.reason });
  await logActivity({
    organizationId: p.organizationId, userId: p.userId, action: "task.attachment_storage_orphan", entityType: "task", entityId: p.taskId,
    details: { s3Key: p.s3Key, reason: p.reason },
  }).catch(() => {});
}

/** Remove o objeto recém-gravado que não chegou a ser referenciado (compensação do upload); falha ⇒ órfão registrado. */
export async function compensateUnreferencedObject(p: { organizationId: number; userId: number; taskId: number; s3Key: string; reason: string }): Promise<void> {
  try {
    await storageDelete(p.s3Key);
  } catch {
    await recordOrphanAttachmentObject(p);
  }
}

export async function deleteTaskWithAttachmentObjects(p: { taskId: number; organizationId: number; userId: number }): Promise<{ deleted: boolean }> {
  const known = await db.listTaskAttachmentsForOrganization(p.taskId, p.organizationId);
  const removedKeys = new Set<string>();
  for (const a of known) {
    const key = attachmentStorageKey(a.fileUrl, a.taskId);
    if (!key) continue;
    try {
      await storageDelete(key);
      removedKeys.add(key);
    } catch {
      log.error("task_delete_attachment_storage_failed", { organizationId: p.organizationId, taskId: p.taskId, attachmentId: a.id });
      await logActivity({
        organizationId: p.organizationId, userId: p.userId, action: "task.attachment_delete_failed", entityType: "task", entityId: p.taskId,
        details: { attachmentId: a.id, s3Key: key, phase: "task_delete" },
      }).catch(() => {});
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível remover os arquivos anexados. A tarefa foi mantida; tente novamente." });
    }
  }
  const res = await db.deleteTaskForOrganizationWithAttachments(p.taskId, p.organizationId);
  if (!res.deleted) return { deleted: false };
  for (const a of res.attachments) {
    const key = attachmentStorageKey(a.fileUrl, a.taskId);
    if (!key) {
      // Registro legado sem chave reconhecível: o objeto (se existir) não é tocado — fica inventariado.
      await recordOrphanAttachmentObject({ organizationId: p.organizationId, userId: p.userId, taskId: p.taskId, s3Key: a.fileUrl.slice(0, 500), reason: "storage_key_unresolved_on_task_delete" });
      continue;
    }
    if (removedKeys.has(key)) continue;
    // Anexo que entrou entre a listagem e a exclusão: o registro já saiu; remove o objeto (ou inventaria a falha).
    await compensateUnreferencedObject({ organizationId: p.organizationId, userId: p.userId, taskId: p.taskId, s3Key: key, reason: "attachment_added_during_task_delete" });
  }
  await logActivity({
    organizationId: p.organizationId, userId: p.userId, action: "task.deleted", entityType: "task", entityId: p.taskId,
    details: { attachmentsRemoved: res.attachments.length },
  }).catch(() => {});
  return { deleted: true };
}
