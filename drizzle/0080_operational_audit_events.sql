CREATE TABLE IF NOT EXISTS operational_audit_events (
  id VARCHAR(64) NOT NULL,
  organization_id INT NOT NULL,
  category ENUM('export','approval','override','clause_change','item_change','semantic_override','workflow_transition','tenant_operation') NOT NULL,
  action VARCHAR(255) NOT NULL,
  actor_id INT NOT NULL,
  actor_role VARCHAR(100) NOT NULL,
  target_type VARCHAR(100) NOT NULL,
  target_id VARCHAR(100) NOT NULL,
  before_state JSON NULL,
  after_state JSON NULL,
  justification TEXT NULL,
  correlation_id VARCHAR(64) NULL,
  occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_oae_org_cat (organization_id, category),
  INDEX idx_oae_org_target (organization_id, target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
