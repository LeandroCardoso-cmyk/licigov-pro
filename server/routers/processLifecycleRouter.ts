/**
 * Pilot Reset B2/B3 — router do lifecycle GOVERNADO do Processo Licitatório.
 *
 * RBAC (política técnica conservadora, sem autoridade jurídica):
 *  - `preview` (READ-ONLY, digest): operator+;
 *  - `execute` (correção de número, descarte, reset por nova geração, cancelamento, arquivamento): manager+;
 *  - `history` (gerações + ledger): leitura tenant.
 * organizationId vem SEMPRE do contexto. IA não tem nenhum caminho até estas procedures.
 * Contrato: server/domain/processLifecycle.ts · docs/architecture/PILOT_RESET_GOVERNED_LIFECYCLE.md.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure, orgRoleProcedure } from "../_core/trpc";
import { requireInstitutionalAuthority } from "../services/institutionalAuthorityService";
import { LIFECYCLE_ACTIONS } from "../domain/processLifecycle";
import { executeLifecycle, previewLifecycle } from "../services/processLifecycleService";
import { listGenerations, listLifecycleEvents } from "../db/processLifecycle";

const actionSchema = z.enum(LIFECYCLE_ACTIONS);
/** SECURITY-02 — ações com efeito administrativo sobre o processo (não sobre rascunho). */
const INSTITUTIONAL_LIFECYCLE_ACTIONS: ReadonlySet<string> = new Set(["CANCEL", "ARCHIVE", "CORRECT_NUMBER"]);

export const processLifecycleRouter = router({
  preview: orgRoleProcedure("operator")
    .input(z.object({ processId: z.string().min(1).max(20), action: actionSchema }))
    .query(({ input, ctx }) => previewLifecycle(ctx.organizationId!, input.processId, input.action)),

  execute: orgRoleProcedure("manager")
    .input(z.object({
      processId: z.string().min(1).max(20),
      action: actionSchema,
      expectedRevision: z.number().int().min(0),
      expectedEligibilityDigest: z.string().length(64),
      idempotencyKey: z.string().min(8).max(128),
      reason: z.string().max(4000),
      newProcessNumber: z.string().max(64).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // SECURITY-02 — cancelar, arquivar e corrigir o número do processo são atos administrativos do órgão: exigem membership
      // REAL (a projeção do admin de plataforma não basta). Descartar/resetar RASCUNHO continua técnico (piso de papel).
      if (INSTITUTIONAL_LIFECYCLE_ACTIONS.has(input.action)) {
        await requireInstitutionalAuthority({
          userId: ctx.user.id, organizationId: ctx.organizationId!, minRole: "manager",
          operation: `processLifecycle.execute#${input.action}`, correlationId: ctx.correlationId,
        });
      }
      return executeLifecycle({
      organizationId: ctx.organizationId!, processId: input.processId, action: input.action,
      expectedRevision: input.expectedRevision, expectedEligibilityDigest: input.expectedEligibilityDigest,
      idempotencyKey: input.idempotencyKey, reason: input.reason, newProcessNumber: input.newProcessNumber,
      actorUserId: ctx.user.id,
    }, ctx.correlationId);
    }),

  history: tenantProcedure
    .input(z.object({ processId: z.string().min(1).max(20) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const generations = await listGenerations(orgId, input.processId);
      if (generations.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Processo não encontrado nesta organização." });
      const lineageId = generations[0].lineageId;
      const events = lineageId ? await listLifecycleEvents(orgId, lineageId) : [];
      return {
        lineageId,
        generations,
        events: events.map((e) => ({
          id: e.id, processId: e.processId, action: e.action, eventType: e.eventType, fromState: e.fromState, toState: e.toState,
          before: e.beforeJson ? JSON.parse(e.beforeJson) : null, after: e.afterJson ? JSON.parse(e.afterJson) : null,
          reason: e.reason, actorUserId: e.actorUserId, revisionBefore: e.revisionBefore, revisionAfter: e.revisionAfter,
          correlationId: e.correlationId,
        })),
      };
    }),
});
