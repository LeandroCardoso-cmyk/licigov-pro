CREATE TABLE IF NOT EXISTS distributed_cache_entries (
  `key` VARCHAR(512) NOT NULL,
  organization_id INT NOT NULL,
  value JSON NOT NULL,
  ttl_ms INT NOT NULL DEFAULT 300000,
  snapshot_version VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  INDEX idx_dce_org_key (organization_id, `key`),
  INDEX idx_dce_expires (expires_at),
  PRIMARY KEY (organization_id, `key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
