CREATE TABLE IF NOT EXISTS document_version_diffs (
  id VARCHAR(64) NOT NULL,
  organizationId INT NOT NULL,
  entityType VARCHAR(50) NOT NULL,
  entityId VARCHAR(64) NOT NULL,
  fromVersionId VARCHAR(64) NOT NULL,
  toVersionId VARCHAR(64) NOT NULL,
  changesJson JSON NOT NULL,
  summary VARCHAR(500) NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_dvd_org_entity (organizationId, entityId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
