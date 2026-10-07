/**
 * HARNESS do piloto Edital — roteiro EXECUTÁVEL da integração final (biblioteca; a CLI está em `scripts/edital-pilot-harness.ts`).
 *
 *   1 REGISTER → 2 LEGAL_EVIDENCE → 3 READINESS → 4 APPROVE → 5 PUBLISH → 6 BIND → 7 PREVIEW
 *   → 8 COMPOSE → 9 INSPECT_M1 → 10 HUMAN_REVIEW → 11 REVALIDATE → 12 ISSUE_TEST_ARTIFACT
 *
 * Regras (invioláveis):
 *  - NUNCA liga a feature flag, nunca toca produção, nunca toca o processo 2026/253 (a CLI recusa); se a flag da organização
 *    estiver OFF, todos os passos ficam `SKIPPED_PRECONDITION` (o backend também bloqueia).
 *  - PUBLISH não tem "aceite de bloqueio": o backend recalcula a prontidão e qualquer BLOCKED ⇒ PUBLICATION_BLOCKED (passo FAILED).
 *  - Todo passo que muda estado institucional (REGISTER, LEGAL_EVIDENCE, APPROVE, PUBLISH, BIND) só roda se estiver em
 *    `confirmedSteps` — a confirmação é de uma PESSOA, com a autoridade que ela declarou; o harness não decide nada.
 *  - Passos 8–9 só existem com um `PilotStagingPort` (composição/manifest reais em staging); 10–12 são SEMPRE humanos
 *    (aceite de IA, revalidação canônica e emissão pela promoção oficial) — o harness só verifica pré-condições e imprime a rota.
 *  - Para na primeira falha ou pendência humana; passos seguintes ficam `SKIPPED_PRECONDITION`.
 */
import type { TemplateDocumentKind } from "../../../domain/institutionalTemplates";
import type { ReadinessMatrix } from "../../../domain/institutionalTemplates/governance/readinessMatrix";
import type { LegalEvidenceInput } from "../../../domain/institutionalTemplates/governance/legalEvidence";
import type { ScopeView } from "../../../domain/institutionalTemplates/governance/scopeDimensions";
import { TemplateWorkflowError } from "../errors";
import { TemplateGovernanceService, type DeclaredAuthority } from "../governanceService";
import { ModelRegistrationService, type RegisterModelInput } from "../modelRegistrationService";
import type { TemplateWorkflowPorts, WorkflowContext } from "../ports";
import { TemplatePreviewDossierService, type PreviewContext, type PreviewDossier } from "../previewDossierService";
import { TemplateReadinessService } from "../readinessService";
import { InstitutionalTemplatesWorkflow } from "../workflowService";

export const PILOT_STEP_IDS = [
  "REGISTER", "LEGAL_EVIDENCE", "READINESS", "APPROVE", "PUBLISH", "BIND", "PREVIEW", "COMPOSE", "INSPECT_M1", "HUMAN_REVIEW", "REVALIDATE", "ISSUE_TEST_ARTIFACT",
] as const;
export type PilotStepId = (typeof PILOT_STEP_IDS)[number];

export type PilotStepKind = "HUMAN_DECISION" | "READ_ONLY" | "STAGING_ONLY" | "HUMAN_GATED";
export type PilotStepStatus = "DONE" | "AWAITING_HUMAN_CONFIRMATION" | "REQUIRES_STAGING" | "SKIPPED_PRECONDITION" | "FAILED";

const STEP_META: Readonly<Record<PilotStepId, { title: string; kind: PilotStepKind }>> = {
  REGISTER: { title: "Criar/importar a revisão como DRAFT (+ procedência)", kind: "HUMAN_DECISION" },
  LEGAL_EVIDENCE: { title: "Registrar a evidência de aprovação jurídica externa", kind: "HUMAN_DECISION" },
  READINESS: { title: "Avaliar a matriz de prontidão", kind: "READ_ONLY" },
  APPROVE: { title: "Aprovar a revisão (decisão humana no sistema)", kind: "HUMAN_DECISION" },
  PUBLISH: { title: "Publicar a revisão (decisão humana distinta)", kind: "HUMAN_DECISION" },
  BIND: { title: "Criar o vínculo (binding) exato com escopo explícito", kind: "HUMAN_DECISION" },
  PREVIEW: { title: "Pré-visualizar pelo binding exato (sem efeitos)", kind: "READ_ONLY" },
  COMPOSE: { title: "Compor o documento de teste (M1) em staging", kind: "STAGING_ONLY" },
  INSPECT_M1: { title: "Inspecionar o manifest M1", kind: "STAGING_ONLY" },
  HUMAN_REVIEW: { title: "Revisão humana (edição governada + aceite exato da IA)", kind: "HUMAN_GATED" },
  REVALIDATE: { title: "Revalidação canônica das fontes", kind: "HUMAN_GATED" },
  ISSUE_TEST_ARTIFACT: { title: "Emitir artefato de teste (M2) pela promoção oficial", kind: "HUMAN_GATED" },
};

export interface PilotStepReport {
  readonly id: PilotStepId;
  readonly order: number;
  readonly title: string;
  readonly kind: PilotStepKind;
  readonly status: PilotStepStatus;
  readonly detail: string;
  readonly evidence?: Readonly<Record<string, unknown>>;
}

/** Composição/inspeção reais (staging). Fornecida só pela CLI em modo staging; ausente ⇒ passos 8–9 `REQUIRES_STAGING`. */
export interface PilotStagingPort {
  compose(args: { readonly documentKind: TemplateDocumentKind; readonly scope: ScopeView; readonly asOf: string }): Promise<{ readonly generationManifestId: string; readonly generatedDocumentId: string; readonly replayed: boolean }>;
  explain(manifestId: string): Promise<{ readonly manifest: { readonly stage: string; readonly id: string | null; readonly manifestHash: string }; readonly revision: { readonly id: string; readonly revision: number; readonly status: string } }>;
}

export interface PilotInput {
  readonly ctx: WorkflowContext;
  readonly ports: TemplateWorkflowPorts;
  readonly runId: string;
  readonly registration: Omit<RegisterModelInput, "confirm" | "idempotencyKey" | "decision">;
  /** Autoridade DECLARADA por uma pessoa para os atos do roteiro (nunca inferida). */
  readonly authority: DeclaredAuthority;
  readonly legalEvidence?: LegalEvidenceInput;
  readonly bindingScope: ScopeView;
  readonly previewContext: PreviewContext;
  readonly inventory?: unknown;
  /** Passos de decisão humana que uma PESSOA confirmou executar nesta rodada. */
  readonly confirmedSteps: ReadonlySet<PilotStepId>;
  readonly staging?: PilotStagingPort;
}

export interface PilotReport {
  readonly runId: string;
  readonly featureEnabledForOrganization: boolean;
  readonly steps: readonly PilotStepReport[];
  readonly completedThrough: PilotStepId | null;
  readonly stoppedAt: PilotStepId | null;
  readonly readiness: ReadinessMatrix | null;
  readonly safety: { readonly productionTouched: false; readonly featureFlagChanged: false; readonly process2026_253Touched: false; readonly aiCalled: false; readonly officialDocumentIssued: false };
}

const SAFETY = Object.freeze({ productionTouched: false, featureFlagChanged: false, process2026_253Touched: false, aiCalled: false, officialDocumentIssued: false } as const);

export async function runEditalPilot(input: PilotInput): Promise<PilotReport> {
  const { ctx, ports, runId } = input;
  const key = (s: PilotStepId): string => `pilot-${runId}-${s}`.slice(0, 128);
  const steps: PilotStepReport[] = [];
  let stoppedAt: PilotStepId | null = null;
  let completedThrough: PilotStepId | null = null;
  let readiness: ReadinessMatrix | null = null;
  const wf = new InstitutionalTemplatesWorkflow(ports);
  const enabled = await ports.flag.isEnabled(ctx.organizationId);

  const push = (id: PilotStepId, status: PilotStepStatus, detail: string, evidence?: Record<string, unknown>): void => {
    const m = STEP_META[id];
    steps.push({ id, order: PILOT_STEP_IDS.indexOf(id) + 1, title: m.title, kind: m.kind, status, detail, ...(evidence ? { evidence } : {}) });
    if (status === "DONE") completedThrough = id; else if (!stoppedAt) stoppedAt = id;
  };
  const skipped = (id: PilotStepId): void => { push(id, "SKIPPED_PRECONDITION", stoppedAt ? `anterior pendente: ${stoppedAt}` : "pré-condição não atendida"); };

  let identityId = ""; let revisionId = ""; let semanticHash = ""; let stagedManifestId = "";
  const requireConfirm = (id: PilotStepId): boolean => {
    if (input.confirmedSteps.has(id)) return true;
    push(id, "AWAITING_HUMAN_CONFIRMATION", `decisão humana não confirmada para ${id}; nada foi alterado (confirme explicitamente este passo)`);
    return false;
  };
  const guard = async (id: PilotStepId, fn: () => Promise<{ detail: string; evidence?: Record<string, unknown> }>): Promise<void> => {
    try { const r = await fn(); push(id, "DONE", r.detail, r.evidence); }
    catch (err) { push(id, "FAILED", err instanceof TemplateWorkflowError ? `${err.message}${err.issues.length ? ` [${err.issues.map((i) => i.code).join(", ")}]` : ""}` : err instanceof Error ? `${err.name}: ${err.message}` : "falha desconhecida"); }
  };

  for (const id of PILOT_STEP_IDS) {
    if (!enabled) { push(id, "SKIPPED_PRECONDITION", "FEATURE OFF para a organização: o backend bloqueia; o harness NÃO liga a flag"); continue; }
    if (stoppedAt) { skipped(id); continue; }
    switch (id) {
      case "REGISTER": {
        if (!requireConfirm(id)) break;
        await guard(id, async () => {
          const r = await new ModelRegistrationService(ports).register(ctx, { ...input.registration, confirm: true, idempotencyKey: key(id), decision: input.authority });
          if (r.revision.status !== "DRAFT") throw new Error("invariante violada: a revisão importada deve nascer DRAFT");
          if (r.provenance.status !== "RECORDED") throw new Error(`procedência não registrada: ${r.provenance.message}`);
          identityId = r.identity.id; revisionId = r.revision.id; semanticHash = r.revision.semanticHash;
          return { detail: `identidade ${r.identity.slug} · revisão ${r.revision.revision} nasceu DRAFT · procedência registrada`, evidence: { identityId, revisionId, semanticHash, status: r.revision.status } };
        });
        break;
      }
      case "LEGAL_EVIDENCE": {
        if (!input.legalEvidence) { push(id, "DONE", "nenhuma evidência informada: passo opcional ignorado (a matriz mostrará a pendência; nada foi inventado)"); break; }
        if (!requireConfirm(id)) break;
        await guard(id, async () => {
          const r = await new TemplateGovernanceService(ports).recordLegalEvidence(ctx, {
            revisionId, expectedVersion: 0, confirm: true, idempotencyKey: key(id), decision: input.authority, evidence: input.legalEvidence!,
          });
          return { detail: `evidência v${r.evidence.version} registrada (não altera o status da revisão)`, evidence: { decisionId: r.evidence.decisionId, parecerNumber: r.evidence.parecerNumber } };
        });
        break;
      }
      case "READINESS": {
        await guard(id, async () => {
          const r = await new TemplateReadinessService(ports).evaluate(ctx, { revisionId, ...(input.inventory !== undefined ? { inventory: input.inventory } : {}) });
          readiness = r.matrix;
          return { detail: `${r.matrix.summary.pass} PASS · ${r.matrix.summary.blocked} BLOCKED · ${r.matrix.summary.notApplicable} NOT_APPLICABLE`, evidence: { matrixHash: r.matrix.matrixHash, blocked: r.matrix.checks.filter((c) => c.status === "BLOCKED").map((c) => c.id) } };
        });
        break;
      }
      case "APPROVE": {
        if (!requireConfirm(id)) break;
        await guard(id, async () => {
          const r = await wf.approve(ctx, { revisionId, expectedStatus: "DRAFT", confirm: true, idempotencyKey: key(id), decision: input.authority });
          return { detail: `revisão ${r.revision.status} (aprovar NÃO publica)`, evidence: { decisionId: r.decision.id } };
        });
        break;
      }
      case "PUBLISH": {
        if (!requireConfirm(id)) break;
        // NÃO há aceite de bloqueio: o backend recalcula a prontidão e recusa (PUBLICATION_BLOCKED) se houver QUALQUER BLOCKED.
        await guard(id, async () => {
          const r = await wf.publish(ctx, {
            revisionId, expectedStatus: "APPROVED", confirm: true, idempotencyKey: key(id), decision: input.authority,
            ...(input.inventory !== undefined ? { inventory: input.inventory } : {}),
          });
          const stored = r.decision.evidence.filter((l) => l.startsWith("readiness."));
          return { detail: `revisão ${r.revision.status} (prontidão recalculada pelo servidor, sem BLOCKED)`, evidence: { decisionId: r.decision.id, readinessEvidence: stored } };
        });
        break;
      }
      case "BIND": {
        if (!requireConfirm(id)) break;
        await guard(id, async () => {
          const b = await wf.setBinding(ctx, { documentKind: input.registration.target.kind === "NEW_IDENTITY" ? input.registration.target.documentKind : "edital", scope: input.bindingScope, identityId, pinnedRevisionId: revisionId, effectiveFrom: ports.clock.now(), confirm: true });
          return { detail: `binding ${b.id} fixa a revisão EXATA ${revisionId}`, evidence: { bindingId: b.id, pinnedRevisionId: b.pinnedRevisionId, scope: b.scope } };
        });
        break;
      }
      case "PREVIEW": {
        await guard(id, async () => {
          const kind: TemplateDocumentKind = input.registration.target.kind === "NEW_IDENTITY" ? input.registration.target.documentKind : "edital";
          const d: PreviewDossier = await new TemplatePreviewDossierService(ports).dossier(ctx, { kind: "BOUND", documentKind: kind }, input.previewContext);
          if (d.status === "NOT_RESOLVED") throw new Error("o binding exato não resolveu — nenhuma prévia (fail-closed)");
          if (d.status === "COMPOSE_ERROR") throw new Error(`composição de teste falhou fechada: ${d.composeError}`);
          if (d.revision?.id !== revisionId) throw new Error("a prévia resolveu OUTRA revisão que a vinculada");
          return { detail: `prévia da revisão exata ${d.revision.revision} (${d.context.scopeHeadline}); sem efeitos colaterais`, evidence: { manifestHash: d.manifestPreview?.manifestHash, sideEffects: d.sideEffects } };
        });
        break;
      }
      case "COMPOSE": {
        if (!input.staging) { push(id, "REQUIRES_STAGING", "composição real (processo + fontes canônicas + M1) só em staging: rode a CLI com --mode=staging e um processo de TESTE (nunca o 2026/253)"); break; }
        await guard(id, async () => {
          const r = await input.staging!.compose({ documentKind: "edital", scope: input.bindingScope, asOf: ports.clock.now() });
          stagedManifestId = r.generationManifestId;
          return { detail: `M1 ${r.generationManifestId} · rascunho ${r.generatedDocumentId}${r.replayed ? " (replay)" : ""}`, evidence: r };
        });
        break;
      }
      case "INSPECT_M1": {
        if (!input.staging) { push(id, "REQUIRES_STAGING", "inspeção do M1 só em staging (router: institutionalTemplates.explainManifest)"); break; }
        await guard(id, async () => {
          const e = await input.staging!.explain(stagedManifestId);
          if (e.revision.id !== revisionId) throw new Error("o M1 referencia OUTRA revisão que a publicada/vinculada");
          return { detail: `M1 ${e.manifest.id} aponta para a revisão exata ${e.revision.revision} (${e.revision.status})`, evidence: { manifestHash: e.manifest.manifestHash } };
        });
        break;
      }
      case "HUMAN_REVIEW":
        push(id, "AWAITING_HUMAN_CONFIRMATION", "HUMANO: edite o rascunho (edição governada) e aceite cada narrativa de IA pelo hash EXATO — router institutionalTemplates.reviews.acceptAiNarrative / acknowledgeDeviation; o harness não age pelo humano"); break;
      case "REVALIDATE":
        push(id, "AWAITING_HUMAN_CONFIRMATION", "HUMANO: a revalidação canônica (SOURCE_CHANGED bloqueia) ocorre na emissão; nada é regenerado automaticamente"); break;
      case "ISSUE_TEST_ARTIFACT":
        push(id, "AWAITING_HUMAN_CONFIRMATION", "HUMANO: emitir o artefato de TESTE pela promoção oficial (gera o M2 na transação); nunca no processo 2026/253 nem em produção"); break;
    }
  }
  return { runId, featureEnabledForOrganization: enabled, steps, completedThrough, stoppedAt, readiness, safety: SAFETY };
}

