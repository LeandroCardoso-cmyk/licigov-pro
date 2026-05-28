CREATE TABLE IF NOT EXISTS tr_composition_rules (
  id VARCHAR(26) NOT NULL,
  organization_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  condition_expr TEXT NOT NULL,
  action ENUM('include_section','exclude_section','replace_clause','append_clause') NOT NULL,
  target_id VARCHAR(26) NOT NULL,
  priority INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_tcr_org (organization_id),
  INDEX idx_tcr_priority (organization_id, priority DESC),
  INDEX idx_tcr_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
