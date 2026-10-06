/**
 * Modelos Institucionais — API tRPC (Lane C). Tenant-scoped: o tenant vem SEMPRE do contexto autenticado (nunca do
 * cliente; schemas `.strict()` recusam `organizationId` no input). Piso de papel por ação (`TEMPLATE_ACTION_MIN_ROLE`);
 * ações institucionais exigem ator humano + confirmação explícita; módulo atrás da flag tenant-scoped (default OFF).
 * Persistência e composição entram por ports (`getTemplateWorkflowPorts`): sem integração ⇒ falha fechada.
 */
import { z } from "zod";
import { getProcess } from "../db/procurement";
import { TemplatePersistenceError } from "../db/institutionalTemplates";
import { translatePersistenceError } from "../services/institutionalTemplates/adapters/errors";
import { TemplateReviewService } from "../services/institutionalTemplates/reviewService";
import { generateTemplatedDocument } from "../services/institutionalTemplates/templateCompositionService";
import { TRPCError } from "@trpc/server";
import { orgRoleProcedure, router, tenantProcedure } from "../_core/trpc";
import { TEMPLATE_DOCUMENT_KINDS, type TemplateDocumentKind } from "../domain/institutionalTemplates";
import { TEMPLATE_ACTION_MIN_ROLE, type TemplateAction } from "../services/institutionalTemplates/authority";
import { TemplateWorkflowError, type TemplateWorkflowErrorCode } from "../services/institutionalTemplates/errors";
import { IMPORT_LIMITS, runImportPipeline } from "../services/institutionalTemplates/importPipeline";
import {
  FF_INSTITUTIONAL_TEMPLATES_V1, getTemplateCompositionPorts, getTemplateWorkflowPorts, templateWorkflowPortsConfigured,
} from "../services/institutionalTemplates/portsRegistry";
import { describeResolution, InstitutionalTemplatesWorkflow } from "../services/institutionalTemplates/workflowService";
import type { WorkflowContext } from "../services/institutionalTemplates/ports";


const KINDS = TEMPLATE_DOCUMENT_KINDS as readonly [TemplateDocumentKind, ...TemplateDocumentKind[]];
const STATUSES = ["DRAFT", "APPROVED", "PUBLISHED", "DEPRECATED"] as const;

const id = z.string().min(1).max(24).regex(/^[A-Za-z0-9_-]+$/);
const iso = z.string().min(20).max(30);
const scope = z.object({
  modality: z.string().min(1).max(100).optional(),
  regime: z.string().min(1).max(100).optional(),
  criterion: z.string().min(1).max(100).optional(),
}).strict();

const MAX_AST_JSON_CHARS = 2 * 1024 * 1024;
const astInput = z.unknown().refine((v) => { try { return JSON.stringify(v).length <= MAX_AST_JSON_CHARS; } catch { return false; } }, "AST acima do limite");

const scalar = z.union([z.string().max(10_000), z.number(), z.boolean(), z.null()]);
const sampleValues = z.record(z.string().min(1).max(80), z.union([scalar, z.array(scalar).max(500)])).refine((r) => Object.keys(r).length <= 500, "valores demais");

const decisionSchema = z.object({
  decidedByName: z.string().min(1).max(255),
  decidedByRole: z.string().min(1).max(255),
  decidedByUserId: z.number().int().positive().nullable().optional(),
  decidedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  basisReference: z.string().min(1).max(500),
  reason: z.string().min(1).max(5000),
  evidence: z.array(z.string().min(1).max(500)).max(20).optional(),
}).strict();

const lifecycleInput = z.object({
  revisionId: id,
  expectedStatus: z.enum(STATUSES),
  /** Literal `true`: a confirmação humana é um ato explícito (um booleano ausente/false é recusado). */
  confirm: z.boolean(),
  idempotencyKey: z.string().min(8).max(128),
  decision: decisionSchema,
}).strict();

const importInput = z.object({
  format: z.enum(["markdown", "docx"]),
  markdown: z.string().max(IMPORT_LIMITS.maxMarkdownChars).optional(),
  docxBase64: z.string().max(Math.ceil((IMPORT_LIMITS.maxDocxBytes * 4) / 3) + 8).optional(),
  filename: z.string().max(255).optional(),
}).strict();

const acceptAiNarrativeInput = z.object({
  manifestId: id, slotKey: z.string().min(1).max(80), executionId: z.string().min(1).max(64), outputHash: z.string().length(64),
  confirm: z.boolean(), idempotencyKey: z.string().min(8).max(128), decision: decisionSchema,
}).strict();

const acknowledgeDeviationInput = z.object({
  manifestId: id, blockId: z.string().min(1).max(80), kind: z.enum(["INCLUDED_BLOCK_REMOVED", "EXCLUDED_BLOCK_INSERTED"]),
  confirm: z.boolean(), idempotencyKey: z.string().min(8).max(128), decision: decisionSchema,
}).strict();

const generateInput = z.object({
  processId: z.string().min(1).max(20), documentKind: z.enum(KINDS), documentType: z.enum(["dfd", "etp", "tr", "edital"]),
  scope, asOf: iso, title: z.string().min(1).max(500),
  /** Narrativas de IA entram SÓ por id de execução auditável (o texto nunca vem do cliente). */
  aiExecutionIds: z.array(z.string().min(1).max(20)).max(20).optional(),
}).strict();

function trpcCode(code: TemplateWorkflowErrorCode): TRPCError["code"] {
  switch (code) {
    case "HUMAN_ACTION_REQUIRED": return "FORBIDDEN";
    case "NOT_FOUND": return "NOT_FOUND";
    case "VALIDATION_FAILED": case "IMPORT_REJECTED": case "DECISION_REJECTED": case "BINDING_NOT_PINNED": return "BAD_REQUEST";
    case "CONFLICT": case "REVISION_IMMUTABLE": case "TRANSITION_INVALID": case "STALE_STATE": case "BINDING_AMBIGUOUS":
    case "BINDING_NOT_PUBLISHED": case "REVISION_PINNED_BY_BINDING": return "CONFLICT";
    case "MODULE_DISABLED": case "PORTS_NOT_CONFIGURED": case "CONFIRMATION_REQUIRED": return "PRECONDITION_FAILED";
    default: return "INTERNAL_SERVER_ERROR";
  }
}

function mapError(err: unknown): never {
  if (err instanceof TemplatePersistenceError) {
    try { translatePersistenceError(err); } catch (translated) { if (!(translated instanceof TemplatePersistenceError)) return mapError(translated); }
  }
  if (err instanceof TemplateWorkflowError) {
    const detail = err.issues.slice(0, 10).map((i) => `${i.code} ${i.path || "/"}: ${i.message}`).join("; ");
    throw new TRPCError({ code: trpcCode(err.code), message: detail ? `${err.message} [${detail}]` : err.message, cause: err });
  }
  throw err;
}

async function guarded<T>(fn: () => Promise<T> | T): Promise<T> {
  try { return await fn(); } catch (err) { return mapError(err); }
}

/** Procedure com piso de papel + módulo habilitado (flag) + ports configurados + ator humano do contexto autenticado. */
function templatesProcedure(action: TemplateAction) {
  return orgRoleProcedure(TEMPLATE_ACTION_MIN_ROLE[action]).use(async ({ ctx, next }) => {
    const wf = await guarded(async () => {
      const ports = getTemplateWorkflowPorts();
      if (!(await ports.flag.isEnabled(ctx.organizationId!))) {
        throw new TemplateWorkflowError("MODULE_DISABLED", `Modelos Institucionais não estão habilitados para esta organização (${FF_INSTITUTIONAL_TEMPLATES_V1} desligada)`);
      }
      return new InstitutionalTemplatesWorkflow(ports);
    });
    const wctx: WorkflowContext = {
      organizationId: ctx.organizationId!, actor: { kind: "human", userId: ctx.user.id }, correlationId: ctx.correlationId ?? "",
    };
    return next({ ctx: { ...ctx, wf, wctx } });
  });
}

export const institutionalTemplatesRouter = router({
  /** Não lança quando desabilitado: a UI usa `enabled` para esconder a superfície (o backend autoriza cada operação). */
  getCapabilities: tenantProcedure.query(async ({ ctx }) => {
    const configured = templateWorkflowPortsConfigured();
    let enabled = false;
    if (configured) enabled = await getTemplateWorkflowPorts().flag.isEnabled(ctx.organizationId!);
    return {
      enabled, portsConfigured: configured, flag: FF_INSTITUTIONAL_TEMPLATES_V1,
      lifecycle: STATUSES, documentKinds: TEMPLATE_DOCUMENT_KINDS, roleFloors: TEMPLATE_ACTION_MIN_ROLE,
      importLimits: IMPORT_LIMITS, role: ctx.orgMembership?.role ?? null,
    };
  }),

  identities: router({
    list: templatesProcedure("read").input(z.object({ documentKind: z.enum(KINDS).optional() }).strict())
      .query(({ ctx, input }) => guarded(() => ctx.wf.listIdentities(ctx.wctx, input))),
    get: templatesProcedure("read").input(z.object({ identityId: id }).strict())
      .query(({ ctx, input }) => guarded(() => ctx.wf.getIdentity(ctx.wctx, input.identityId))),
    create: templatesProcedure("draft").input(z.object({ documentKind: z.enum(KINDS), slug: z.string().min(1).max(120) }).strict())
      .mutation(({ ctx, input }) => guarded(() => ctx.wf.createIdentity(ctx.wctx, input))),
  }),

  revisions: router({
    list: templatesProcedure("read").input(z.object({ identityId: id }).strict())
      .query(({ ctx, input }) => guarded(() => ctx.wf.listRevisions(ctx.wctx, input.identityId))),
    get: templatesProcedure("read").input(z.object({ revisionId: id }).strict())
      .query(({ ctx, input }) => guarded(() => ctx.wf.getRevision(ctx.wctx, input.revisionId))),
    createDraft: templatesProcedure("draft")
      .input(z.object({ identityId: id, ast: astInput.optional(), fromRevisionId: id.optional() }).strict())
      .mutation(({ ctx, input }) => guarded(() => ctx.wf.createDraft(ctx.wctx, input))),
    updateDraft: templatesProcedure("draft")
      .input(z.object({ revisionId: id, ast: astInput, expectedSemanticHash: z.string().length(64) }).strict())
      .mutation(({ ctx, input }) => guarded(() => ctx.wf.updateDraft(ctx.wctx, input))),
    validateAst: templatesProcedure("read").input(z.object({ ast: astInput }).strict())
      .query(({ ctx, input }) => guarded(() => ctx.wf.validateAst(ctx.wctx, input.ast))),
    approve: templatesProcedure("approve").input(lifecycleInput).mutation(({ ctx, input }) => guarded(() => ctx.wf.approve(ctx.wctx, input))),
    publish: templatesProcedure("publish").input(lifecycleInput).mutation(({ ctx, input }) => guarded(() => ctx.wf.publish(ctx.wctx, input))),
    deprecate: templatesProcedure("deprecate").input(lifecycleInput).mutation(({ ctx, input }) => guarded(() => ctx.wf.deprecate(ctx.wctx, input))),
  }),

  bindings: router({
    list: templatesProcedure("read")
      .input(z.object({ documentKind: z.enum(KINDS).optional(), activeOnly: z.boolean().optional() }).strict())
      .query(({ ctx, input }) => guarded(() => ctx.wf.listBindings(ctx.wctx, input))),
    set: templatesProcedure("bind")
      .input(z.object({
        documentKind: z.enum(KINDS), scope, identityId: id, pinnedRevisionId: id, effectiveFrom: iso,
        confirm: z.boolean(), replacesBindingId: id.optional(),
      }).strict())
      .mutation(({ ctx, input }) => guarded(() => ctx.wf.setBinding(ctx.wctx, input))),
    deactivate: templatesProcedure("bind").input(z.object({ bindingId: id, confirm: z.boolean() }).strict())
      .mutation(({ ctx, input }) => guarded(() => ctx.wf.deactivateBinding(ctx.wctx, input))),
    resolve: templatesProcedure("read")
      .input(z.object({ documentKind: z.enum(KINDS), scope, asOf: iso.optional() }).strict())
      .query(({ ctx, input }) => guarded(async () => describeResolution(await ctx.wf.resolveBinding(ctx.wctx, input)))),
  }),

  preview: templatesProcedure("preview").input(z.object({ revisionId: id, sampleValues }).strict())
    .query(({ ctx, input }) => guarded(() => ctx.wf.preview(ctx.wctx, input))),
  previewBound: templatesProcedure("preview")
    .input(z.object({ documentKind: z.enum(KINDS), scope, asOf: iso.optional(), sampleValues }).strict())
    .query(({ ctx, input }) => guarded(() => ctx.wf.previewBound(ctx.wctx, input))),
  explainManifest: templatesProcedure("read").input(z.object({ manifestId: id }).strict())
    .query(({ ctx, input }) => guarded(() => ctx.wf.explainManifest(ctx.wctx, input.manifestId))),

  /**
   * Revisão HUMANA do documento composto (M1). A IA nunca aceita narrativa nem reconhece desvio: ator humano + confirmação
   * explícita; o aceite é EXATO (slot + execução + hash do texto registrados no M1).
   */
  reviews: router({
    acceptAiNarrative: templatesProcedure("review").input(acceptAiNarrativeInput)
      .mutation(({ ctx, input }) => guarded(() => new TemplateReviewService(getTemplateWorkflowPorts().manifests!).acceptAiNarrative(ctx.wctx, input))),
    acknowledgeDeviation: templatesProcedure("review").input(acknowledgeDeviationInput)
      .mutation(({ ctx, input }) => guarded(() => new TemplateReviewService(getTemplateWorkflowPorts().manifests!).acknowledgeDeviation(ctx.wctx, input))),
  }),

  /** Geração governada por modelo: binding exato → composição determinística → rascunho + versão `gerado` + M1 (1 transação). */
  compose: router({
    generate: templatesProcedure("generate").input(generateInput)
      .mutation(({ ctx, input }) => guarded(async () => {
        if (!(await getProcess(input.processId, ctx.wctx.organizationId))) throw new TemplateWorkflowError("NOT_FOUND", "processo não encontrado nesta organização");
        const ports = getTemplateCompositionPorts();
        const outputs = input.aiExecutionIds?.length ? await ports.review.loadAiOutputs(ctx.wctx.organizationId, input.aiExecutionIds) : [];
        if (outputs.length !== (input.aiExecutionIds?.length ?? 0)) {
          throw new TemplateWorkflowError("VALIDATION_FAILED", "execução de IA inexistente ou sem narrativa de modelo nesta organização");
        }
        const result = await generateTemplatedDocument({
          organizationId: ctx.wctx.organizationId, subjectId: input.processId, documentKind: input.documentKind, documentType: input.documentType,
          scope: input.scope, asOf: input.asOf, title: input.title, actorUserId: ctx.wctx.actor.userId, correlationId: ctx.wctx.correlationId,
          aiNarratives: outputs,
        }, ports);
        return {
          generationManifestId: result.generationManifest.id, generatedDocumentId: result.generatedDocumentId, replayed: result.replayed,
          composedOutputHash: result.composedOutputHash, officialDocument: result.officialDocument, reviewNotice: result.reviewNotice,
          aiNarratives: result.generationManifest.aiNarratives,
        };
      })),
  }),

  import: router({
    /** Valida (sem persistir) e devolve o AST candidato + resumo + avisos, ou os motivos da recusa. */
    validate: templatesProcedure("import").input(importInput)
      .mutation(({ input }) => guarded(() => runImport(input))),
    /** Cria SOMENTE uma revisão DRAFT a partir do AST candidato validado (nunca PUBLISHED). */
    createDraft: templatesProcedure("import").input(importInput.extend({ identityId: id }).strict())
      .mutation(({ ctx, input }) => guarded(async () => {
        const res = await runImport(input);
        if (!res.ok) throw new TemplateWorkflowError("IMPORT_REJECTED", "a importação foi recusada; nenhuma revisão foi criada", res.issues);
        const draft = await ctx.wf.createDraft(ctx.wctx, { identityId: input.identityId, ast: res.ast, sourceFormat: res.sourceFormat });
        return { revision: draft, summary: res.summary, warnings: res.warnings };
      })),
  }),
});

async function runImport(input: z.infer<typeof importInput>) {
  const catalog = getTemplateWorkflowPorts().catalog.current();
  if (input.format === "markdown") return runImportPipeline({ format: "markdown", markdown: input.markdown, filename: input.filename }, catalog);
  const docx = Buffer.from(input.docxBase64 ?? "", "base64");
  return runImportPipeline({ format: "docx", docx, filename: input.filename }, catalog);
}
