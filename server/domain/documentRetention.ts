/**
 * Sprint 2.5 — Document Retention & Archival Policy.
 *
 * Política oficial de retenção documental do LiciGov Pro.
 * LGPD-aligned, Lei 14.133/2021 compliant.
 */

// ─── Retention classes ────────────────────────────────────────────────────────

export type RetentionClass =
  | "legal_permanent"           // contrato, aditivo, edital — nunca purgar
  | "legal_7years"              // parecer, ata — 7 anos (2555 dias)
  | "operational_3years"        // TR, ETP, DFD, minuta — 3 anos (1095 dias)
  | "draft_7days"               // drafts expirados — 7 dias
  | "log_2years"                // activity logs, timeline — 2 anos (730 dias)
  | "temp_30days"               // render cache, exports temporários — 30 dias
  | "attachment_follows_document"; // herda retenção do documento pai

export type ArchiveLifecycle =
  | "active"
  | "in_review"
  | "approved"
  | "archived"
  | "purge_pending"
  | "legal_hold"
  | "destroyed";

// ─── Policy shape ─────────────────────────────────────────────────────────────

export interface RetentionPolicy {
  class:          RetentionClass;
  retentionDays:  number | null; // null = never purge
  legalHold:      boolean;       // se true, bloqueio de purge/archive
  archivable:     boolean;       // pode ser arquivado
  softDeleteOnly: boolean;       // nunca deletar registro físico
  auditOnPurge:   boolean;       // obrigatório audit trail ao purgar
  description:    string;
}

// ─── Mapping: document type → retention class ─────────────────────────────────

export const DOCUMENT_TYPE_RETENTION: Record<string, RetentionClass> = {
  contrato:  "legal_permanent",
  aditivo:   "legal_permanent",
  edital:    "legal_permanent",
  parecer:   "legal_7years",
  ata:       "legal_7years",
  tr:        "operational_3years",
  etp:       "operational_3years",
  dfd:       "operational_3years",
  minuta:    "operational_3years",
};

// ─── Full policy catalog ──────────────────────────────────────────────────────

export const RETENTION_POLICIES: Record<RetentionClass, RetentionPolicy> = {
  legal_permanent: {
    class:          "legal_permanent",
    retentionDays:  null,
    legalHold:      true,
    archivable:     true,
    softDeleteOnly: true,
    auditOnPurge:   true,
    description:    "Retenção permanente — contrato, aditivo, edital (Lei 14.133/2021).",
  },
  legal_7years: {
    class:          "legal_7years",
    retentionDays:  2555,
    legalHold:      false,
    archivable:     true,
    softDeleteOnly: true,
    auditOnPurge:   true,
    description:    "Retenção de 7 anos — parecer, ata de registro de preços.",
  },
  operational_3years: {
    class:          "operational_3years",
    retentionDays:  1095,
    legalHold:      false,
    archivable:     true,
    softDeleteOnly: true,
    auditOnPurge:   true,
    description:    "Retenção de 3 anos — TR, ETP, DFD, minuta.",
  },
  draft_7days: {
    class:          "draft_7days",
    retentionDays:  7,
    legalHold:      false,
    archivable:     false,
    softDeleteOnly: false,
    auditOnPurge:   false,
    description:    "Retenção de 7 dias — drafts autosave não publicados.",
  },
  log_2years: {
    class:          "log_2years",
    retentionDays:  730,
    legalHold:      false,
    archivable:     true,
    softDeleteOnly: true,
    auditOnPurge:   true,
    description:    "Retenção de 2 anos — logs de atividade, timeline.",
  },
  temp_30days: {
    class:          "temp_30days",
    retentionDays:  30,
    legalHold:      false,
    archivable:     false,
    softDeleteOnly: false,
    auditOnPurge:   false,
    description:    "Retenção de 30 dias — render cache, exports temporários.",
  },
  attachment_follows_document: {
    class:          "attachment_follows_document",
    retentionDays:  null,
    legalHold:      false,
    archivable:     true,
    softDeleteOnly: true,
    auditOnPurge:   true,
    description:    "Herda a política de retenção do documento pai.",
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getRetentionPolicy(documentType: string): RetentionPolicy {
  const cls = DOCUMENT_TYPE_RETENTION[documentType] ?? "operational_3years";
  return RETENTION_POLICIES[cls];
}

export function computePurgeDate(
  createdAt:     Date,
  retentionDays: number | null,
): Date | null {
  if (retentionDays === null) return null;
  const d = new Date(createdAt.getTime());
  d.setDate(d.getDate() + retentionDays);
  return d;
}

export function isEligibleForPurge(
  purgeAfter: Date | null,
  legalHold:  boolean,
): boolean {
  if (legalHold)    return false;
  if (!purgeAfter)  return false;
  return new Date() >= purgeAfter;
}

export function applyLegalHold(
  documentType: string,
  explicitHold: boolean,
): boolean {
  const policy = getRetentionPolicy(documentType);
  return policy.legalHold || explicitHold;
}
