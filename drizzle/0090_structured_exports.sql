CREATE TABLE IF NOT EXISTS structured_exports (
  id VARCHAR(64) NOT NULL,
  organizationId INT NOT NULL,
  schema VARCHAR(100) NOT NULL,
  format VARCHAR(20) NOT NULL,
  version VARCHAR(20) NOT NULL DEFAULT '1.0',
  payloadJson JSON NOT NULL,
  checksum VARCHAR(255) NOT NULL,
  correlationId VARCHAR(64) NOT NULL,
  generatedAt DATETIME(3) NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_se_org_schema (organizationId, schema),
  INDEX idx_se_org_format (organizationId, format)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
