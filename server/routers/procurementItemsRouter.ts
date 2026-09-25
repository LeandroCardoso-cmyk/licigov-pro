/**
 * Itens da Contratação — router. Leitura: qualquer membro do tenant (viewer = somente leitura). Escrita:
 * `operator`+ (mesmo papel dos demais writes do Processo Licitatório; promoção/emissão seguem com manager).
 * organizationId e ator SEMPRE do ctx; o processo é validado por (processId, organizationId) e todo id de
 * item/lote/fonte é revalidado no serviço contra o processo — o browser nunca é autoritativo.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure, orgRoleProcedure } from "../_core/trpc";
import { getProcess } from "../db/procurement";
import {
  getProcurementItemsWorkspace, prepareItemCandidates, confirmItemCandidates, createManualItem, setPlannedQuantities,
  updateProcurementItem, withdrawProcurementItem, createProcurementLot, updateProcurementLot, archiveProcurementLot,
  assignItemToLot, moveProcurementItem, moveProcurementLot,
} from "../services/procurementItemsService";

async function requireProcess(id: string, orgId: number) {
  const p = await getProcess(id, orgId);
  if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Processo não encontrado nesta organização." });
  return p;
}

const ID = z.string().regex(/^[0-9a-f]{24}$/);
const KEY = z.string().trim().min(1).max(120);
const REV = z.number().int().min(1);
const QTY = z.union([z.string().max(30), z.number(), z.null()]);
const SOURCE = z.enum(["price_research", "dfd"]);
const TEXT = z.string().trim().max(2000);

const decision = z.discriminatedUnion("action", [
  z.object({
    candidateKey: ID, action: z.literal("create"),
    description: TEXT.optional(), unit: z.string().trim().max(30).optional(),
    plannedQuantity: QTY.optional(), adoptSourceQuantity: z.boolean().optional(),
    lot: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("none") }), z.object({ kind: z.literal("existing"), lotId: ID }), z.object({ kind: z.literal("source") }),
    ]).optional(),
  }),
  z.object({ candidateKey: ID, action: z.literal("link"), canonicalItemId: ID.optional(), toCandidateKey: ID.optional() }),
  z.object({ candidateKey: ID, action: z.literal("skip") }),
]);

const actor = (ctx: { organizationId?: number | null; user?: { id: number } | null; correlationId: string }, processId: string) => ({
  organizationId: ctx.organizationId!, processId, actorUserId: ctx.user!.id, correlationId: ctx.correlationId,
});

export const procurementItemsRouter = router({
  workspace: tenantProcedure.input(z.object({ processId: z.string().min(1) })).query(async ({ input, ctx }) => {
    await requireProcess(input.processId, ctx.organizationId!);
    return getProcurementItemsWorkspace({ organizationId: ctx.organizationId!, processId: input.processId, correlationId: ctx.correlationId });
  }),

  candidates: tenantProcedure.input(z.object({ processId: z.string().min(1), source: SOURCE })).query(async ({ input, ctx }) => {
    await requireProcess(input.processId, ctx.organizationId!);
    return prepareItemCandidates({ organizationId: ctx.organizationId!, processId: input.processId, correlationId: ctx.correlationId, source: input.source });
  }),

  confirmCandidates: orgRoleProcedure("operator")
    .input(z.object({ processId: z.string().min(1), source: SOURCE, expectedSourceDigest: z.string().regex(/^[0-9a-f]{32}$/), decisions: z.array(decision).min(1).max(500), idempotencyKey: KEY }))
    .mutation(async ({ input, ctx }) => {
      await requireProcess(input.processId, ctx.organizationId!);
      const { result } = await confirmItemCandidates({ ...actor(ctx, input.processId), source: input.source, expectedSourceDigest: input.expectedSourceDigest, decisions: input.decisions, idempotencyKey: input.idempotencyKey });
      return result;
    }),

  createManual: orgRoleProcedure("operator")
    .input(z.object({
      processId: z.string().min(1), description: z.string().trim().min(1).max(2000), unit: z.string().trim().min(1).max(30),
      plannedQuantity: QTY.optional(), lotId: ID.nullable().optional(), reason: z.string().trim().max(500).nullable().optional(),
      contextDocumentKind: z.enum(["dfd", "etp", "tr", "edital"]).nullable().optional(), idempotencyKey: KEY,
    }))
    .mutation(async ({ input, ctx }) => {
      await requireProcess(input.processId, ctx.organizationId!);
      const { result } = await createManualItem({ ...actor(ctx, input.processId), ...input });
      return result;
    }),

  setQuantities: orgRoleProcedure("operator")
    .input(z.object({
      processId: z.string().min(1), reason: z.string().trim().max(500).nullable().optional(), idempotencyKey: KEY,
      changes: z.array(z.discriminatedUnion("mode", [
        z.object({ itemId: ID, expectedRevision: REV, mode: z.literal("informed"), quantity: QTY }),
        z.object({ itemId: ID, expectedRevision: REV, mode: z.literal("adopt_source"), sourceType: SOURCE, sourceId: z.string().min(1).max(64) }),
      ])).min(1).max(500),
    }))
    .mutation(async ({ input, ctx }) => {
      await requireProcess(input.processId, ctx.organizationId!);
      const { result } = await setPlannedQuantities({ ...actor(ctx, input.processId), changes: input.changes, reason: input.reason ?? null, idempotencyKey: input.idempotencyKey });
      return result;
    }),

  updateItem: orgRoleProcedure("operator")
    .input(z.object({ processId: z.string().min(1), itemId: ID, expectedRevision: REV, description: TEXT.optional(), unit: z.string().trim().max(30).optional(), reason: z.string().trim().max(500).nullable().optional(), idempotencyKey: KEY }))
    .mutation(async ({ input, ctx }) => {
      await requireProcess(input.processId, ctx.organizationId!);
      const { result } = await updateProcurementItem({ ...actor(ctx, input.processId), ...input });
      return result;
    }),

  withdrawItem: orgRoleProcedure("operator")
    .input(z.object({ processId: z.string().min(1), itemId: ID, expectedRevision: REV, reason: z.string().trim().min(1).max(500), idempotencyKey: KEY }))
    .mutation(async ({ input, ctx }) => {
      await requireProcess(input.processId, ctx.organizationId!);
      const { result } = await withdrawProcurementItem({ ...actor(ctx, input.processId), ...input });
      return result;
    }),

  moveItem: orgRoleProcedure("operator")
    .input(z.object({ processId: z.string().min(1), itemId: ID, expectedRevision: REV, direction: z.enum(["up", "down"]), idempotencyKey: KEY }))
    .mutation(async ({ input, ctx }) => {
      await requireProcess(input.processId, ctx.organizationId!);
      const { result } = await moveProcurementItem({ ...actor(ctx, input.processId), ...input });
      return result;
    }),

  assignLot: orgRoleProcedure("operator")
    .input(z.object({ processId: z.string().min(1), itemId: ID, expectedRevision: REV, lotId: ID.nullable(), idempotencyKey: KEY }))
    .mutation(async ({ input, ctx }) => {
      await requireProcess(input.processId, ctx.organizationId!);
      const { result } = await assignItemToLot({ ...actor(ctx, input.processId), ...input });
      return result;
    }),

  createLot: orgRoleProcedure("operator")
    .input(z.object({ processId: z.string().min(1), code: z.string().trim().min(1).max(40), name: z.string().trim().min(1).max(200), description: z.string().trim().max(2000).nullable().optional(), idempotencyKey: KEY }))
    .mutation(async ({ input, ctx }) => {
      await requireProcess(input.processId, ctx.organizationId!);
      const { result } = await createProcurementLot({ ...actor(ctx, input.processId), ...input });
      return result;
    }),

  updateLot: orgRoleProcedure("operator")
    .input(z.object({ processId: z.string().min(1), lotId: ID, expectedRevision: REV, code: z.string().trim().min(1).max(40).optional(), name: z.string().trim().min(1).max(200).optional(), description: z.string().trim().max(2000).nullable().optional(), idempotencyKey: KEY }))
    .mutation(async ({ input, ctx }) => {
      await requireProcess(input.processId, ctx.organizationId!);
      const { result } = await updateProcurementLot({ ...actor(ctx, input.processId), ...input });
      return result;
    }),

  archiveLot: orgRoleProcedure("operator")
    .input(z.object({ processId: z.string().min(1), lotId: ID, expectedRevision: REV, reason: z.string().trim().min(1).max(500), idempotencyKey: KEY }))
    .mutation(async ({ input, ctx }) => {
      await requireProcess(input.processId, ctx.organizationId!);
      const { result } = await archiveProcurementLot({ ...actor(ctx, input.processId), ...input });
      return result;
    }),

  moveLot: orgRoleProcedure("operator")
    .input(z.object({ processId: z.string().min(1), lotId: ID, expectedRevision: REV, direction: z.enum(["up", "down"]), idempotencyKey: KEY }))
    .mutation(async ({ input, ctx }) => {
      await requireProcess(input.processId, ctx.organizationId!);
      const { result } = await moveProcurementLot({ ...actor(ctx, input.processId), ...input });
      return result;
    }),
});
