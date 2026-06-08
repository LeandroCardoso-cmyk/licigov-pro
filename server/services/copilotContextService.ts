import { createHash } from "crypto";
import {
  type AssistantRole,
  type AssistantProfile,
  type AssistantCapability,
  type AssistantRestriction,
  getDefaultProfile,
  canAssistantPerform,
  isActionRestricted,
  type CapabilityType,
} from "../domain/assistantSpecialization";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CopilotContextInput {
  organizationId: number;
  sessionId: string;
  role: AssistantRole;
  documentType?: string;
  operationType?: string;
  legalFramework?: string;
}

export interface CopilotContextOutput {
  profile: AssistantProfile;
  activeCapabilities: AssistantCapability[];
  restrictions: AssistantRestriction[];
  contextSummary: string;
  canProceed: boolean;
  blockedReasons: string[];
  processingMs: number;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

const _store = new Map<number, CopilotContextOutput[]>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(x: string): string {
  return createHash("sha256").update(x, "utf8").digest("hex");
}

// ─── Service ──────────────────────────────────────────────────────────────────

export function assembleCopilotContext(input: CopilotContextInput): CopilotContextOutput {
  const start = Date.now();
  const { organizationId, sessionId, role, documentType, operationType } = input;

  const profile = getDefaultProfile(organizationId, role);
  const activeCapabilities = profile.capabilities.filter(c =>
    c.isEnabled && (!documentType || c.supportedDocumentTypes.includes(documentType))
  );

  const blockedReasons: string[] = [];

  if (operationType) {
    const restriction = isActionRestricted(profile, operationType);
    if (restriction.restricted && restriction.reason) {
      blockedReasons.push(restriction.reason);
    }
  }

  if (documentType) {
    const allOps: CapabilityType[] = ["analyze", "draft", "review", "validate"];
    const canAny = allOps.some(op => canAssistantPerform(profile, op, documentType));
    if (!canAny) {
      blockedReasons.push(`Tipo de documento '${documentType}' não suportado para este perfil`);
    }
  }

  const canProceed = blockedReasons.length === 0 && profile.isActive;

  const contextSummary = [
    `Perfil: ${profile.name} (${profile.role})`,
    `Capacidades ativas: ${activeCapabilities.map(c => c.capabilityType).join(", ") || "nenhuma"}`,
    `Revisão humana obrigatória: ${profile.contextScope.requiresHumanReview ? "sim" : "não"}`,
    `Threshold de escalação: ${profile.contextScope.escalationThreshold}`,
    canProceed ? "Status: PODE PROSSEGUIR" : `Status: BLOQUEADO — ${blockedReasons.join("; ")}`,
  ].join(" | ");

  const output: CopilotContextOutput = {
    profile,
    activeCapabilities,
    restrictions: profile.restrictions,
    contextSummary,
    canProceed,
    blockedReasons,
    processingMs: Date.now() - start,
  };

  const existing = _store.get(organizationId) ?? [];
  _store.set(organizationId, [...existing, output]);
  return output;
}

export function getCopilotHistory(organizationId: number): CopilotContextOutput[] {
  return _store.get(organizationId) ?? [];
}

export function getDefaultCopilot(organizationId: number, role: AssistantRole): AssistantProfile {
  return getDefaultProfile(organizationId, role);
}
