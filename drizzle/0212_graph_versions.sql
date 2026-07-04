CREATE TABLE IF NOT EXISTS graph_versions (
  id VARCHAR(20) PRIMARY KEY,
  organizationId INT NOT NULL,
  versionNumber INT NOT NULL DEFAULT 1,
  description TEXT NULL,
  nodeCount INT NOT NULL DEFAULT 0,
  edgeCount INT NOT NULL DEFAULT 0,
  snapshotChecksum VARCHAR(64) NULL,
  createdBy VARCHAR(100) NULL,
  createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_gv_org (organizationId),
  INDEX idx_gv_version (organizationId, versionNumber)
);
