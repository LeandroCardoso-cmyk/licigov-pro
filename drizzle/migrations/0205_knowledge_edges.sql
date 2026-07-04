CREATE TABLE IF NOT EXISTS knowledge_edges (
  id VARCHAR(20) PRIMARY KEY,
  organizationId INT NOT NULL,
  fromNodeId VARCHAR(20) NOT NULL,
  toNodeId VARCHAR(20) NOT NULL,
  relationshipType VARCHAR(50) NOT NULL,
  direction VARCHAR(20) NOT NULL DEFAULT 'unidirectional',
  strength DOUBLE NOT NULL DEFAULT 0.5,
  metadata TEXT NULL,
  isActive BOOLEAN NOT NULL DEFAULT TRUE,
  createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_ke_org (organizationId),
  INDEX idx_ke_from (fromNodeId),
  INDEX idx_ke_to (toNodeId),
  INDEX idx_ke_rel (relationshipType),
  INDEX idx_ke_active (organizationId, isActive)
);
