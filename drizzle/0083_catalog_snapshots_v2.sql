CREATE TABLE IF NOT EXISTS catalog_snapshots_v2 (
  id VARCHAR(64) NOT NULL,
  organization_id INT NOT NULL,
  catalog_type ENUM('catmat','catser','custom') NOT NULL,
  version VARCHAR(50) NOT NULL,
  total_entries INT NOT NULL DEFAULT 0,
  indexed_entries INT NOT NULL DEFAULT 0,
  checksum VARCHAR(64) NOT NULL,
  previous_snapshot_id VARCHAR(64) NULL,
  ingestion_job_id VARCHAR(32) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_csv2_org_type (organization_id, catalog_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
