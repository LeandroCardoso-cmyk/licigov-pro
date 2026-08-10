/**
 * PR C.2B — Router canônico de revisão/aprovação documental VERSION-AWARE.
 *
 * Caminho canônico (NÃO expande o `documentsRouter` congelado): a UI passa a consumir
 * `trpc.documentReview.*`. Delega ao `documentReviewService` (regras de domínio + SoD +
 * idempotência única + ledger imutável). Multi-tenant via `tenantProcedure`; o serviço
 * valida papel (RBAC canônico), transição, versão observada e segregação de deveres.
 */
import { z } from "zod";
import { router, tenantProcedure } from "../_core/trpc";
import { decideDocumentReview, listDocumentReviewDecisions } from "../services/documentReviewService";
import type { DocumentReviewAction } from "../db/documentReviewDecisions";

const idempotencyKey = z.string().min(8).max(64);
const expectedVersion = z.number().int().positive().optional();

function actorMeta(ctx: {
  organizationId: number | null;
  user: { id: number; name?: string | null; email?: string | null };
  orgMembership: { role?: string | null } | null;
  correlationId: string;
  requestId: string;
}) {
  return {
    organizationId: ctx.organizationId as number,
    actorUserId: ctx.user.id,
    actorRole: (ctx.orgMembership?.role ?? null) as never,
    actorName: ctx.user.name ?? null,
    actorEmail: ctx.user.email ?? null,
    correlationId: ctx.correlationId,
    requestId: ctx.requestId,
  };
}

export const documentReviewRouter = router({
  /** Enviar para revisão: draft → in_review. */
  submitForReview: tenantProcedure
    .input(z.object({ documentId: z.number().int().positive(), idempotencyKey, expectedVersion }))
    .mutation(async ({ ctx, input }) => {
      return decideDocumentReview({
        ...actorMeta(ctx),
        action: "submit_for_review" satisfies DocumentReviewAction,
        documentId: input.documentId,
        idempotencyKey: input.idempotencyKey,
        expectedVersion: input.expectedVersion,
      });
    }),

  /** Aprovar uma VERSÃO: in_review → approved (reviewer ≠ autor; aprovador humano). */
  approve: tenantProcedure
    .input(z.object({ documentId: z.number().int().positive(), idempotencyKey, expectedVersion }))
    .mutation(async ({ ctx, input }) => {
      return decideDocumentReview({
        ...actorMeta(ctx),
        action: "approve" satisfies DocumentReviewAction,
        documentId: input.documentId,
        idempotencyKey: input.idempotencyKey,
        expectedVersion: input.expectedVersion,
      });
    }),

  /** Rejeitar: in_review → rejected (justificativa OBRIGATÓRIA). */
  reject: tenantProcedure
    .input(z.object({
      documentId: z.number().int().positive(),
      reason: z.string().trim().min(1, "Justificativa obrigatória."),
      idempotencyKey,
      expectedVersion,
    }))
    .mutation(async ({ ctx, input }) => {
      return decideDocumentReview({
        ...actorMeta(ctx),
        action: "reject" satisfies DocumentReviewAction,
        documentId: input.documentId,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        expectedVersion: input.expectedVersion,
      });
    }),

  /** Solicitar ajustes (devolução): in_review → draft (justificativa OBRIGATÓRIA). */
  requestChanges: tenantProcedure
    .input(z.object({
      documentId: z.number().int().positive(),
      reason: z.string().trim().min(1, "Justificativa obrigatória."),
      idempotencyKey,
      expectedVersion,
    }))
    .mutation(async ({ ctx, input }) => {
      return decideDocumentReview({
        ...actorMeta(ctx),
        action: "request_changes" satisfies DocumentReviewAction,
        documentId: input.documentId,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        expectedVersion: input.expectedVersion,
      });
    }),

  /** Trilha imutável de decisões (reconstrução após reload) — tenant-scoped. */
  getReviewDecisions: tenantProcedure
    .input(z.object({ documentId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      return listDocumentReviewDecisions(ctx.organizationId as number, input.documentId);
    }),
});
