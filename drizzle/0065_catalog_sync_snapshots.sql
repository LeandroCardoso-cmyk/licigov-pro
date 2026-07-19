CREATE TABLE IF NOT EXISTS catalog_sync_snapshots (
  id VARCHAR(26) NOT NULL,
  organization_id INT NOT NULL,
  catalog_type ENUM('catmat','catser','custom') NOT NULL,
  version VARCHAR(50) NOT NULL,
  source_url VARCHAR(500) NULL,
  checksum VARCHAR(64) NOT NULL,
  total_entries INT NOT NULL DEFAULT 0,
  indexed_entries INT NOT NULL DEFAULT 0,
  sync_status ENUM('pending','syncing','synced','failed','stale') NOT NULL DEFAULT 'pending',
  snapshot_lineage VARCHAR(26) NULL,
  import_lineage JSON NOT NULL,
  integrity_metadata JSON NOT NULL,
  cache_metadata JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_css_org (organization_id),
  INDEX idx_css_type (catalog_type),
  INDEX idx_css_status (sync_status),
  INDEX idx_css_version (organization_id, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS catalog_sync_history (
  id VARCHAR(26) NOT NULL,
  snapshot_id VARCHAR(26) NOT NULL,
  organization_id INT NOT NULL,
  operation ENUM('create','update','verify','invalidate','expire') NOT NULL,
  before_version VARCHAR(50) NULL,
  after_version VARCHAR(50) NOT NULL,
  actor VARCHAR(128) NOT NULL,
  reason TEXT NOT NULL,
  occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_csh_snapshot (snapshot_id),
  INDEX idx_csh_org (organization_id),
  INDEX idx_csh_occurred (occurred_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;