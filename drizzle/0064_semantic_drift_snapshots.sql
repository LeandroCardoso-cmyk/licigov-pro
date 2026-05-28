CREATE TABLE IF NOT EXISTS semantic_drift_snapshots (
  id VARCHAR(26) NOT NULL,
  organization_id INT NOT NULL,
  period_start DATETIME(3) NOT NULL,
  period_end DATETIME(3) NOT NULL,
  metrics JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_sds_org (organization_id),
  INDEX idx_sds_period (organization_id, period_start DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
