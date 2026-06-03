CREATE TABLE IF NOT EXISTS external_storage_snapshots (
  id VARCHAR(64) NOT NULL,
  organizationId INT NOT NULL,
  adapterId VARCHAR(64) NOT NULL,
  totalFiles INT NOT NULL DEFAULT 0,
  syncedFiles INT NOT NULL DEFAULT 0,
  conflictsCount INT NOT NULL DEFAULT 0,
  checksum VARCHAR(255) NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_ess_org_adapter (organizationId, adapterId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
