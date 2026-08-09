/**
 * PR C.2B — Serviço canônico de revisão/aprovação documental VERSION-AWARE.
 *
 * Reconcilia o fluxo operacional (documentos row-per-version) com o domínio canônico, SEM inventar
 * segundo state machine e SEM usar `applyTransition` (que bumpa `documents.version` e conflitaria com
 * o modelo row-per-version). Reutiliza:
 *   - regras de transição/estado: `isValidTransition` / `WORKFLOW_TRANSITIONS` / `WORKFLOW_ROLE_REQUIREMENTS`;
 *   - segregação de deveres: `assertInstitutionalDecisionRules` (reviewer≠autor, aprovador humano,
 *     justificativa obrigatória em rejeição/devolução);
 *   - RBAC: `orgRoleMeets` (hierarquia OrgRole existente — sem RBAC paralelo);
 *   - idempotência: serviço ÚNICO `runWithIdempotency` (sem segundo mecanismo);
 *   - ledger imutável version-aware: `document_review_decisions` (UNIQUE org+idempotencyKey).
 *
 * Aprova-se uma VERSÃO (linha `documents`), não o documento abstratamente. Editar conteúdo gera uma
 * nova linha (nova versão) em estado `draft` — nunca herda aprovação; a versão aprovada permanece
 * historicamente aprovada.
 */

import { createHash } from "crypto";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db/connection";
import { documents, documentReviewDecisionsTable, type OrgRole } from "../../drizzle/schema";
import { getDocumentByIdForOrganization, getProcessByIdForOrganization } from "../db/processes";
import { getDocumentReviewDecisions, type DocumentReviewAction } from "../db/documentReviewDecisions";
import { runWithIdempotency } from "./idempotencyService";
import { assertInstitutionalDecisionRules, orgRoleMeets } from "./documentWorkflowService";
import { isValidTransition, WORKFLOW_ROLE_REQUIREMENTS, type DocumentStatusValue } from "../domain/documentTypes";
import { logActivity } from "./activityLogService";
import { serviceLogger } from "./observabilityService";

const log = serviceLogger("DocumentReviewService");

const ACTION_TO_STATE: Record<DocumentReviewAction, DocumentStatusValue> = {
  submit_for_review: "in_review",
  approve: "approved",
  reject: "rejected",
  request_changes: "draft",
};

export interface DocumentReviewParams {
  action: DocumentReviewAction;
  documentId: number;
  organizationId: number;
  actorUserId: number;
  actorRole: OrgRole | null | undefined;
  actorName?: string | null;
  actorEmail?: string | null;
  orgName?: string | null;
  reason?: string | null;
  idempotencyKey: string;
  correlationId: string;
  requestId?: string;
  /** Versão que o revisor está de fato observando — recusa decisão sobre versão obsoleta. */
  expectedVersion?: number;
}

export interface DocumentReviewResult {
  replayed: boolean;
  status: DocumentStatusValue;
  fromState: DocumentStatusValue;
  documentId: number;
  documentVersion: number;
  decisionId: number | null;
}

function payloadHashOf(p: DocumentReviewParams, version: number): string {
  return createHash("sha256")
    .update(JSON.stringify({ d: p.documentId, v: version, to: ACTION_TO_STATE[p.action], r: (p.reason ?? "").trim() }))
    .digest("hex");
}

export async function decideDocumentReview(p: DocumentReviewParams): Promise<DocumentReviewResult> {
  const toState = ACTION_TO_STATE[p.action];

  // Escopo tenant + processo canônico (nunca consulta só por documentId).
  const document = await getDocumentByIdForOrganization(p.documentId, p.organizationId);
  if (!document) throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado." });
  const proc = await getProcessByIdForOrganization(document.processId, p.organizationId);
  if (!proc) throw new TRPCError({ code: "NOT_FOUND", message: "Processo não encontrado para este documento." });

  const fromState = document.documentStatus as DocumentStatusValue;
  const version = document.version;

  // Version-aware: a decisão é sobre a VERSÃO observada.
  if (p.expectedVersion != null && p.expectedVersion !== version) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Versão desatualizada: esperado v${p.expectedVersion}, atual v${version}. Recarregue e revise a versão vigente.`,
    });
  }

  if (!isValidTransition(fromState, toState)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Transição inválida: ${fromState} → ${toState}.` });
  }

  // RBAC canônico (sem paralelo): papel mínimo por estado-alvo.
  const minRole = (WORKFLOW_ROLE_REQUIREMENTS[toState] ?? "manager") as OrgRole;
  if (!orgRoleMeets(p.actorRole, minRole)) {
    throw new TRPCError({ code: "FORBIDDEN", message: `Papel insuficiente para esta ação — requer no mínimo "${minRole}".` });
  }

  // Segregação de deveres institucional.
  assertInstitutionalDecisionRules({
    toState,
    actorUserId: p.actorUserId,
    authorUserId: document.createdBy ?? null,
    reason: p.reason ?? null,
  });

  const { result, replayed } = await runWithIdempotency(
    {
      key: p.idempotencyKey,
      userId: p.actorUserId,
      organizationId: p.organizationId,
      operation: "document.review.decision",
      payloadHash: payloadHashOf(p, version),
    },
    async (): Promise<DocumentReviewResult> => {
      const db = await getDb();
      if (!db) {
        return { replayed: false, status: toState, fromState, documentId: p.documentId, documentVersion: version, decisionId: null };
      }
      // Transação única: estado + ledger, sem gravação parcial. FOR UPDATE serializa decisões
      // concorrentes sobre o mesmo documento e revalida estado/versão sob lock.
      return db.transaction(async (tx): Promise<DocumentReviewResult> => {
        const locked = await tx
          .select()
          .from(documents)
          .where(and(eq(documents.id, p.documentId), eq(documents.organizationId, p.organizationId)))
          .for("update");
        const cur = locked[0];
        if (!cur) throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado." });
        if (cur.version !== version) throw new TRPCError({ code: "CONFLICT", message: "Versão alterada durante a decisão." });
        if ((cur.documentStatus as DocumentStatusValue) !== fromState) {
          throw new TRPCError({ code: "CONFLICT", message: "Estado alterado durante a decisão." });
        }

        await tx
          .update(documents)
          .set({
            documentStatus: toState,
            updatedBy: p.actorUserId,
            ...(toState === "approved" ? { approvedBy: p.actorUserId } : {}),
          })
          .where(and(eq(documents.id, p.documentId), eq(documents.organizationId, p.organizationId)));

        const [ins] = await tx
          .insert(documentReviewDecisionsTable)
          .values({
            organizationId: p.organizationId,
            processId: document.processId,
            documentId: p.documentId,
            documentVersion: version,
            action: p.action,
            fromState,
            toState,
            actorUserId: p.actorUserId,
            authorUserId: document.createdBy ?? null,
            justification: (p.reason ?? "").trim() || null,
            correlationId: p.correlationId,
            idempotencyKey: p.idempotencyKey,
          })
          .$returningId();

        return { replayed: false, status: toState, fromState, documentId: p.documentId, documentVersion: version, decisionId: ins.id };
      });
    },
  );

  const finalResult: DocumentReviewResult =
    result ?? { replayed, status: toState, fromState, documentId: p.documentId, documentVersion: version, decisionId: null };

  // Narrativa/auditoria aplicada UMA vez (nunca em replay) → timeline/evento único.
  if (!replayed) {
    await logActivity({
      organizationId: p.organizationId,
      processId: document.processId,
      userId: p.actorUserId,
      actorName: p.actorName ?? undefined,
      actorEmail: p.actorEmail ?? undefined,
      actorRole: p.actorRole ?? undefined,
      orgName: p.orgName ?? undefined,
      sourceContext: "api",
      action: `document_${p.action}`,
      entityType: "document",
      entityId: p.documentId,
      correlationId: p.correlationId,
      requestId: p.requestId,
      details: { fromState, toState, version, reason: (p.reason ?? "").trim() || undefined },
    });
    log.info("document_review_decision", { documentId: p.documentId, fromState, toState, organizationId: p.organizationId });
  }

  return { ...finalResult, replayed };
}

/** Trilha imutável de decisões de um documento (tenant-scoped) — para reconstrução após reload. */
export async function listDocumentReviewDecisions(organizationId: number, documentId: number) {
  return getDocumentReviewDecisions(organizationId, documentId);
}
