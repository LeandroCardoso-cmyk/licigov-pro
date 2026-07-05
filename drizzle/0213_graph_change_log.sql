CREATE TABLE IF NOT EXISTS graph_change_log (
  id VARCHAR(20) PRIMARY KEY,
  organizationId INT NOT NULL,
  versionId VARCHAR(20) NULL,
  operation VARCHAR(30) NOT NULL,
  entityType VARCHAR(30) NOT NULL,
  entityId VARCHAR(20) NOT NULL,
  beforeState TEXT NULL,
  afterState TEXT NULL,
  actor VARCHAR(100) NULL,
  reason TEXT NULL,
  occurredAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_gcl_org (organizationId),
  INDEX idx_gcl_version (versionId),
  INDEX idx_gcl_entity (entityType, entityId),
  INDEX idx_gcl_occurred (occurredAt)
);
