CREATE TABLE IF NOT EXISTS public_api_tokens (
  id VARCHAR(64) NOT NULL,
  organizationId INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  tokenHash VARCHAR(255) NOT NULL,
  scopes JSON NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  expiresAt DATETIME(3) NULL,
  lastUsedAt DATETIME(3) NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_pat_org_active (organizationId, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
