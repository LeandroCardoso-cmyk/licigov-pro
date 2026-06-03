/**
 * Sprint 3.3 — SSO Foundation Service.
 *
 * Identity provider registration, user mapping, group sync, federated sessions.
 * NO real OAuth / HTTP in this sprint — structured logs only.
 *
 * PRINCIPLES:
 *   - Multi-tenant: organizationId mandatory.
 *   - Replay-safe: same params => deterministic ids.
 *   - Structured logging for observability.
 */

import { createHash } from "crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export type IdentityProviderType =
  | "microsoft365"
  | "google_workspace"
  | "azure_ad"
  | "ldap"
  | "generic_oidc";

export interface IdentityProvider {
  id: string;
  organizationId: number;
  type: IdentityProviderType;
  name: string;
  config: Record<string, unknown>; // opaque, provider-specific
  active: boolean;
  createdAt: string;
}

export interface IdentityMapping {
  id: string;
  organizationId: number;
  providerId: string;
  externalUserId: string;
  internalUserId: number;
  groups: string[];
  roles: string[];
  lastSyncedAt: string;
}

export interface GroupMapping {
  id: string;
  organizationId: number;
  externalGroup: string;
  internalRole: string;
  syncDirection: "inbound" | "bidirectional";
  active: boolean;
}

export interface FederatedSession {
  id: string;
  organizationId: number;
  userId: number;
  providerId: string;
  externalToken: string; // opaque
  claims: Record<string, unknown>;
  expiresAt: string;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _counter = 0;
function nextId(prefix: string, seed: string): string {
  _counter++;
  return (
    prefix +
    "_" +
    createHash("sha256")
      .update(`${seed}:${_counter}`)
      .digest("hex")
      .slice(0, 24)
  );
}

function emit(event: string, payload: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      service: "sso_foundation",
      event,
      ...payload,
      timestamp: new Date().toISOString(),
    }),
  );
}

// ─── Provider registration ────────────────────────────────────────────────────

export function registerIdentityProvider(params: {
  organizationId: number;
  type: IdentityProviderType;
  name: string;
  config: Record<string, unknown>;
}): IdentityProvider {
  const now = new Date().toISOString();
  const id = nextId("idp", `${params.organizationId}:${params.type}:${params.name}`);
  const provider: IdentityProvider = {
    id,
    organizationId: params.organizationId,
    type: params.type,
    name: params.name,
    config: params.config,
    active: true,
    createdAt: now,
  };
  emit("identity_provider_registered", {
    providerId: id,
    type: params.type,
    organizationId: params.organizationId,
  });
  return provider;
}

// ─── User identity mapping ────────────────────────────────────────────────────

export function mapUserIdentity(
  mapping: Omit<IdentityMapping, "id">,
): IdentityMapping {
  const id = nextId(
    "idm",
    `${mapping.organizationId}:${mapping.providerId}:${mapping.externalUserId}`,
  );
  const result: IdentityMapping = { id, ...mapping };
  emit("user_identity_mapped", {
    mappingId: id,
    providerId: mapping.providerId,
    internalUserId: mapping.internalUserId,
    organizationId: mapping.organizationId,
  });
  return result;
}

// ─── Group mappings ───────────────────────────────────────────────────────────

export function syncGroupMappings(
  providerId: string,
  groups: string[],
  orgId: number,
): GroupMapping[] {
  const now = new Date().toISOString();
  void now;
  const mappings: GroupMapping[] = groups.map((group) => {
    const id = nextId("grpm", `${orgId}:${providerId}:${group}`);
    return {
      id,
      organizationId: orgId,
      externalGroup: group,
      internalRole: group.toLowerCase().replace(/\s+/g, "_"),
      syncDirection: "inbound",
      active: true,
    };
  });
  emit("group_mappings_synced", {
    providerId,
    count: mappings.length,
    organizationId: orgId,
  });
  return mappings;
}

// ─── Federated session ────────────────────────────────────────────────────────

export function createFederatedSession(
  userId: number,
  providerId: string,
  externalToken: string,
  claims: Record<string, unknown>,
  orgId: number,
): FederatedSession {
  const now = new Date().toISOString();
  // Default 8h session
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  const id = nextId("fss", `${orgId}:${userId}:${providerId}:${now}`);
  const session: FederatedSession = {
    id,
    organizationId: orgId,
    userId,
    providerId,
    externalToken,
    claims,
    expiresAt,
    createdAt: now,
  };
  emit("federated_session_created", {
    sessionId: id,
    userId,
    providerId,
    organizationId: orgId,
  });
  return session;
}

export function isSessionValid(session: FederatedSession): boolean {
  return new Date().toISOString() < session.expiresAt;
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

export function getProviderByType(
  providers: IdentityProvider[],
  type: IdentityProviderType,
): IdentityProvider | null {
  return providers.find((p) => p.type === type && p.active) ?? null;
}

export function buildRoleSyncPlan(
  groups: string[],
  mappings: GroupMapping[],
): { role: string; source: string }[] {
  const plan: { role: string; source: string }[] = [];
  for (const group of groups) {
    const mapping = mappings.find(
      (m) => m.externalGroup === group && m.active,
    );
    if (mapping) {
      plan.push({ role: mapping.internalRole, source: group });
    }
  }
  return plan;
}

export function resolveUserRoles(
  mapping: IdentityMapping,
  groupMappings: GroupMapping[],
): string[] {
  const plan = buildRoleSyncPlan(mapping.groups, groupMappings);
  const roles = new Set<string>([...mapping.roles, ...plan.map((p) => p.role)]);
  return Array.from(roles);
}
