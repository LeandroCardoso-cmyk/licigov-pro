CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id VARCHAR(64) NOT NULL,
  organizationId INT NOT NULL,
  endpointId VARCHAR(64) NOT NULL,
  eventType VARCHAR(100) NOT NULL,
  payloadJson JSON NOT NULL,
  signature VARCHAR(256) NOT NULL,
  status ENUM('pending','delivered','failed','dead_letter') NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  lastError TEXT NULL,
  correlationId VARCHAR(64) NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deliveredAt DATETIME(3) NULL,
  INDEX idx_wd_org_event (organizationId, eventType),
  INDEX idx_wd_org_status (organizationId, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
