CREATE TABLE IF NOT EXISTS collaboration_comments (
  id VARCHAR(64) NOT NULL,
  organizationId INT NOT NULL,
  entityType VARCHAR(50) NOT NULL,
  entityId VARCHAR(64) NOT NULL,
  threadId VARCHAR(64) NULL,
  content TEXT NOT NULL,
  authorId INT NOT NULL,
  authorName VARCHAR(255) NOT NULL,
  mentions JSON NOT NULL,
  status ENUM('active','resolved','deleted') NOT NULL DEFAULT 'active',
  editHistoryJson JSON NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_cc_org_entity (organizationId, entityId),
  INDEX idx_cc_org_thread (organizationId, threadId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
