import { createHash } from "crypto";

function sha256(x: string): string {
  return createHash("sha256").update(x, "utf8").digest("hex");
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type AssistantRole =
  | "legal_copilot"
  | "drafting_copilot"
  | "review_copilot"
  | "compliance_copilot"
  | "import_copilot"
  | "procurement_copilot"
  | "general_assistant";

export type CapabilityType =
  | "analyze"
  | "draft"
  | "review"
  | "validate"
  | "recommend"
  | "explain"
  | "search"
  | "summarize"
  | "compare"
  | "classify";

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface AssistantContextScope {
  readonly allowedDocumentTypes: string[];
  readonly allowedOperations: string[];
  readonly maxConcurrentTasks: number;
  readonly requiresHumanReview: boolean;
  readonly escalationThreshold: number;
  readonly legalFrameworks: string[];
}

export interface AssistantCapability {
  readonly id: string;
  readonly profileId: string;
  readonly organizationId: number;
  readonly capabilityType: CapabilityType;
  readonly description: string;
  readonly confidenceThreshold: number;
  readonly maxInputLength: number;
  readonly supportedDocumentTypes: string[];
  readonly legalFrameworks: string[];
  readonly isEnabled: boolean;
}

export interface AssistantRestriction {
  readonly id: string;
  readonly profileId: string;
  readonly organizationId: number;
  readonly restrictionType: "forbidden_action" | "required_approval" | "max_autonomy_level" | "scope_limit";
  readonly description: string;
  readonly expression: string;
  readonly severity: "hard" | "soft";
  readonly isActive: boolean;
}

export interface AssistantProfile {
  readonly id: string;
  readonly organizationId: number;
  readonly role: AssistantRole;
  readonly name: string;
  readonly description: string;
  readonly capabilities: AssistantCapability[];
  readonly restrictions: AssistantRestriction[];
  readonly contextScope: AssistantContextScope;
  readonly version: string;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ─── Default profiles per role ────────────────────────────────────────────────

const ROLE_DEFAULTS: Record<AssistantRole, {
  name: string;
  description: string;
  capabilities: CapabilityType[];
  scope: Partial<AssistantContextScope>;
}> = {
  legal_copilot: {
    name: "Copilot Jurídico",
    description: "Especialista em análise e raciocínio jurídico de licitações",
    capabilities: ["analyze", "explain", "validate", "recommend"],
    scope: { allowedDocumentTypes: ["TR", "Edital", "Contrato"], requiresHumanReview: true, escalationThreshold: 0.7 },
  },
  drafting_copilot: {
    name: "Copilot de Minutas",
    description: "Especialista em redação e estruturação de documentos licitatórios",
    capabilities: ["draft", "review", "recommend", "summarize"],
    scope: { allowedDocumentTypes: ["TR", "ETP", "Edital", "Contrato"], requiresHumanReview: true, escalationThreshold: 0.8 },
  },
  review_copilot: {
    name: "Copilot de Revisão",
    description: "Especialista em revisão e conformidade de minutas",
    capabilities: ["review", "validate", "compare", "explain"],
    scope: { allowedDocumentTypes: ["TR", "Edital", "Contrato", "ETP"], requiresHumanReview: false, escalationThreshold: 0.6 },
  },
  compliance_copilot: {
    name: "Copilot de Compliance",
    description: "Especialista em conformidade com a Lei 14133/2021",
    capabilities: ["validate", "analyze", "recommend", "classify"],
    scope: { allowedDocumentTypes: ["TR", "Edital", "Contrato", "ETP"], requiresHumanReview: true, escalationThreshold: 0.5 },
  },
  import_copilot: {
    name: "Copilot de Importação",
    description: "Especialista em importação e normalização de dados",
    capabilities: ["classify", "validate", "recommend", "summarize"],
    scope: { allowedDocumentTypes: ["planilha", "csv", "pdf"], requiresHumanReview: false, escalationThreshold: 0.65 },
  },
  procurement_copilot: {
    name: "Copilot de Compras",
    description: "Especialista em processos de aquisição e contratação",
    capabilities: ["analyze", "recommend", "search", "compare"],
    scope: { allowedDocumentTypes: ["TR", "ETP", "Edital"], requiresHumanReview: false, escalationThreshold: 0.75 },
  },
  general_assistant: {
    name: "Assistente Geral",
    description: "Assistente de uso geral para suporte ao usuário",
    capabilities: ["analyze", "explain", "search", "summarize", "recommend"],
    scope: { allowedDocumentTypes: ["TR", "Edital", "Contrato", "ETP", "planilha", "pdf"], requiresHumanReview: false, escalationThreshold: 0.5 },
  },
};

// ─── Functions ────────────────────────────────────────────────────────────────

export function createAssistantProfile(params: {
  organizationId: number;
  role: AssistantRole;
  name?: string;
  description?: string;
  capabilities?: AssistantCapability[];
  restrictions?: AssistantRestriction[];
  contextScope?: Partial<AssistantContextScope>;
}): AssistantProfile {
  const now = new Date().toISOString();
  const defaults = ROLE_DEFAULTS[params.role];
  const name = params.name ?? defaults.name;
  const id = sha256(`profile:${params.organizationId}:${params.role}:${name}`).slice(0, 20);

  const scope: AssistantContextScope = {
    allowedDocumentTypes: params.contextScope?.allowedDocumentTypes ?? defaults.scope.allowedDocumentTypes ?? ["TR"],
    allowedOperations: params.contextScope?.allowedOperations ?? defaults.capabilities,
    maxConcurrentTasks: params.contextScope?.maxConcurrentTasks ?? 3,
    requiresHumanReview: params.contextScope?.requiresHumanReview ?? defaults.scope.requiresHumanReview ?? true,
    escalationThreshold: params.contextScope?.escalationThreshold ?? defaults.scope.escalationThreshold ?? 0.7,
    legalFrameworks: params.contextScope?.legalFrameworks ?? ["Lei 14133/2021"],
  };

  const capabilities = params.capabilities ?? defaults.capabilities.map((cap): AssistantCapability => ({
    id: sha256(`cap:${id}:${cap}`).slice(0, 20),
    profileId: id,
    organizationId: params.organizationId,
    capabilityType: cap,
    description: `Capacidade de ${cap} para ${name}`,
    confidenceThreshold: 0.7,
    maxInputLength: 10000,
    supportedDocumentTypes: scope.allowedDocumentTypes,
    legalFrameworks: scope.legalFrameworks,
    isEnabled: true,
  }));

  return {
    id,
    organizationId: params.organizationId,
    role: params.role,
    name,
    description: params.description ?? defaults.description,
    capabilities,
    restrictions: params.restrictions ?? [],
    contextScope: scope,
    version: "1.0.0",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function getDefaultProfile(organizationId: number, role: AssistantRole): AssistantProfile {
  return createAssistantProfile({ organizationId, role });
}

export function canAssistantPerform(
  profile: AssistantProfile,
  capabilityType: CapabilityType,
  documentType?: string,
): boolean {
  if (!profile.isActive) return false;
  const cap = profile.capabilities.find(c => c.capabilityType === capabilityType && c.isEnabled);
  if (!cap) return false;
  if (documentType && !cap.supportedDocumentTypes.includes(documentType)) return false;
  const blocked = profile.restrictions.find(
    r => r.isActive && r.severity === "hard" && r.expression.includes(capabilityType)
  );
  return !blocked;
}

export function getCapabilityConfidence(
  profile: AssistantProfile,
  capabilityType: CapabilityType,
): number {
  const cap = profile.capabilities.find(c => c.capabilityType === capabilityType && c.isEnabled);
  return cap?.confidenceThreshold ?? 0;
}

export function isActionRestricted(
  profile: AssistantProfile,
  action: string,
): { restricted: boolean; reason: string | null } {
  const restriction = profile.restrictions.find(
    r => r.isActive && r.expression.includes(action)
  );
  if (!restriction) return { restricted: false, reason: null };
  return { restricted: true, reason: restriction.description };
}

export function mergeProfiles(base: AssistantProfile, override: Partial<AssistantProfile>): AssistantProfile {
  const now = new Date().toISOString();
  return {
    ...base,
    ...override,
    capabilities: override.capabilities ?? base.capabilities,
    restrictions: override.restrictions ?? base.restrictions,
    contextScope: override.contextScope ?? base.contextScope,
    updatedAt: now,
  };
}
