CREATE TABLE IF NOT EXISTS communication_events (
  id VARCHAR(64) NOT NULL,
  organizationId INT NOT NULL,
  recipientUserId INT NOT NULL,
  senderUserId INT NULL,
  type VARCHAR(100) NOT NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'normal',
  title VARCHAR(500) NOT NULL,
  message TEXT NOT NULL,
  entityType VARCHAR(50) NULL,
  entityId VARCHAR(64) NULL,
  readStatus BOOLEAN NOT NULL DEFAULT false,
  readAt DATETIME(3) NULL,
  correlationId VARCHAR(64) NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_ce_org_recipient (organizationId, recipientUserId),
  INDEX idx_ce_org_type (organizationId, type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
