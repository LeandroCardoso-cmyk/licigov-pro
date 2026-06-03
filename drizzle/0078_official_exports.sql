CREATE TABLE IF NOT EXISTS official_exports (
  id VARCHAR(64) NOT NULL,
  organization_id INT NOT NULL,
  process_id INT NOT NULL,
  format ENUM('docx','pdf') NOT NULL,
  filename VARCHAR(255) NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  page_count INT NOT NULL DEFAULT 1,
  template_id VARCHAR(64) NULL,
  watermark VARCHAR(255) NULL,
  correlation_id VARCHAR(64) NULL,
  generated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_oe_org (organization_id),
  INDEX idx_oe_process (organization_id, process_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
