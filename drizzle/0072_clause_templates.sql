CREATE TABLE IF NOT EXISTS clause_templates (
  id VARCHAR(32) NOT NULL,
  organization_id INT NOT NULL,
  clause_type ENUM('header','body','item_list','legal_basis','justification','specification','price_ref','footer') NOT NULL,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  legal_basis VARCHAR(255) NULL,
  priority INT NOT NULL DEFAULT 0,
  applies_to JSON NOT NULL,
  base_relevance DECIMAL(6,4) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_ct_org (organization_id),
  INDEX idx_ct_type (organization_id, clause_type),
  INDEX idx_ct_priority (organization_id, priority DESC),
  INDEX idx_ct_active (organization_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
