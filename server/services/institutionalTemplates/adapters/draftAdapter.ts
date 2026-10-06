/**
 * Adapter REAL do `TemplateDraftPort` sobre o rascunho canônico (`generated_documents`) e sua mutação governada
 * (`applyDraftContentMutationTx`: lock, ledger append-only de edições, autoria preservada).
 *
 * Regras:
 *  - id determinístico por (organização, processo, tipo): repetir o comando não cria segundo rascunho;
 *  - NUNCA sobrescreve um rascunho existente com conteúdo diferente (a edição humana não é perdida): falha fechada;
 *    conteúdo idêntico ⇒ no-op (replay);
 *  - só documentos de processo licitatório (dfd/etp/tr/edital); outros tipos ⇒ falha fechada (sem backing).
 */
import { createHash } from "crypto";
import { and, eq } from "drizzle-orm";
import { generatedDocumentsTable } from "../../../../drizzle/schema";
import { getDb } from "../../../db/connection";
import { applyDraftContentMutationTx, type ProcurementExecutor } from "../../../db/procurement";
import { TemplatePersistenceError } from "../../../db/institutionalTemplates";
import { draftContentHash, type DocumentKind, type GeneratedDocument } from "../../../domain/generatedDocument";
import type { TemplateDraftPort } from "../ports";

const KINDS: readonly string[] = ["dfd", "etp", "tr", "edital"];

function assertKind(documentType: string): DocumentKind {
  if (!KINDS.includes(documentType)) {
    throw new TemplatePersistenceError("INVALID_INPUT", `composição por modelo não tem rascunho canônico para o tipo ${documentType} (sem backing — falha fechada)`);
  }
  return documentType as DocumentKind;
}

export const templateDraftId = (organizationId: number, processId: string, kind: string): string =>
  `gd${createHash("sha256").update(`tpl-draft:${organizationId}:${processId}:${kind}`).digest("hex").slice(0, 18)}`;

export function createTemplateDraftAdapter(): TemplateDraftPort {
  return {
    async reserveDraftId(organizationId, subjectId, documentType) {
      const kind = assertKind(documentType);
      const db = await getDb();
      if (!db) throw new TemplatePersistenceError("DB_UNAVAILABLE", "banco indisponível");
      const rows = await db.select({ id: generatedDocumentsTable.id }).from(generatedDocumentsTable).where(and(
        eq(generatedDocumentsTable.organizationId, organizationId), eq(generatedDocumentsTable.processId, subjectId), eq(generatedDocumentsTable.kind, kind))).limit(1);
      return rows.length === 1 ? rows[0].id : templateDraftId(organizationId, subjectId, kind);
    },

    async writeDraft(draft, executor) {
      const kind = assertKind(draft.documentType);
      const tx = executor as unknown as ProcurementExecutor;
      const rows = await tx.select().from(generatedDocumentsTable).where(and(
        eq(generatedDocumentsTable.organizationId, draft.organizationId), eq(generatedDocumentsTable.processId, draft.subjectId), eq(generatedDocumentsTable.kind, kind)))
        .limit(1).for("update");
      if (rows.length === 1) {
        const existing = rows[0];
        if (existing.id === draft.id && draftContentHash(existing.content ?? "") === draftContentHash(draft.content)) return; // replay
        throw new TemplatePersistenceError("CONFLICT", "já existe rascunho para este processo e tipo com outro conteúdo; descarte-o (reset governado) antes de compor por modelo — nada foi sobrescrito");
      }
      const now = new Date().toISOString();
      const doc: GeneratedDocument = {
        id: draft.id, processId: draft.subjectId, organizationId: draft.organizationId, kind, title: draft.title, content: draft.content,
        status: "rascunho", sources: ["origem:template", `tpl-m1:${draft.generationManifestId}`], modality: null, form: null, platform: null,
        legalJustification: "", judgmentCriterion: null, executionRegime: null, authorUserId: draft.actorUserId,
        lastSubstantiveActorUserId: draft.actorUserId, lastSubstantiveAt: now, correlationId: draft.correlationId, createdAt: now, updatedAt: now,
      };
      await applyDraftContentMutationTx(tx, {
        organizationId: draft.organizationId, processId: draft.subjectId, kind, actorUserId: draft.actorUserId, doc, operation: "template_compose",
        expectedState: { type: "absent" }, idempotencyKey: `tplc_${draft.generationManifestId}`.slice(0, 64), correlationId: draft.correlationId,
        reason: `Composição governada por modelo institucional (${draft.generationManifestId}).`, ledgerOnCreate: true,
      });
    },
  };
}
