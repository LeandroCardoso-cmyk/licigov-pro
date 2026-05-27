/**
 * Sprint 2.5 — Document Policy Engine.
 *
 * Centraliza todas as regras de permissão documental:
 * edição, aprovação, restauração, comentários, arquivamento,
 * locking, exportação e gerência de anexos.
 *
 * ABAC-ready: avalia actor + role + document state + tenant context.
 */
import { TRPCError } from "@trpc/server";
import type { OrgRole } from "../../drizzle/schema";
import type { DocumentStatusValue } from "./documentTypes";

// ─── Action catalog ───────────────────────────────────────────────────────────

export type PolicyAction =
  | "edit"
  | "approve"
  | "reject"
  | "submit_review"
  | "restore_version"
  | "comment"
  | "archive"
  | "unlock"
  | "export"
  | "delete_draft"
  | "manage_attachments"
  | "view_history"
  | "manage_lock"
  | "verify_integrity"
  | "purge";

// ─── Context ──────────────────────────────────────────────────────────────────

export interface PolicyDocumentContext {
  organizationId: number;
  createdBy:      number;
  documentStatus: DocumentStatusValue;
  isLocked:       number;
  lockedBy:       number | null;
  lockExpiresAt:  Date | string | null;
  legalHold?:     number;
}

export interface PolicyEvaluationContext {
  actorId:        number;
  actorRole:      OrgRole;
  organizationId: number;
  document:       PolicyDocumentContext;
}

export interface PolicyResult {
  allowed: boolean;
  reason?: string;
}

// ─── Role weights ─────────────────────────────────────────────────────────────

const ROLE_WEIGHT: Record<OrgRole, number> = {
  viewer: 1, operator: 2, manager: 3, admin: 4, owner: 5,
};

function hasMinRole(actorRole: OrgRole, minRole: OrgRole): boolean {
  return (ROLE_WEIGHT[actorRole] ?? 0) >= ROLE_WEIGHT[minRole];
}

// ─── Lock helpers ─────────────────────────────────────────────────────────────

function isLockExpired(doc: PolicyDocumentContext): boolean {
  if (!doc.lockExpiresAt) return false;
  return new Date() > new Date(doc.lockExpiresAt);
}

function isEffectivelyLocked(doc: PolicyDocumentContext, actorId: number): boolean {
  if (!doc.isLocked)              return false;
  if (isLockExpired(doc))         return false;
  if (doc.lockedBy === actorId)   return false; // own lock
  return true;
}

// ─── Core evaluator ───────────────────────────────────────────────────────────

export function evaluatePolicy(
  action: PolicyAction,
  ctx:    PolicyEvaluationContext,
): PolicyResult {
  const { actorId, actorRole, organizationId, document } = ctx;

  // Tenant isolation — invariant guard
  if (document.organizationId !== organizationId) {
    return { allowed: false, reason: "Documento pertence a outra organização." };
  }

  switch (action) {

    case "edit": {
      if (document.documentStatus === "archived")
        return { allowed: false, reason: "Documento arquivado não pode ser editado." };
      if (document.documentStatus === "approved" && !hasMinRole(actorRole, "admin"))
        return { allowed: false, reason: "Apenas admin pode editar documento aprovado." };
      if (isEffectivelyLocked(document, actorId))
        return { allowed: false, reason: "Documento bloqueado por outro usuário." };
      if (!hasMinRole(actorRole, "operator"))
        return { allowed: false, reason: "Requer papel operator ou superior para editar." };
      return { allowed: true };
    }

    case "approve": {
      if (document.documentStatus !== "in_review")
        return { allowed: false, reason: "Somente documentos em revisão podem ser aprovados." };
      if (!hasMinRole(actorRole, "manager"))
        return { allowed: false, reason: "Requer papel manager ou superior para aprovar." };
      return { allowed: true };
    }

    case "reject": {
      if (document.documentStatus !== "in_review")
        return { allowed: false, reason: "Somente documentos em revisão podem ser rejeitados." };
      if (!hasMinRole(actorRole, "manager"))
        return { allowed: false, reason: "Requer papel manager ou superior para rejeitar." };
      return { allowed: true };
    }

    case "submit_review": {
      if (document.documentStatus !== "draft" && document.documentStatus !== "rejected")
        return { allowed: false, reason: "Somente rascunhos ou rejeitados podem ser submetidos para revisão." };
      if (!hasMinRole(actorRole, "operator"))
        return { allowed: false, reason: "Requer papel operator ou superior." };
      return { allowed: true };
    }

    case "restore_version": {
      if (document.documentStatus === "archived")
        return { allowed: false, reason: "Não é possível restaurar versão de documento arquivado." };
      if (!hasMinRole(actorRole, "manager"))
        return { allowed: false, reason: "Requer papel manager ou superior para restaurar versão." };
      return { allowed: true };
    }

    case "comment": {
      if (document.documentStatus === "archived" && !hasMinRole(actorRole, "manager"))
        return { allowed: false, reason: "Somente managers podem comentar em documentos arquivados." };
      if (!hasMinRole(actorRole, "viewer"))
        return { allowed: false, reason: "Requer papel viewer ou superior para comentar." };
      return { allowed: true };
    }

    case "archive": {
      if (document.documentStatus === "archived")
        return { allowed: false, reason: "Documento já está arquivado." };
      if (document.legalHold)
        return { allowed: false, reason: "Documento com legal hold não pode ser arquivado." };
      if (!hasMinRole(actorRole, "manager"))
        return { allowed: false, reason: "Requer papel manager ou superior para arquivar." };
      return { allowed: true };
    }

    case "unlock": {
      if (!document.isLocked || isLockExpired(document))
        return { allowed: false, reason: "Documento não está bloqueado." };
      if (document.lockedBy === actorId) return { allowed: true }; // own lock
      if (!hasMinRole(actorRole, "admin"))
        return { allowed: false, reason: "Requer papel admin para desbloquear documento de outro usuário." };
      return { allowed: true };
    }

    case "export": {
      if (!hasMinRole(actorRole, "operator"))
        return { allowed: false, reason: "Requer papel operator ou superior para exportar." };
      return { allowed: true };
    }

    case "delete_draft": {
      if (!hasMinRole(actorRole, "operator"))
        return { allowed: false, reason: "Requer papel operator ou superior." };
      return { allowed: true };
    }

    case "manage_attachments": {
      if (document.documentStatus === "archived")
        return { allowed: false, reason: "Não é possível gerenciar anexos de documento arquivado." };
      if (!hasMinRole(actorRole, "operator"))
        return { allowed: false, reason: "Requer papel operator ou superior." };
      return { allowed: true };
    }

    case "view_history": {
      if (!hasMinRole(actorRole, "viewer"))
        return { allowed: false, reason: "Requer papel viewer ou superior para ver histórico." };
      return { allowed: true };
    }

    case "manage_lock": {
      if (!hasMinRole(actorRole, "operator"))
        return { allowed: false, reason: "Requer papel operator ou superior." };
      return { allowed: true };
    }

    case "verify_integrity": {
      if (!hasMinRole(actorRole, "manager"))
        return { allowed: false, reason: "Requer papel manager ou superior para verificar integridade." };
      return { allowed: true };
    }

    case "purge": {
      if (document.legalHold)
        return { allowed: false, reason: "Documento com legal hold não pode ser purgado." };
      if (!hasMinRole(actorRole, "owner"))
        return { allowed: false, reason: "Somente owner pode purgar documentos." };
      return { allowed: true };
    }

    default:
      return { allowed: false, reason: "Ação desconhecida." };
  }
}

// ─── Guard (throws on deny) ───────────────────────────────────────────────────

export function assertPolicy(
  action: PolicyAction,
  ctx:    PolicyEvaluationContext,
): void {
  const result = evaluatePolicy(action, ctx);
  if (!result.allowed) {
    throw new TRPCError({ code: "FORBIDDEN", message: result.reason ?? "Ação não permitida." });
  }
}

// ─── Batch evaluation ─────────────────────────────────────────────────────────

export function evaluatePolicies(
  actions: PolicyAction[],
  ctx:     PolicyEvaluationContext,
): Record<PolicyAction, PolicyResult> {
  return Object.fromEntries(
    actions.map(a => [a, evaluatePolicy(a, ctx)]),
  ) as Record<PolicyAction, PolicyResult>;
}
