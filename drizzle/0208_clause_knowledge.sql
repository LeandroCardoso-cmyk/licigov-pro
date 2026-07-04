CREATE TABLE IF NOT EXISTS clause_knowledge (
  id VARCHAR(20) PRIMARY KEY,
  organizationId INT NOT NULL,
  category VARCHAR(50) NOT NULL,
  title VARCHAR(300) NOT NULL,
  content TEXT NULL,
  legalBasis TEXT NULL,
  riskLevel VARCHAR(20) NOT NULL DEFAULT 'low',
  riskFactors TEXT NULL,
  mitigations TEXT NULL,
  applicableModalities TEXT NULL,
  isActive BOOLEAN NOT NULL DEFAULT TRUE,
  createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_ck_org (organizationId),
  INDEX idx_ck_cat (category),
  INDEX idx_ck_risk (riskLevel)
);
