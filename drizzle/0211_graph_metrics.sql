CREATE TABLE IF NOT EXISTS graph_metrics (
  id VARCHAR(20) PRIMARY KEY,
  organizationId INT NOT NULL,
  metricType VARCHAR(50) NOT NULL,
  metricName VARCHAR(200) NOT NULL,
  metricValue DOUBLE NOT NULL DEFAULT 0,
  unit VARCHAR(20) NOT NULL DEFAULT 'count',
  tags TEXT NULL,
  correlationId VARCHAR(50) NULL,
  recordedAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_gm_org (organizationId),
  INDEX idx_gm_type (metricType),
  INDEX idx_gm_corr (correlationId)
);
