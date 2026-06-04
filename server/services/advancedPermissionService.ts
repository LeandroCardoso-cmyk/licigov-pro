/**
 * Sprint 3.4 — Advanced Permission Service.
 *
 * Permissoes granulares por departamento, workflow e escopo de recurso.
 * Complementa o sistema de roles basico com controle fino sobre acoes
 * especificas em contextos organizacionais.
 *
 * Embasamento: segregacao de funcoes (Lei 14.133/2021, art. 7-9).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ResourceType =
  | "processo"
  | "item_tr"
  | "template"
  | "relatorio"
  | "configuracao"
  | "usuario"
  | "auditoria";

export type ActionType =
  | "create"
  | "read"
  | "update"
  | "delete"
  | "approve"
  | "reject"
  | "export"
  | "assign"
  | "escalate";

export type PermissionScope =
  | "own"          // apenas recursos do proprio usuario
  | "department"   // recursos do departamento
  | "organization" // todos os recursos da org
  | "global";      // admin global

export interface DepartmentPermission {
  id:             string;
  organizationId: number;
  userId:         number;
  department:     string;
  resource:       ResourceType;
  actions:        ActionType[];
  scope:          PermissionScope;
  grantedBy:      number;
  grantedAt:      string;
  expiresAt:      string | null;
  active:         boolean;
}

export interface WorkflowPermission {
  id:             string;
  organizationId: number;
  userId:         number;
  workflowStage:  string;
  canAdvance:     boolean;
  canReject:      boolean;
  canEscalate:    boolean;
  canDelegate:    boolean;
  maxDelegations: number;
  grantedBy:      number;
  grantedAt:      string;
}

export interface ScopedPermissionCheck {
  allowed:  boolean;
  reason:   string;
  scope:    PermissionScope | null;
  checkedAt: string;
}

export interface PermissionAuditEntry {
  id:             string;
  organizationId: number;
  userId:         number;
  action:         ActionType;
  resource:       ResourceType;
  resourceId:     string;
  allowed:        boolean;
  reason:         string;
  occurredAt:     string;
}

// ─── In-memory store (production: DB) ────────────────────────────────────────

const _departmentPerms: DepartmentPermission[] = [];
const _workflowPerms:   WorkflowPermission[]   = [];
const _auditLog:        PermissionAuditEntry[]  = [];
let   _auditCounter = 0;

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++_auditCounter}`;
}

// ─── Grant / revoke ───────────────────────────────────────────────────────────

export function grantDepartmentPermission(params: {
  organizationId: number;
  userId:         number;
  department:     string;
  resource:       ResourceType;
  actions:        ActionType[];
  scope:          PermissionScope;
  grantedBy:      number;
  expiresAt?:     string;
}): DepartmentPermission {
  const perm: DepartmentPermission = {
    id:             genId("dperm"),
    organizationId: params.organizationId,
    userId:         params.userId,
    department:     params.department,
    resource:       params.resource,
    actions:        params.actions,
    scope:          params.scope,
    grantedBy:      params.grantedBy,
    grantedAt:      new Date().toISOString(),
    expiresAt:      params.expiresAt ?? null,
    active:         true,
  };
  _departmentPerms.push(perm);
  return perm;
}

export function revokeDepartmentPermission(
  permId:         string,
  organizationId: number,
): boolean {
  const perm = _departmentPerms.find(p => p.id === permId && p.organizationId === organizationId);
  if (!perm) return false;
  perm.active = false;
  return true;
}

export function grantWorkflowPermission(params: {
  organizationId: number;
  userId:         number;
  workflowStage:  string;
  canAdvance:     boolean;
  canReject:      boolean;
  canEscalate:    boolean;
  canDelegate:    boolean;
  maxDelegations: number;
  grantedBy:      number;
}): WorkflowPermission {
  const perm: WorkflowPermission = {
    id:             genId("wperm"),
    organizationId: params.organizationId,
    userId:         params.userId,
    workflowStage:  params.workflowStage,
    canAdvance:     params.canAdvance,
    canReject:      params.canReject,
    canEscalate:    params.canEscalate,
    canDelegate:    params.canDelegate,
    maxDelegations: params.maxDelegations,
    grantedBy:      params.grantedBy,
    grantedAt:      new Date().toISOString(),
  };
  _workflowPerms.push(perm);
  return perm;
}

// ─── Check ────────────────────────────────────────────────────────────────────

export function checkDepartmentPermission(
  organizationId: number,
  userId:         number,
  department:     string,
  resource:       ResourceType,
  action:         ActionType,
): ScopedPermissionCheck {
  const now = new Date().toISOString();

  const perms = _departmentPerms.filter(
    p =>
      p.organizationId === organizationId &&
      p.userId         === userId         &&
      p.department     === department     &&
      p.resource       === resource       &&
      p.active         === true           &&
      (p.expiresAt === null || p.expiresAt > now),
  );

  for (const p of perms) {
    if (p.actions.includes(action)) {
      return { allowed: true, reason: `Permissao "${action}" concedida (scope: ${p.scope}).`, scope: p.scope, checkedAt: now };
    }
  }

  return { allowed: false, reason: `Sem permissao "${action}" em ${resource}/${department}.`, scope: null, checkedAt: now };
}

export function checkWorkflowPermission(
  organizationId: number,
  userId:         number,
  workflowStage:  string,
  capability:     "canAdvance" | "canReject" | "canEscalate" | "canDelegate",
): ScopedPermissionCheck {
  const now = new Date().toISOString();
  const perm = _workflowPerms.find(
    p => p.organizationId === organizationId && p.userId === userId && p.workflowStage === workflowStage,
  );

  if (!perm) {
    return { allowed: false, reason: `Nenhuma permissao de workflow para estagio "${workflowStage}".`, scope: null, checkedAt: now };
  }

  const allowed = perm[capability] === true;
  return {
    allowed,
    reason:    allowed ? `Permissao "${capability}" concedida.` : `Permissao "${capability}" negada.`,
    scope:     "organization",
    checkedAt: now,
  };
}

// ─── Audit ────────────────────────────────────────────────────────────────────

export function auditPermissionCheck(
  organizationId: number,
  userId:         number,
  action:         ActionType,
  resource:       ResourceType,
  resourceId:     string,
  result:         ScopedPermissionCheck,
): PermissionAuditEntry {
  const entry: PermissionAuditEntry = {
    id:             genId("audit"),
    organizationId,
    userId,
    action,
    resource,
    resourceId,
    allowed:    result.allowed,
    reason:     result.reason,
    occurredAt: new Date().toISOString(),
  };
  _auditLog.push(entry);
  return entry;
}

export function getPermissionAuditLog(
  organizationId: number,
  limit:          number = 100,
): PermissionAuditEntry[] {
  return _auditLog
    .filter(e => e.organizationId === organizationId)
    .slice(-limit);
}

export function getDepartmentPermissions(
  organizationId: number,
  userId:         number,
): DepartmentPermission[] {
  return _departmentPerms.filter(p => p.organizationId === organizationId && p.userId === userId && p.active);
}

export function getWorkflowPermissions(
  organizationId: number,
  userId:         number,
): WorkflowPermission[] {
  return _workflowPerms.filter(p => p.organizationId === organizationId && p.userId === userId);
}
