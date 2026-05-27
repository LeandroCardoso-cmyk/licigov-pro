/**
 * Sprint 1.8 — Classificação oficial de auditoria do LiciGov Pro.
 *
 * Toda ação registrada no activity_log pode ser classificada neste sistema.
 * Usado para: filtros, retenção, compliance jurídico, analytics, LGPD.
 */

export type AuditCategory =
  | "operational"  // Operações cotidianas do sistema
  | "legal"        // Atos jurídicos formais (contratos, pareceres, licitações)
  | "workflow"     // Transições de estado de processos
  | "security"     // Eventos de segurança (login, acesso negado, senhas)
  | "compliance"   // LGPD, consentimentos, exportações de dados
  | "document"     // Criação, edição e aprovação de documentos
  | "system"       // Eventos internos do sistema (migrations, bootstrap, flags)
  | "ai"           // Geração e uso de IA
  | "tenant"       // Gestão de organizações e membros
  | "integration"; // Integrações externas e webhooks

export type AuditRetention =
  | "30d"       // Logs operacionais de baixo valor
  | "90d"       // Logs de curto prazo
  | "1y"        // Padrão geral
  | "5y"        // Processos licitatórios (Lei 14.133/2021)
  | "10y"       // Contratos e atos jurídicos
  | "permanent"; // Consentimentos LGPD, criação de org

export interface AuditClassification {
  category: AuditCategory;
  retention: AuditRetention;
  /** Ato que exige notificação legal ou publicação em diário oficial */
  requiresLegalNotice?: boolean;
  /** Contém dados pessoais (PII) — requer atenção especial LGPD */
  piiPresent?: boolean;
  /** Base legal aplicável */
  legalBasis?: string;
}

/**
 * Mapa oficial de classificação por action string.
 * Usado em activity_log, analytics e auditoria de compliance.
 */
export const AUDIT_ACTION_CLASSIFICATIONS: Record<string, AuditClassification> = {
  // ── Operational ──────────────────────────────────────────────────────────
  process_created:          { category: "operational", retention: "5y" },
  process_updated:          { category: "operational", retention: "5y" },
  process_deleted:          { category: "operational", retention: "5y" },

  // ── Workflow ──────────────────────────────────────────────────────────────
  process_status_changed:   { category: "workflow",    retention: "5y" },
  stage_assigned:           { category: "workflow",    retention: "5y" },
  workflow_advanced:        { category: "workflow",    retention: "5y" },

  // ── Document ──────────────────────────────────────────────────────────────
  document_created:         { category: "document",    retention: "10y" },
  document_updated:         { category: "document",    retention: "10y" },
  document_approved:        { category: "document",    retention: "10y", requiresLegalNotice: true },
  document_rejected:        { category: "document",    retention: "10y" },
  document_uploaded:        { category: "document",    retention: "10y" },
  document_version_created: { category: "document",    retention: "10y" },

  // ── Legal ─────────────────────────────────────────────────────────────────
  contract_created:         { category: "legal", retention: "10y", requiresLegalNotice: true },
  contract_signed:          { category: "legal", retention: "10y", requiresLegalNotice: true },
  contract_updated:         { category: "legal", retention: "10y" },
  legal_opinion_created:    { category: "legal", retention: "10y", requiresLegalNotice: true },
  direct_contract_created:  { category: "legal", retention: "10y", requiresLegalNotice: true },

  // ── Security ──────────────────────────────────────────────────────────────
  login_success:            { category: "security", retention: "1y" },
  login_failed:             { category: "security", retention: "1y" },
  password_changed:         { category: "security", retention: "1y" },
  token_revoked:            { category: "security", retention: "1y" },
  unauthorized_access:      { category: "security", retention: "1y" },
  permission_denied:        { category: "security", retention: "1y" },

  // ── Tenant ────────────────────────────────────────────────────────────────
  org_created:              { category: "tenant", retention: "permanent" },
  org_updated:              { category: "tenant", retention: "5y" },
  member_added:             { category: "tenant", retention: "5y" },
  member_removed:           { category: "tenant", retention: "5y" },
  member_role_changed:      { category: "tenant", retention: "5y" },

  // ── Compliance (LGPD) ────────────────────────────────────────────────────
  lgpd_consent_given:       { category: "compliance", retention: "permanent", piiPresent: true, legalBasis: "Lei 13.709/2018 LGPD Art. 7" },
  lgpd_consent_revoked:     { category: "compliance", retention: "permanent", piiPresent: true, legalBasis: "Lei 13.709/2018 LGPD Art. 15" },
  data_export_requested:    { category: "compliance", retention: "permanent", piiPresent: true, legalBasis: "Lei 13.709/2018 LGPD Art. 18" },
  data_deletion_requested:  { category: "compliance", retention: "permanent", piiPresent: true, legalBasis: "Lei 13.709/2018 LGPD Art. 18" },

  // ── AI ────────────────────────────────────────────────────────────────────
  ai_generation_started:    { category: "ai", retention: "1y" },
  ai_generation_completed:  { category: "ai", retention: "1y" },
  ai_generation_failed:     { category: "ai", retention: "90d" },

  // ── System ────────────────────────────────────────────────────────────────
  bootstrap_completed:      { category: "system", retention: "30d" },
  migration_applied:        { category: "system", retention: "30d" },
  feature_flag_changed:     { category: "system", retention: "90d" },
  outbox_event_failed:      { category: "system", retention: "90d" },
  dead_letter_replayed:     { category: "system", retention: "90d" },

  // ── Integration ───────────────────────────────────────────────────────────
  webhook_received:         { category: "integration", retention: "90d" },
  webhook_sent:             { category: "integration", retention: "90d" },
  external_api_called:      { category: "integration", retention: "90d" },
};

/**
 * Retorna a classificação para uma action string.
 * Fallback: { category: "operational", retention: "1y" }
 */
export function classifyAction(action: string): AuditClassification {
  return (
    AUDIT_ACTION_CLASSIFICATIONS[action] ?? {
      category: "operational",
      retention: "1y",
    }
  );
}

/**
 * Número de dias de retenção por política.
 * null = retenção permanente (não apagar).
 */
export const RETENTION_DAYS: Record<AuditRetention, number | null> = {
  "30d":       30,
  "90d":       90,
  "1y":        365,
  "5y":        365 * 5,
  "10y":       365 * 10,
  "permanent": null,
};
