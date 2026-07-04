CREATE TABLE IF NOT EXISTS legal_reference_nodes (
  id VARCHAR(20) PRIMARY KEY,
  organizationId INT NOT NULL,
  referenceType VARCHAR(50) NOT NULL,
  law VARCHAR(200) NOT NULL,
  article VARCHAR(100) NULL,
  paragraph VARCHAR(100) NULL,
  inciso VARCHAR(100) NULL,
  content TEXT NULL,
  vigenciaStatus VARCHAR(20) NOT NULL DEFAULT 'vigente',
  vigenciaStart VARCHAR(30) NULL,
  vigenciaEnd VARCHAR(30) NULL,
  supersededBy VARCHAR(20) NULL,
  createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_lrn_org (organizationId),
  INDEX idx_lrn_type (referenceType),
  INDEX idx_lrn_law (law(100)),
  INDEX idx_lrn_vigencia (vigenciaStatus)
);
