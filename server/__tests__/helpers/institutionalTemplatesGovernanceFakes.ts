/**
 * Test double do `TemplateGovernancePort` (procedência + evidência jurídica) com a MESMA semântica do adapter real sobre o ledger:
 * lock (revisão existe no tenant), replay por chave de idempotência (única por organização, COMPARTILHADA com as decisões do ciclo de
 * vida), CAS pela versão corrente e append-only. Compartilha o mapa de decisões do repositório em memória.
 */
import { DECISION_STALE_REVISION, planDecision, type DecisionRequest, type DecisionSubjectType, type InstitutionalDecision } from "../../domain/institutionalDecision";
import type { GovernanceCommitResult, TemplateGovernancePort } from "../../services/institutionalTemplates/ports";
import type { InMemoryTemplateRepository } from "./institutionalTemplatesFakes";

export class InMemoryGovernance implements TemplateGovernancePort {
  /** Escritas efetivas deste port (prova "nenhuma escrita" em recusas). */
  writes = 0;
  constructor(private readonly repo: InMemoryTemplateRepository) {}

  async recordGovernanceDecision(request: DecisionRequest): Promise<GovernanceCommitResult> {
    const rev = await this.repo.getRevision(request.organizationId, request.subjectId);
    if (!rev) return { status: "SUBJECT_NOT_FOUND" };
    const all = [...this.repo.decisions.values()].filter((d) => d.organizationId === request.organizationId);
    const byKey = all.find((d) => d.idempotencyKey === request.idempotencyKey.trim()) ?? null;
    const current = all.filter((d) => d.subjectType === request.subjectType && d.subjectId === request.subjectId).sort((a, b) => b.revision - a.revision)[0] ?? null;
    const plan = planDecision(request, { byIdempotencyKey: byKey, current });
    if (plan.kind === "replay") return { status: "REPLAYED", decision: plan.decision };
    if (plan.kind === "conflict") return plan.code === DECISION_STALE_REVISION ? { status: "STALE_VERSION", currentVersion: plan.currentRevision } : { status: "DECISION_IDEMPOTENCY_CONFLICT" };
    this.repo.decisions.set(plan.decision.id, plan.decision);
    this.writes++;
    return { status: "COMMITTED", decision: plan.decision };
  }

  async listGovernanceDecisions(org: number, subjectType: DecisionSubjectType, revisionId: string): Promise<readonly InstitutionalDecision[]> {
    return [...this.repo.decisions.values()].filter((d) => d.organizationId === org && d.subjectType === subjectType && d.subjectId === revisionId).sort((a, b) => a.revision - b.revision);
  }
}
