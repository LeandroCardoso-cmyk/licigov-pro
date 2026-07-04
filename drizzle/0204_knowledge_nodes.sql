CREATE TABLE IF NOT EXISTS knowledge_nodes (
  id VARCHAR(20) PRIMARY KEY,
  organizationId INT NOT NULL,
  nodeType VARCHAR(50) NOT NULL,
  title VARCHAR(500) NOT NULL,
  normalizedTitle VARCHAR(500) NOT NULL,
  description TEXT NULL,
  aliases TEXT NULL,
  metadata TEXT NULL,
  version INT NOT NULL DEFAULT 1,
  isActive BOOLEAN NOT NULL DEFAULT TRUE,
  createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_kn_org (organizationId),
  INDEX idx_kn_type (nodeType),
  INDEX idx_kn_title (normalizedTitle(100)),
  INDEX idx_kn_active (organizationId, isActive)
);
