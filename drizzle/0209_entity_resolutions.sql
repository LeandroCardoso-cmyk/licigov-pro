CREATE TABLE IF NOT EXISTS entity_resolutions (
  id VARCHAR(20) PRIMARY KEY,
  organizationId INT NOT NULL,
  sourceEntityId VARCHAR(20) NOT NULL,
  targetEntityId VARCHAR(20) NOT NULL,
  strategy VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  similarityScore DOUBLE NOT NULL DEFAULT 0,
  resolvedBy VARCHAR(100) NULL,
  resolvedAt VARCHAR(30) NULL,
  reasoning TEXT NULL,
  createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_er_org (organizationId),
  INDEX idx_er_source (sourceEntityId),
  INDEX idx_er_target (targetEntityId),
  INDEX idx_er_status (status)
);
