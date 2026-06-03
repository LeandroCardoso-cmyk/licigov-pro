CREATE TABLE IF NOT EXISTS tenant_integrity_reports (
  id VARCHAR(64) NOT NULL,
  organization_id INT NOT NULL,
  scan_type VARCHAR(64) NOT NULL,
  findings_count INT NOT NULL DEFAULT 0,
  healthy TINYINT(1) NOT NULL DEFAULT 1,
  findings JSON NOT NULL,
  scanned_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_tir_org (organization_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
