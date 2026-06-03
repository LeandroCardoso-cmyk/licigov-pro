CREATE TABLE IF NOT EXISTS institutional_workflows (
  id VARCHAR(64) NOT NULL,
  organization_id INT NOT NULL,
  process_id INT NOT NULL,
  current_stage ENUM('elaboration','technical_review','legal_review','authority_approval','director_approval','publication','completed','cancelled') NOT NULL DEFAULT 'elaboration',
  stages JSON NOT NULL,
  assigned_to JSON NOT NULL,
  deadlines JSON NOT NULL,
  escalation_rules JSON NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  correlation_id VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_iw_org (organization_id),
  INDEX idx_iw_process (organization_id, process_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
