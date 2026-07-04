CREATE TABLE IF NOT EXISTS procurement_concepts (
  id VARCHAR(20) PRIMARY KEY,
  organizationId INT NOT NULL,
  category VARCHAR(50) NOT NULL,
  name VARCHAR(300) NOT NULL,
  normalizedName VARCHAR(300) NOT NULL,
  definition TEXT NULL,
  parentId VARCHAR(20) NULL,
  aliases TEXT NULL,
  legalBasis TEXT NULL,
  isActive BOOLEAN NOT NULL DEFAULT TRUE,
  createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_pc_org (organizationId),
  INDEX idx_pc_cat (category),
  INDEX idx_pc_name (normalizedName(100)),
  INDEX idx_pc_parent (parentId)
);
