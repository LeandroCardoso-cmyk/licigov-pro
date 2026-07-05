CREATE TABLE IF NOT EXISTS ontology_taxonomy (
  id VARCHAR(20) PRIMARY KEY,
  organizationId INT NOT NULL,
  domain VARCHAR(100) NOT NULL,
  parentId VARCHAR(20) NULL,
  name VARCHAR(300) NOT NULL,
  description TEXT NULL,
  level INT NOT NULL DEFAULT 0,
  sortOrder INT NOT NULL DEFAULT 0,
  isActive BOOLEAN NOT NULL DEFAULT TRUE,
  createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_ot_org (organizationId),
  INDEX idx_ot_domain (domain),
  INDEX idx_ot_parent (parentId)
);
