CREATE TABLE IF NOT EXISTS discussion_threads (
  id VARCHAR(64) NOT NULL,
  organizationId INT NOT NULL,
  entityType VARCHAR(50) NOT NULL,
  entityId VARCHAR(64) NOT NULL,
  title VARCHAR(500) NOT NULL,
  status ENUM('open','resolved') NOT NULL DEFAULT 'open',
  resolvedBy INT NULL,
  resolvedAt DATETIME(3) NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_dt_org_entity (organizationId, entityId),
  INDEX idx_dt_org_status (organizationId, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
